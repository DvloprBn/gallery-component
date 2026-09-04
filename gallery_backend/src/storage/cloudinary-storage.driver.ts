import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import type {
  MediaVisibility,
  ObjectStream,
  StorageDriver,
  StoredObject,
} from './storage-driver.interface';

/**
 * Driver de almacenamiento en Cloudinary — el de producción.
 *
 * Cloudinary es almacén + CDN + entrega. **No es el límite de seguridad**: el
 * backend ya validó por contenido y re-codificó con `sharp` antes de llamar
 * aquí. Se le sube el derivado limpio con:
 *  - `type: 'authenticated'` para álbumes privados → solo accesible con una
 *    URL firmada de vida corta que genera este backend.
 *  - `type: 'upload'` para public / unlisted → entrega directa por el CDN.
 * `allowed_formats` es una defensa en profundidad (aunque nunca debería
 * dispararse, porque lo que sube ya pasó por `sharp`).
 */
@Injectable()
export class CloudinaryStorageDriver implements StorageDriver {
  readonly name = 'cloudinary';
  private readonly logger = new Logger(CloudinaryStorageDriver.name);
  private readonly folder: string;

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    this.folder = process.env.CLOUDINARY_FOLDER ?? 'gallery';
  }

  /** Sube el buffer. La `key` que devuelve es el `public_id` completo. */
  async put(
    buffer: Buffer,
    opts: { extension: string; contentType: string; visibility: MediaVisibility },
  ): Promise<StoredObject> {
    const deliveryType = opts.visibility === 'private' ? 'authenticated' : 'upload';
    const publicId = `${this.folder}/${randomUUID()}`;

    const result = await new Promise<{ public_id: string; bytes: number }>(
      (resolvePromise, rejectPromise) => {
        cloudinary.uploader
          .upload_stream(
            {
              public_id: publicId,
              resource_type: 'image',
              type: deliveryType,
              overwrite: false,
              allowed_formats: ['webp', 'jpg', 'jpeg', 'png', 'avif'],
              format: opts.extension === 'jpeg' ? 'jpg' : opts.extension,
            },
            (error, uploaded) => {
              if (error || !uploaded) {
                rejectPromise(error ?? new Error('Subida a Cloudinary sin resultado.'));
                return;
              }
              resolvePromise({
                public_id: uploaded.public_id,
                bytes: uploaded.bytes,
              });
            },
          )
          .end(buffer);
      },
    );

    // La key guarda también el tipo de entrega, para reconstruir la URL luego.
    return { key: `${deliveryType}:${result.public_id}`, bytes: result.bytes };
  }

  /** Borra el recurso en Cloudinary. Idempotente. */
  async remove(key: string): Promise<void> {
    const { deliveryType, publicId } = this.parseKey(key);
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: 'image',
        type: deliveryType,
        invalidate: true,
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo borrar ${publicId} en Cloudinary: ${(error as Error).message}`,
      );
    }
  }

  /** URL de entrega directa (solo válida para recursos `type: upload`). */
  publicUrl(key: string): string {
    const { deliveryType, publicId } = this.parseKey(key);
    return cloudinary.url(publicId, { type: deliveryType, secure: true });
  }

  /** URL firmada con expiración (para recursos `type: authenticated`). */
  signedUrl(key: string, ttlSeconds: number): string {
    const { deliveryType, publicId } = this.parseKey(key);
    return cloudinary.url(publicId, {
      type: deliveryType,
      secure: true,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
    });
  }

  /**
   * Relee un objeto ya subido — hace falta para regenerar derivados (Fase 11)
   * y para entregar el original bajo licencia (Fase 12c), donde el backend
   * necesita los bytes de vuelta, no solo una URL para el navegador.
   * Cloudinary no expone un "descargar tal cual" nativo por SDK aquí, así que
   * se baja por HTTPS desde su propia URL (firmada si el recurso es
   * `authenticated`) — la misma URL que ya se sabe construir para servir.
   *
   * @param key - La clave devuelta por `put` (`"<deliveryType>:<publicId>"`).
   * @returns El stream + metadatos, o `null` si Cloudinary respondió con error.
   */
  async read(key: string): Promise<ObjectStream | null> {
    const { deliveryType } = this.parseKey(key);
    const url =
      deliveryType === 'authenticated' ? this.signedUrl(key, 120) : this.publicUrl(key);
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        this.logger.warn(`No se pudo releer ${key} de Cloudinary: HTTP ${response.status}`);
        return null;
      }
      return {
        stream: Readable.fromWeb(response.body as never),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
        bytes: Number(response.headers.get('content-length') ?? 0),
      };
    } catch (error) {
      this.logger.warn(`No se pudo releer ${key} de Cloudinary: ${(error as Error).message}`);
      return null;
    }
  }

  /** Separa `"<deliveryType>:<publicId>"`. */
  private parseKey(key: string): { deliveryType: string; publicId: string } {
    const idx = key.indexOf(':');
    if (idx === -1) {
      return { deliveryType: 'upload', publicId: key };
    }
    return { deliveryType: key.slice(0, idx), publicId: key.slice(idx + 1) };
  }
}
