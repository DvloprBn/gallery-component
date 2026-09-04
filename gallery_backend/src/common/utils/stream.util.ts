import type { Readable } from 'node:stream';

/**
 * Junta un stream legible en un solo `Buffer`. Se usa para volver a leer un
 * objeto ya guardado (p. ej. el original limpio, al regenerar derivados) —
 * nunca para servir una respuesta HTTP, donde sí interesa transmitir en
 * streaming.
 *
 * @param stream - El stream a consumir por completo.
 * @returns Todos sus bytes juntos.
 */
export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
