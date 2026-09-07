import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  MediaVisibility,
  ObjectStream,
  StorageDriver,
  StoredObject,
} from './storage-driver.interface';
import { signMediaKey } from './media-signing';

/** MIME por extensión canónica — para servir con el `Content-Type` correcto. */
const CONTENT_TYPES: Record<string, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
};

/**
 * Driver de almacenamiento en disco local — el que se usa en desarrollo.
 *
 * Escribe bajo `STORAGE_DISK_ROOT` (un volumen del contenedor). Las URLs que
 * devuelve apuntan de vuelta al backend (`GET /media/:key`), que es quien
 * decide si sirve el archivo o exige una firma.
 */
@Injectable()
export class DiskStorageDriver implements StorageDriver {
  readonly name = 'disk';
  private readonly logger = new Logger(DiskStorageDriver.name);
  private readonly root: string;
  private readonly backendUrl: string;

  constructor() {
    this.root = resolve(process.env.STORAGE_DISK_ROOT ?? '/app/storage');
    this.backendUrl = (process.env.BACKEND_URL ?? 'http://localhost:3050').replace(
      /\/$/,
      '',
    );
  }

  /** Genera una clave opaca y guarda el buffer bajo ella. */
  async put(
    buffer: Buffer,
    opts: { extension: string; contentType: string; visibility: MediaVisibility },
  ): Promise<StoredObject> {
    const key = `${randomUUID()}.${opts.extension}`;
    const fullPath = this.pathFor(key);
    await mkdir(this.root, { recursive: true });
    await writeFile(fullPath, buffer);
    return { key, bytes: buffer.byteLength };
  }

  /** Borra el archivo. No lanza si ya no está. */
  async remove(key: string): Promise<void> {
    try {
      await rm(this.pathFor(key), { force: true });
    } catch (error) {
      this.logger.warn(`No se pudo borrar ${key}: ${(error as Error).message}`);
    }
  }

  /** URL estable servida por `GET /media/:key`. */
  publicUrl(key: string): string {
    return `${this.backendUrl}/media/${encodeURIComponent(key)}`;
  }

  /** Misma ruta, con `exp` + `sig` HMAC en la query. */
  signedUrl(key: string, ttlSeconds: number): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = signMediaKey(key, exp);
    return `${this.backendUrl}/media/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
  }

  /** Abre el archivo para servirlo. `null` si no existe. */
  async read(key: string): Promise<ObjectStream | null> {
    const fullPath = this.pathFor(key);
    let bytes: number;
    try {
      bytes = (await stat(fullPath)).size;
    } catch {
      return null;
    }
    const extension = key.split('.').pop()?.toLowerCase() ?? '';
    return {
      stream: createReadStream(fullPath),
      contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream',
      bytes,
    };
  }

  /**
   * Resuelve la ruta absoluta de una clave.
   *
   * Las claves las genera SIEMPRE este driver con el formato `<uuid>.<ext>`
   * (sin separadores de ruta). Se revalida ese formato aquí porque `pathFor`
   * también recibe la clave que llega por la URL en `GET /media/:key` — así
   * un `../` o una barra nunca llegan al sistema de archivos (path traversal).
   */
  private pathFor(key: string): string {
    // `<uuid>.<ext>` con ext de 2–4 (webp/jpeg/png/avif/mp4/m3u8/ts). Sin
    // separadores de ruta: un `../` o una barra nunca llega al FS.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,4}$/.test(key)) {
      throw new Error('Clave de almacenamiento inválida.');
    }
    return join(this.root, key);
  }
}
