import type { Readable } from 'node:stream';

/** Visibilidad de un objeto — la hereda del álbum al que pertenece. */
export type MediaVisibility = 'public' | 'unlisted' | 'private';

/** Resultado de guardar un objeto. */
export interface StoredObject {
  /** Clave opaca con la que el objeto se recupera. Nunca contiene datos del cliente. */
  key: string;
  /** Tamaño en bytes de lo que quedó guardado. */
  bytes: number;
}

/** Lo que se necesita para leer un objeto de vuelta (solo lo usa el driver de disco). */
export interface ObjectStream {
  stream: Readable;
  contentType: string;
  bytes: number;
}

/**
 * Contrato de almacenamiento. La lógica de negocio (subida, álbumes, entrega)
 * habla SIEMPRE contra esta interfaz — nunca sabe si detrás hay disco local o
 * Cloudinary. Cambiar de proveedor es cambiar la implementación, no el código.
 */
export interface StorageDriver {
  /** Nombre del driver, para logs. */
  readonly name: string;

  /**
   * Guarda un buffer y devuelve su clave opaca.
   *
   * @param buffer - Bytes ya validados y re-codificados (nunca el archivo crudo del cliente).
   * @param opts.extension - Extensión canónica sin punto (`webp`, `jpeg`, `png`, `avif`).
   * @param opts.contentType - MIME real del contenido.
   * @param opts.visibility - Visibilidad del álbum dueño (Cloudinary la usa para `type`).
   */
  put(
    buffer: Buffer,
    opts: {
      extension: string;
      contentType: string;
      visibility: MediaVisibility;
    },
  ): Promise<StoredObject>;

  /**
   * Borra un objeto. No lanza si la clave ya no existe (borrado idempotente).
   *
   * @param key - La clave devuelta por `put`.
   */
  remove(key: string): Promise<void>;

  /**
   * URL de entrega para un objeto de álbum `public` / `unlisted`.
   *
   * @param key - La clave del objeto.
   * @returns URL estable, cacheable.
   */
  publicUrl(key: string): string;

  /**
   * URL de entrega de **vida corta** para un objeto de álbum `private`.
   * Quien la genera ya verificó que el solicitante tiene acceso.
   *
   * @param key - La clave del objeto.
   * @param ttlSeconds - Segundos de validez.
   * @returns URL firmada que caduca.
   */
  signedUrl(key: string, ttlSeconds: number): string;

  /**
   * Lee un objeto (solo el driver de disco lo implementa; Cloudinary sirve
   * desde su CDN y no pasa por el backend).
   *
   * @param key - La clave del objeto.
   * @returns El stream + metadatos, o `null` si no existe.
   */
  read?(key: string): Promise<ObjectStream | null>;
}

/** Token de inyección del driver activo. */
export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
