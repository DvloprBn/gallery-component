import { slugify, slugifyWithSuffix } from './slug.util';

describe('slug.util', () => {
  it('normaliza acentos, espacios y mayúsculas', () => {
    expect(slugify('Boda en la Playa 2026')).toBe('boda-en-la-playa-2026');
    expect(slugify('  Álbum   de  Otoño  ')).toBe('album-de-otono');
  });

  it('elimina cualquier carácter que no sea [a-z0-9-]', () => {
    expect(slugify('¡Hola! ¿Qué tal? #foto@2026')).toBe('hola-que-tal-foto-2026');
  });

  it('no deja guiones sobrantes en los extremos', () => {
    expect(slugify('--- raro ---')).toBe('raro');
  });

  it('slugifyWithSuffix añade 6 hex y nunca queda vacío', () => {
    const a = slugifyWithSuffix('Mi Álbum');
    expect(a).toMatch(/^mi-album-[0-9a-f]{6}$/);
    const b = slugifyWithSuffix('#$%^&*');
    expect(b).toMatch(/^album-[0-9a-f]{6}$/);
    expect(slugifyWithSuffix('x')).not.toBe(slugifyWithSuffix('x'));
  });
});
