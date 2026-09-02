import { randomBytes } from 'node:crypto';

/**
 * Convierte un texto a un slug seguro para URL: minúsculas, sin acentos, con
 * guiones en vez de espacios, y solo `[a-z0-9-]`.
 *
 * @param input - El texto de origen (p. ej. el título del álbum).
 * @returns El slug base, sin sufijo de unicidad. Puede quedar vacío si el
 *          texto no tenía ningún carácter alfanumérico.
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita los diacríticos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

/**
 * Slug con un sufijo aleatorio corto, para garantizar unicidad sin tener que
 * consultar la base de datos en un bucle.
 *
 * @param input - El texto de origen.
 * @returns `<slug>-<6 hex>`, o `album-<6 hex>` si el slug base queda vacío.
 */
export function slugifyWithSuffix(input: string): string {
  const base = slugify(input) || 'album';
  return `${base}-${randomBytes(3).toString('hex')}`;
}
