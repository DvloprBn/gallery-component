/**
 * Convierte una duración estilo `"15m"` / `"7d"` (el formato que usan las
 * variables `JWT_*_EXPIRES_IN`) a milisegundos, para poder pasarla como
 * `maxAge` de una cookie.
 *
 * Unidades soportadas: `s` (segundos), `m` (minutos), `h` (horas), `d` (días).
 *
 * @param value - La duración, p. ej. `"15m"`.
 * @returns La duración equivalente en milisegundos.
 * @throws Error si el formato no es `<número><unidad>` con una unidad válida.
 */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Duración inválida: "${value}". Formato esperado: <número>(s|m|h|d).`,
    );
  }
  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * unitMs[match[2]];
}

/**
 * Igual que {@link durationToMs} pero en segundos enteros — el formato que
 * espera `expiresIn` de `jsonwebtoken` cuando se le pasa un número.
 *
 * @param value - La duración, p. ej. `"15m"`.
 * @returns Segundos enteros.
 */
export function durationToSeconds(value: string): number {
  return Math.floor(durationToMs(value) / 1000);
}
