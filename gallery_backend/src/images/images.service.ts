import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { PrismaService } from '../common/prisma/prisma.service';
import { RedisService } from '../common/redis/redis.service';
import { AlbumsService } from '../albums/albums.service';
import { ImagePipelineService } from '../media-processing/image-pipeline.service';
import {
  VideoPipelineService,
  type VideoProbe,
} from '../media-processing/video-pipeline.service';
import type { EmbeddableFormat } from '../protection/rights-metadata.service';
import { RightsMetadataService } from '../protection/rights-metadata.service';
import type { RightsFields } from '../protection/rights-metadata.service';
import { resolveRights, sanitizeRightsPartial } from '../protection/rights.util';
import { WatermarkService } from '../protection/watermark.service';
import { SiteService } from '../site/site.service';
import { StorageService } from '../storage/storage.service';
import type { MediaVisibility } from '../storage/storage-driver.interface';
import type { AuthenticatedUser } from '../auth/jwt-payload.interface';
import {
  BulkStatusDto,
  ReorderMediaDto,
  UpdateMediaDto,
} from './dto/media.dto';

/**
 * Un archivo subido. Multer lo escribe a un archivo temporal en disco (no a
 * memoria) — un video puede pesar cientos de MB y no tiene sentido bufferizarlo
 * entero. `path` es esa ruta temporal; quien la consume la borra al terminar.
 */
export interface UploadedMediaFile {
  path: string;
  mimetype: string;
  originalname: string;
  size: number;
}

/** Estado del transcode de un video en segundo plano (Fase 14b, en memoria del proceso). */
export interface VideoJobState {
  state: 'processing' | 'done' | 'error';
  step: string;
  error?: string;
}

/** Extensiones y MIME que delatan un video (solo una PISTA — `ffprobe` es la autoridad). */
const VIDEO_HINT = /\.(mp4|m4v|mov|webm|mkv)$/i;

/**
 * Tope de tamaño para una IMAGEN (se lee entera a memoria). El interceptor de
 * multer deja pasar archivos mucho más grandes para admitir video; aquí se
 * corta antes de bufferizar una "imagen" gigante. `UPLOAD_MAX_FILE_BYTES` (por
 * defecto 15 MiB) es el mismo valor que usa el interceptor para imágenes.
 */
const IMAGE_MAX_BYTES = Math.max(
  100_000,
  Number(process.env.UPLOAD_MAX_FILE_BYTES) || 15_728_640,
);

/**
 * Subidas por usuario y hora antes de responder 429. Configurable con
 * `UPLOAD_MAX_UPLOADS_PER_HOUR` (por defecto 120) — se sube en desarrollo para
 * poder sembrar la demo, se deja bajo en producción.
 */
const MAX_UPLOADS_PER_HOUR = Math.max(
  1,
  Number(process.env.UPLOAD_MAX_UPLOADS_PER_HOUR) || 120,
);

/**
 * Subida de imágenes (pipeline de seguridad + almacenamiento + persistencia),
 * reordenado, edición de metadatos y borrado.
 */
@Injectable()
export class ImagesService {
  private readonly logger = new Logger(ImagesService.name);

  /**
   * Estado de cada transcode de video en curso (Fase 14b). En memoria del
   * proceso a propósito — nunca Redis (mismo criterio que la regeneración de
   * marca de agua, Fase 11): si el proceso se reinicia, el gestor ve el video
   * sin `storage_key` ni `processing_error` y `getProcessingState` lo reporta
   * como interrumpido.
   */
  private readonly videoJobs = new Map<string, VideoJobState>();

