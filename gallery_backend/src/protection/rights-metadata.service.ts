import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** El registro de derechos de una imagen, ya resuelto (fusionado con los defaults del sitio). */
export interface RightsFields {
  rightsHolder: string;
  creator: string;
  creditLine: string;
  rightsStatement: string;
  licenseTerms: string;
  licensorUrl: string;
}

/** Formatos de salida sobre los que se embebe metadato. */
export type EmbeddableFormat = 'jpeg' | 'png' | 'webp';

/**
 * Incrusta el registro de derechos como metadatos **IPTC/XMP** reales en el
 * archivo — legibles por cualquier editor/gestor de fotos, no solo por esta
 * aplicación. Es la mitad "embebido" de la Fase 11 (D10): el pipeline de
 * `sharp` ya quitó TODO el EXIF original (GPS, número de serie, datos
 * personales del disparo); aquí se escriben de vuelta, **desde cero**, solo
 * las etiquetas de derechos que el fotógrafo configuró — nunca datos del
 * archivo original.
 *
 * Usa el binario `exiftool` vía `execFile` (nunca `exec`/una shell) con una
 * lista **fija** de etiquetas: el valor de cada campo es el único dato que
 * viene del usuario, nunca el nombre de la etiqueta ni el comando — así no
 * hay forma de inyectar un argumento o un comando distinto.
 */
@Injectable()
export class RightsMetadataService {
  private readonly logger = new Logger(RightsMetadataService.name);

  /**
   * Embebe los derechos en un buffer de imagen ya procesado.
   *
   * @param buffer - El archivo (original re-codificado o derivado WebP).
   * @param format - Su formato real (decide qué etiquetas aplican).
   * @param rights - Los campos ya resueltos (imagen → si vacíos, defaults del sitio).
   * @returns El mismo archivo con los metadatos incrustados. Si `exiftool`
   *          falla por cualquier motivo, **devuelve el buffer original sin
   *          tocar** — un fallo de metadatos nunca debe tumbar una subida
   *          (mismo principio que el BlurHash).
   */
  async embed(
    buffer: Buffer,
    format: EmbeddableFormat,
    rights: RightsFields,
  ): Promise<Buffer> {
    const args = this.buildArgs(format, rights);
    if (args.length === 0) {
      return buffer; // nada configurado — no vale la pena lanzar el proceso
    }

    const dir = await mkdtemp(join(tmpdir(), 'gallery-meta-'));
    const file = join(dir, `f.${format}`);
    try {
      await writeFile(file, buffer);
      await execFileAsync(
        'exiftool',
        ['-m', '-q', '-P', '-overwrite_original', ...args, file],
        { timeout: 15_000 },
      );
      return await readFile(file);
    } catch (error) {
      this.logger.warn(
        `No se pudieron incrustar los metadatos de derechos: ${(error as Error).message}`,
      );
      return buffer;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Construye la lista de argumentos `-ETIQUETA=valor` de `exiftool`. Cada
   * etiqueta viene de una lista fija en el código; el valor es el único dato
   * del usuario, ya saneado (sin saltos de línea ni caracteres de control).
   */
  private buildArgs(format: EmbeddableFormat, rights: RightsFields): string[] {
    const args: string[] = [];
    const set = (tag: string, value: string) => {
      const clean = this.sanitize(value);
      if (clean) args.push(`-${tag}=${clean}`);
    };

    // XMP — universal (JPEG, PNG, WebP).
    set('XMP-dc:Rights', rights.rightsStatement);
    set('XMP-dc:Creator', rights.creator);
    set('XMP-photoshop:Credit', rights.creditLine);
    set('XMP-xmpRights:UsageTerms', rights.licenseTerms);
    set('XMP-xmpRights:WebStatement', rights.licensorUrl);
    set('XMP-plus:LicensorURL', rights.licensorUrl);

    // Genéricas — exiftool las enruta al contenedor correcto según el formato.
    set('Copyright', rights.rightsStatement);
    set('Artist', rights.creator);

    // IPTC solo tiene sentido en JPEG (el contenedor no existe en PNG/WebP).
    if (format === 'jpeg') {
      set('IPTC:CopyrightNotice', rights.rightsStatement);
    }

    return args;
  }

  /** Quita saltos de línea y caracteres de control; nunca deja pasar un valor vacío tras recortar. */
  private sanitize(value: string): string {
    return value.replace(/[\r\n\x00-\x1f\x7f]+/g, ' ').trim();
  }
}
