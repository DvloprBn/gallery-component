import { Inject, Injectable } from '@nestjs/common';
import {
  STORAGE_DRIVER,
  type MediaVisibility,
  type ObjectStream,
  type StorageDriver,
  type StoredObject,
} from './storage-driver.interface';

/**
 * Fachada de almacenamiento que usa el resto de la aplicación. Delega todo en
 * el driver activo (disco o Cloudinary, según `STORAGE_DRIVER`) — quien la
 * consume no necesita saber cuál está detrás.
 */
@Injectable()
export class StorageService {
  private readonly ttl: number;

  constructor(@Inject(STORAGE_DRIVER) private readonly driver: StorageDriver) {
    this.ttl = Number(process.env.MEDIA_SIGNED_URL_TTL_SECONDS ?? 300);
  }

  /** Nombre del driver activo (para diagnósticos). */
  get driverName(): string {
    return this.driver.name;
  }

  /** Guarda un buffer ya validado y re-codificado. */
  put(
    buffer: Buffer,
    opts: {
      extension: string;
      contentType: string;
      visibility: MediaVisibility;
    },
  ): Promise<StoredObject> {
    return this.driver.put(buffer, opts);
  }

  /** Borra un objeto (idempotente). */
  remove(key: string): Promise<void> {
    return this.driver.remove(key);
  }

  /**
   * Devuelve la URL de entrega adecuada a la visibilidad del álbum.
   *
   * @param key - Clave del objeto.
   * @param visibility - Visibilidad del álbum dueño.
   * @returns URL estable para `public`/`unlisted`; URL firmada de vida corta
   *          para `private`.
   */
  urlFor(key: string, visibility: MediaVisibility, ttlSeconds?: number): string {
    return visibility === 'private'
      ? this.driver.signedUrl(key, ttlSeconds ?? this.ttl)
      : this.driver.publicUrl(key);
  }

  /** Lee un objeto — solo tiene sentido con el driver de disco. */
  read(key: string): Promise<ObjectStream | null> {
    return this.driver.read?.(key) ?? Promise.resolve(null);
  }
}