  /**
   * Cola de transcodes con **concurrencia 1**: `ffmpeg` es intensivo en CPU y
   * varios a la vez saturarían el contenedor. Cada subida encadena su trabajo
   * al final de esta promesa.
   */
  private videoQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pipeline: ImagePipelineService,
    private readonly video: VideoPipelineService,
    private readonly redis: RedisService,
    private readonly albums: AlbumsService,
    private readonly watermark: WatermarkService,
    private readonly metadata: RightsMetadataService,
    private readonly site: SiteService,
  ) {}

  /**
   * Sube una imagen a un álbum.
   *
   * Flujo: rate limit → `pipeline.process` (valida por contenido, re-codifica,
   * quita EXIF, genera derivados + placeholder) → sube original y derivados al
   * almacenamiento → persiste `media` + `media_variants` + `media_count` en
   * una transacción. Si algo falla tras subir objetos, se limpian.
   *
   * @param albumId - Álbum destino.
   * @param actor - Usuario autenticado (debe ser dueño del álbum o admin).
   * @param file - El archivo subido.
   * @returns La imagen creada, con sus URLs de entrega.
   * @throws HttpException 429 si se superó el límite de subidas por hora.
   * @throws BadRequestException si el contenido no es una imagen admitida.
   */
  async upload(
    albumId: string,
    actor: AuthenticatedUser,
    file: UploadedMediaFile,
  ) {
    try {
      const uploads = await this.redis.incrementWithTtl(
        `ul:${actor.userId}`,
        3600,
      );
      if (uploads > MAX_UPLOADS_PER_HOUR) {
        throw new HttpException(
          'Has subido demasiado contenido en la última hora.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const album = await this.albums.getOwned(albumId, actor);
      const visibility = album.visibility as MediaVisibility;

      const looksLikeVideo =
        file.mimetype.startsWith('video/') || VIDEO_HINT.test(file.originalname);

      return looksLikeVideo
        ? await this.uploadVideo(album, file, visibility)
        : await this.uploadImage(album, file, visibility);
    } finally {
      // El camino de imagen ya leyó el temporal; el de video ya lo copió a su
      // propio directorio de trabajo. En ambos casos este original se borra.
      await rm(file.path, { force: true }).catch(() => undefined);
    }
  }

  /** Sube una imagen: el flujo de siempre, leyendo el archivo temporal a memoria. */
  private async uploadImage(
    album: { album_id: string; owner_user_id: string; visibility: string; cover_media_id: string | null },
    file: UploadedMediaFile,
    visibility: MediaVisibility,
  ) {
    if (file.size > IMAGE_MAX_BYTES) {
      throw new HttpException('La imagen supera el tamaño máximo.', HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const buffer = await readFile(file.path);
    const processed = await this.pipeline.process(buffer);

    // Fase 11 — protección: se resuelve una vez por subida.
    // (1) Derechos: la imagen aún no existe, así que no tiene override propio
    //     todavía — hereda por completo los defaults del sitio.
    // (2) Marca de agua: solo para colecciones `public` — D9.
    const rights = resolveRights(await this.site.getRightsDefaults(), null);
    const originalFormat: EmbeddableFormat =
      processed.original.extension === 'png' ? 'png' : 'jpeg';
    const watermarkConfig =
      visibility === 'public' ? await this.site.getWatermarkConfig() : null;

    const storedKeys: string[] = [];
    try {
      // El original nunca lleva marca (D9); sí lleva los derechos incrustados.
      const originalWithRights = await this.metadata.embed(
        processed.original.buffer,
        originalFormat,
        rights,
      );
      const originalStored = await this.storage.put(originalWithRights, {
        extension: processed.original.extension,
        contentType: processed.original.contentType,
        visibility,
      });
      storedKeys.push(originalStored.key);

      const variantRows: {
        storage_key: string;
        label: string;
        format: string;
        width: number;
        height: number;
        bytes: number;
      }[] = [];
      for (const variant of processed.variants) {
        const marked = watermarkConfig
          ? await this.watermark.composite(variant.buffer, watermarkConfig)
          : variant.buffer;
        const withRights = await this.metadata.embed(marked, 'webp', rights);
        const stored = await this.storage.put(withRights, {
          extension: 'webp',
          contentType: 'image/webp',
          visibility,
        });
        storedKeys.push(stored.key);
        variantRows.push({
          storage_key: stored.key,
          label: variant.label,
          format: variant.format,
          width: variant.width,
          height: variant.height,
          bytes: withRights.byteLength,
        });
      }

      const nextSort = await this.prisma.media.count({
        where: { album_id: album.album_id },
      });

      const media = await this.prisma.$transaction(async (tx) => {
        const created = await tx.media.create({
          data: {
            album_id: album.album_id,
            owner_user_id: album.owner_user_id,
            storage_key: originalStored.key,
            original_name: this.sanitizeName(file.originalname),
            mime_type: processed.original.contentType,
            width: processed.original.width,
            height: processed.original.height,
            bytes: processed.original.bytes,
            checksum_sha256: processed.original.checksumSha256,
            placeholder: processed.placeholder || null,
            sort_order: nextSort,
            variants: { create: variantRows },
          },
          include: { variants: true },
        });
        await tx.albums.update({
          where: { album_id: album.album_id },
          data: {
            media_count: { increment: 1 },
            ...(album.cover_media_id
              ? {}
              : { cover_media_id: created.media_id }),
          },
        });
        return created;
      });

      return this.toDto(media, media.variants, visibility);
    } catch (error) {
      // Compensación: si la transacción falló, no dejamos objetos huérfanos.
      await Promise.all(storedKeys.map((key) => this.storage.remove(key)));
      throw error;
    }
  }

  /**
   * Sube un video. Valida por contenido con `ffprobe`, crea la fila `media`
   * (`kind=video`, `status=draft`, todavía **sin** `storage_key`) y encola el
   * transcode en segundo plano — responde de inmediato. El master limpio, la
   * portada y el preview los rellena `runVideoTranscode`.
   *
   * @throws BadRequestException si el archivo no es un video válido o supera
   *         los límites (duración, resolución, tamaño, frame rate).
   */
  private async uploadVideo(
    album: { album_id: string; owner_user_id: string; visibility: string; cover_media_id: string | null },
    file: UploadedMediaFile,
    visibility: MediaVisibility,
  ) {
    const probe = await this.video.probe(file.path, file.size);

    // El original subido se copia al directorio de trabajo del job: la ruta
    // temporal de multer se borra al volver de `upload()`.
    const workDir = await mkdtemp(join(tmpdir(), 'gallery-video-'));
    const srcPath = join(workDir, 'src');
    await copyFile(file.path, srcPath);
    const sourceChecksum = await this.hashFile(srcPath);

    const nextSort = await this.prisma.media.count({
      where: { album_id: album.album_id },
    });

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const row = await tx.media.create({
          data: {
            album_id: album.album_id,
            owner_user_id: album.owner_user_id,
            kind: 'video',
            storage_key: null, // lo pone el job al terminar el master
            original_name: this.sanitizeName(file.originalname),
            mime_type: 'video/mp4', // el master siempre sale en MP4/H.264
            width: probe.width,
            height: probe.height,
            bytes: file.size,
            checksum_sha256: sourceChecksum,
            sort_order: nextSort,
            duration_ms: probe.durationMs,
            frame_rate: probe.frameRate,
            video_codec: probe.videoCodec,
            audio_codec: probe.audioCodec,
            has_audio: probe.hasAudio,
          },
          include: { variants: true },
        });
        await tx.albums.update({
          where: { album_id: album.album_id },
          data: {
            media_count: { increment: 1 },
            ...(album.cover_media_id ? {} : { cover_media_id: row.media_id }),
          },
        });
        return row;
      });
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }

    this.videoJobs.set(created.media_id, { state: 'processing', step: 'en cola' });
    // Concurrencia 1: se encola al final de la promesa de la cola.
    this.videoQueue = this.videoQueue.then(() =>
      this.runVideoTranscode(created.media_id, workDir, srcPath, probe, visibility),
    );

    return this.toDto(created, created.variants, visibility);
  }

  /**
   * Transcode de un video en segundo plano (fuera del ciclo de la petición):
   * master limpio → portada → preview 720p → derechos incrustados → subida →
   * se rellena la fila. Cualquier error se guarda en `media.processing_error`
   * (el gestor lo ve) y el video queda sin publicar; nunca tumba el proceso.
   */
  private async runVideoTranscode(
    mediaId: string,
    workDir: string,
    srcPath: string,
    probe: VideoProbe,
    visibility: MediaVisibility,
  ): Promise<void> {
    const setStep = (step: string) =>
      this.videoJobs.set(mediaId, { state: 'processing', step });
    const uploadedKeys: string[] = [];

    try {
      const masterPath = join(workDir, 'master.mp4');
      const posterPng = join(workDir, 'poster.png');
      const hlsWorkDir = join(workDir, 'hls');
      await mkdir(hlsWorkDir, { recursive: true });

      setStep('transcodificando master');
      await this.video.transcodeMaster(srcPath, masterPath, probe.hasAudio);

      setStep('generando portada');
      await this.video.extractPoster(
        masterPath,
        posterPng,
        Math.round(probe.durationMs * 0.1),
      );
      const poster = await this.pipeline.process(await readFile(posterPng));

      // Marca de agua: solo en álbumes `public` (D9), igual que las fotos.
      const watermarkConfig =
        visibility === 'public' ? await this.site.getWatermarkConfig() : null;
      const rights: RightsFields = resolveRights(
        await this.site.getRightsDefaults(),
        null,
      );

      // Master limpio: derechos incrustados, NUNCA marca (D9 — no se sirve en público).
      await this.metadata.embedInPlace(masterPath, 'mp4', rights);
      const masterBuf = await readFile(masterPath);

      // Renditions HLS: 360/540/720/1080 que quepan bajo el master, más la del
      // propio master. Cada una: escalada + marca incrustada (si es público).
      const heights = [
        ...new Set(
          [360, 540, 720, 1080]
            .filter((h) => h < probe.height)
            .concat(Math.min(probe.height, 2160)),
        ),
      ].sort((a, b) => a - b);
      const renditions: {
        path: string;
        width: number;
        height: number;
        bitrateKbps: number;
      }[] = [];
      for (const h of heights) {
        const w = Math.round((probe.width * h) / probe.height / 2) * 2;
        const bitrateKbps = bitrateForHeight(h);
        const rPath = join(workDir, `r${h}.mp4`);
        let overlayPath: string | null = null;
        if (watermarkConfig) {
          overlayPath = join(workDir, `wm${h}.png`);
          await writeFile(
            overlayPath,
            await this.watermark.buildFrameOverlay(w, h, watermarkConfig),
          );
        }
        setStep(`transcodificando ${h}p`);
        await this.video.buildRendition(
          masterPath,
          rPath,
          { width: w, height: h },
          probe.frameRate,
          bitrateKbps,
          overlayPath,
          probe.hasAudio,
        );
        await this.metadata.embedInPlace(rPath, 'mp4', rights);
        renditions.push({ path: rPath, width: w, height: h, bitrateKbps });
      }

      // El preview standalone (respaldo sin HLS) = la rendition ≤720p más alta.
      const previewRendition =
        [...renditions].reverse().find((r) => r.height <= 720) ?? renditions[0];
      const previewBuf = await readFile(previewRendition.path);

      setStep('empaquetando HLS');
      await this.video.packageHls(
        renditions.map((r) => r.path),
        hlsWorkDir,
        probe.hasAudio,
      );

      // Subir segmentos + playlists, reescribiendo cada playlist para que sus
      // líneas apunten a las URLs servidas (las claves del almacenamiento son
      // opacas, no coinciden con los nombres relativos que genera ffmpeg).
      setStep('subiendo HLS');
      const HLS_TTL = Math.max(
        600,
        Number(process.env.MEDIA_HLS_URL_TTL_SECONDS) || 3600,
      );
      const urlOf = (key: string) =>
        this.storage.urlFor(key, visibility, HLS_TTL);
      const hlsFiles = await readdir(hlsWorkDir);
      const hlsKeys: string[] = [];

      const segUrlByName = new Map<string, string>();
      for (const seg of hlsFiles.filter((f) => f.endsWith('.ts'))) {
        const stored = await this.storage.put(
          await readFile(join(hlsWorkDir, seg)),
          { extension: 'ts', contentType: 'video/mp2t', visibility },
        );
        hlsKeys.push(stored.key);
        segUrlByName.set(seg, urlOf(stored.key));
      }
      const streamUrlByName = new Map<string, string>();
      for (const stream of hlsFiles
        .filter((f) => /^stream_\d+\.m3u8$/.test(f))
        .sort()) {
        const rewritten = rewritePlaylist(
          await readFile(join(hlsWorkDir, stream), 'utf8'),
          segUrlByName,
        );
        const stored = await this.storage.put(Buffer.from(rewritten), {
          extension: 'm3u8',
          contentType: 'application/vnd.apple.mpegurl',
          visibility,
        });
        hlsKeys.push(stored.key);
        streamUrlByName.set(stream, urlOf(stored.key));
      }
      const masterM3u8 = rewritePlaylist(
        await readFile(join(hlsWorkDir, 'master.m3u8'), 'utf8'),
        streamUrlByName,
      );
      const hlsMaster = await this.storage.put(Buffer.from(masterM3u8), {
        extension: 'm3u8',
        contentType: 'application/vnd.apple.mpegurl',
        visibility,
      });
      hlsKeys.push(hlsMaster.key);
      uploadedKeys.push(...hlsKeys);

      setStep('subiendo');
      const master = await this.storage.put(masterBuf, {
        extension: 'mp4',
        contentType: 'video/mp4',
        visibility,
      });
      uploadedKeys.push(master.key);
      const preview = await this.storage.put(previewBuf, {
        extension: 'mp4',
        contentType: 'video/mp4',
        visibility,
      });
      uploadedKeys.push(preview.key);

      const variantRows: {
        storage_key: string;
        label: string;
        format: string;
        width: number;
        height: number;
        bytes: number;
      }[] = [];
      for (const variant of poster.variants) {
        // El póster es público: marca (si el álbum es `public`) + derechos,
        // igual que cualquier derivado de foto.
        const marked = watermarkConfig
          ? await this.watermark.composite(variant.buffer, watermarkConfig)
          : variant.buffer;
        const withRights = await this.metadata.embed(marked, 'webp', rights);
        const stored = await this.storage.put(withRights, {
          extension: 'webp',
          contentType: 'image/webp',
          visibility,
        });
        uploadedKeys.push(stored.key);
        variantRows.push({
          storage_key: stored.key,
          label: variant.label,
          format: 'webp',
          width: variant.width,
          height: variant.height,
          bytes: withRights.byteLength,
        });
      }
      const large =
        variantRows.find((v) => v.label === 'large') ??
        variantRows[variantRows.length - 1];
      variantRows.push({
        storage_key: preview.key,
        label: 'preview',
        format: 'mp4',
        width: previewRendition.width,
        height: previewRendition.height,
        bytes: previewBuf.byteLength,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.media_variants.deleteMany({ where: { media_id: mediaId } });
        await tx.media.update({
          where: { media_id: mediaId },
          data: {
            storage_key: master.key,
            bytes: masterBuf.byteLength,
            checksum_sha256: createHash('sha256').update(masterBuf).digest('hex'),
            placeholder: poster.placeholder || null,
            poster_key: large?.storage_key ?? null,
            hls_manifest_key: hlsMaster.key,
            hls_keys: hlsKeys,
            processing_error: null,
            variants: { create: variantRows },
          },
        });
      });

      this.videoJobs.set(mediaId, { state: 'done', step: 'listo' });
      setTimeout(() => this.videoJobs.delete(mediaId), 60_000).unref();
    } catch (error) {
      const message = (error as Error).message ?? 'error desconocido';
      this.logger.warn(`Transcode de video ${mediaId} falló: ${message}`);
      await Promise.all(uploadedKeys.map((key) => this.storage.remove(key))).catch(
        () => undefined,
      );
      await this.prisma.media
        .update({
          where: { media_id: mediaId },
          data: { processing_error: message.slice(0, 500) },
        })
        .catch(() => undefined);
      this.videoJobs.set(mediaId, { state: 'error', step: 'error', error: message });
      setTimeout(() => this.videoJobs.delete(mediaId), 300_000).unref();
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Estado del transcode de un video (para que el Studio muestre "procesando…"
   * y refresque cuando termine).
   *
   * @returns `processing` mientras el job corre; `done` cuando ya tiene master;
   *          `error` si el transcode falló o se interrumpió (reinicio).
   */
  async getProcessingState(
    mediaId: string,
    actor: AuthenticatedUser,
  ): Promise<VideoJobState> {
    const { media } = await this.loadManageable(mediaId, actor);
    if (media.kind !== 'video') {
      return { state: 'done', step: 'listo' };
    }
    const job = this.videoJobs.get(mediaId);
    if (job) return job;
    if (media.storage_key) return { state: 'done', step: 'listo' };
    if (media.processing_error) {
      return { state: 'error', step: 'error', error: media.processing_error };
    }
    return {
      state: 'error',
      step: 'interrumpido',
      error:
        'El procesamiento se interrumpió (probablemente por un reinicio del servidor). Borra este video y vuelve a subirlo.',
    };
  }

  /** SHA-256 de un archivo, leyéndolo por streaming (no lo carga entero en memoria). */
  private hashFile(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * Lista las imágenes de un álbum para el Studio (vista del dueño / admin),
   * con las URLs de entrega ya resueltas.
   *
   * @param albumId - Álbum.
   * @param actor - Usuario autenticado (dueño o admin).
   */
  async listForAlbum(albumId: string, actor: AuthenticatedUser) {
    const album = await this.albums.getOwned(albumId, actor);
    const rows = await this.prisma.media.findMany({
      where: { album_id: album.album_id },
      orderBy: { sort_order: 'asc' },
      include: { variants: true },
    });
    const visibility = album.visibility as MediaVisibility;
    return rows.map((m) => this.toDto(m, m.variants, visibility));
  }

  /**
   * Edita alt / caption / orden / estado de curación / derechos de una imagen.
   *
   * El registro de derechos (`dto.rights`) solo se **guarda** — para que el
   * cambio se refleje en los archivos ya servidos hace falta
   * `POST /site/watermark/regenerate` (Fase 11); una subida nueva siempre usa
   * lo vigente en el momento de subirla.
   */
  async update(mediaId: string, actor: AuthenticatedUser, dto: UpdateMediaDto) {
    const { media, visibility } = await this.loadManageable(mediaId, actor);
    const updated = await this.prisma.media.update({
      where: { media_id: media.media_id },
      data: {
        ...(dto.altText !== undefined ? { alt_text: dto.altText } : {}),
        ...(dto.caption !== undefined ? { caption: dto.caption } : {}),
        ...(dto.sortOrder !== undefined ? { sort_order: dto.sortOrder } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.rights !== undefined
          ? {
              rights:
                dto.rights === null
                  ? Prisma.JsonNull
                  : (sanitizeRightsPartial(dto.rights) as Prisma.InputJsonValue),
            }
          : {}),
      },
      include: { variants: true },
    });
    return this.toDto(updated, updated.variants, visibility);
  }

  /**
   * Cambia el estado de curación de varias imágenes de un álbum a la vez
   * (publicar / pasar a borrador / archivar en bloque — el flujo real cuando
   * se sube en ancho y luego se cura).
   *
   * @param albumId - Álbum de las imágenes.
   * @param actor - Usuario autenticado (dueño del álbum o admin).
   * @param dto - `mediaIds` + `status` destino.
   * @returns `{ ok, updated }` con cuántas filas cambiaron.
   * @throws BadRequestException si algún id no pertenece a ese álbum.
   */
  async setStatusBulk(
    albumId: string,
    actor: AuthenticatedUser,
    dto: BulkStatusDto,
  ): Promise<{ ok: true; updated: number }> {
    const album = await this.albums.getOwned(albumId, actor);
    const owned = await this.prisma.media.findMany({
      where: { album_id: album.album_id, media_id: { in: dto.mediaIds } },
      select: { media_id: true },
    });
    if (owned.length !== new Set(dto.mediaIds).size) {
      throw new BadRequestException(
        'Todas las imágenes deben pertenecer a este álbum.',
      );
    }
    const result = await this.prisma.media.updateMany({
      where: { album_id: album.album_id, media_id: { in: dto.mediaIds } },
      data: { status: dto.status },
    });
    return { ok: true, updated: result.count };
  }

  /** Aplica un orden nuevo a todas las imágenes de un álbum. */
  async reorder(
    albumId: string,
    actor: AuthenticatedUser,
    dto: ReorderMediaDto,
  ): Promise<{ ok: true }> {
    const album = await this.albums.getOwned(albumId, actor);
    const existing = await this.prisma.media.findMany({
      where: { album_id: album.album_id },
      select: { media_id: true },
    });
    const existingIds = new Set(existing.map((i) => i.media_id));
    if (
      dto.orderedIds.length !== existingIds.size ||
      dto.orderedIds.some((id) => !existingIds.has(id))
    ) {
      throw new BadRequestException(
        'La lista debe contener exactamente las imágenes de este álbum.',
      );
    }
    await this.prisma.$transaction(
      dto.orderedIds.map((id, index) =>
        this.prisma.media.update({
          where: { media_id: id },
          data: { sort_order: index },
        }),
      ),
    );
    return { ok: true };
  }

  /** Borra un elemento: objetos del almacenamiento + fila + ajustes del álbum. */
  async remove(mediaId: string, actor: AuthenticatedUser): Promise<void> {
    const { media } = await this.loadManageable(mediaId, actor);
    const variants = await this.prisma.media_variants.findMany({
      where: { media_id: media.media_id },
    });

    // `storage_key` puede ser `null` (video con transcode a medias);
    // `hls_keys` reúne el master.m3u8 + los stream playlists + todos los
    // segmentos `.ts`.
    const objectKeys = [
      media.storage_key,
      media.poster_key,
      ...media.hls_keys,
      ...variants.map((v) => v.storage_key),
    ].filter((k): k is string => typeof k === 'string' && k.length > 0);
    await Promise.all(objectKeys.map((key) => this.storage.remove(key)));

    await this.prisma.$transaction(async (tx) => {
      // Si esta imagen era la portada, primero se quita la referencia
      // (cover_media_id no tiene FK, pero dejarla apuntando a una imagen
      // borrada confundiría al frontend).
      await tx.albums.updateMany({
        where: { album_id: media.album_id, cover_media_id: media.media_id },
        data: { cover_media_id: null },
      });
      await tx.media.delete({ where: { media_id: media.media_id } });
      await tx.albums.update({
        where: { album_id: media.album_id },
        data: { media_count: { decrement: 1 } },
      });
    });
  }

  /** Carga una imagen y verifica que el actor puede gestionar su álbum. */
  private async loadManageable(mediaId: string, actor: AuthenticatedUser) {
    const media = await this.prisma.media.findUnique({
      where: { media_id: mediaId },
      include: { album: true },
    });
    if (!media) {
      throw new NotFoundException('Imagen no encontrada.');
    }
    if (!this.albums.canManage(media.album, actor)) {
      throw new ForbiddenException('No puedes gestionar esta imagen.');
    }
    return { media, visibility: media.album.visibility as MediaVisibility };
  }

  /** Deja el nombre original del cliente en algo seguro de mostrar/guardar. */
  private sanitizeName(name: string): string {
    return basename(name)
      .replace(/[^\w.\- ]+/g, '_')
      .slice(0, 255);
  }

  /** Forma de salida de un elemento de media, con las URLs de entrega ya resueltas. */
  private toDto(
    media: {
      media_id: string;
      album_id: string;
      kind: 'photo' | 'video';
      storage_key: string | null;
      original_name: string | null;
      mime_type: string;
      width: number;
      height: number;
      bytes: number;
      placeholder: string | null;
      alt_text: string | null;
      caption: string | null;
      sort_order: number;
      status: string;
      rights: Prisma.JsonValue;
      created_at: Date;
      duration_ms?: number | null;
      processing_error?: string | null;
      hls_manifest_key?: string | null;
    },
    variants: { label: string; format: string; storage_key: string; width: number; height: number }[],
    visibility: MediaVisibility,
  ) {
    const processing =
      media.kind === 'video' && !media.storage_key && !media.processing_error;
    return {
      mediaId: media.media_id,
      albumId: media.album_id,
      kind: media.kind,
      originalName: media.original_name,
      mimeType: media.mime_type,
      width: media.width,
      height: media.height,
      bytes: media.bytes,
      placeholder: media.placeholder,
      altText: media.alt_text,
      caption: media.caption,
      sortOrder: media.sort_order,
      status: media.status,
      rights: sanitizeRightsPartial(media.rights),
      createdAt: media.created_at,
      durationMs: media.duration_ms ?? null,
      processing,
      processingError: media.processing_error ?? null,
      urls: {
        // Esta es la vista del Studio (solo dueño/admin): sí se muestra el
        // original/master limpio. No existe aún si el video se está
        // transcodificando (`storage_key` nulo).
        ...(media.storage_key
          ? { original: this.storage.urlFor(media.storage_key, visibility) }
          : {}),
        ...(media.hls_manifest_key
          ? {
              hls: this.storage.urlFor(
                media.hls_manifest_key,
                visibility,
                HLS_URL_TTL,
              ),
            }
          : {}),
        ...Object.fromEntries(
          variants.map((v) => [
            v.label,
            this.storage.urlFor(v.storage_key, visibility),
          ]),
        ),
      },
    };
  }
}

/**
 * TTL (segundos) de las URLs firmadas de los objetos HLS de un álbum privado.
 * Más largo que el de imagen (300 s) porque una reproducción pausada o
 * revisitada seguiría necesitando los segmentos. Para `public`/`unlisted` la
 * URL es estable y esto no aplica.
 */
const HLS_URL_TTL = Math.max(
  600,
  Number(process.env.MEDIA_HLS_URL_TTL_SECONDS) || 3600,
);

/** Bitrate objetivo (kbps) para una altura de rendition HLS. */
function bitrateForHeight(height: number): number {
  if (height <= 360) return 800;
  if (height <= 540) return 1400;
  if (height <= 720) return 2800;
  return 5000;
}

/**
 * Reescribe una playlist HLS: cada línea que no empieza por `#` (y no está
 * vacía) es un nombre de archivo relativo — se sustituye por su URL servida.
 * Las líneas de directiva (`#EXT...`) se dejan igual.
 */
function rewritePlaylist(text: string, urlByName: Map<string, string>): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      return urlByName.get(trimmed) ?? line;
    })
    .join('\n');
}
