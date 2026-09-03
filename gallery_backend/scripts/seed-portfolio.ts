/**
 * Siembra el PORTAFOLIO de demostración: la identidad del sitio (persona
 * ficticia «Mara Solís») y seis colecciones públicas pobladas con **todas** las
 * fotos de la carpeta de origen, subidas por el pipeline real de la API.
 *
 * Se corre **desde el host** (necesita leer la carpeta de imágenes y llegar al
 * backend publicado en el puerto de desarrollo):
 *
 *   npx ts-node gallery_backend/scripts/seed-portfolio.ts
 *
 * Variables opcionales:
 *   SEED_PORTFOLIO_API     — base de la API (por defecto http://localhost:3050)
 *   SEED_PORTFOLIO_IMAGES  — carpeta raíz de imágenes de origen
 *
 * **Convergente, no incremental**: si una colección del portafolio ya existe,
 * se **borra y se vuelve a crear** con el contenido completo de su carpeta —
 * así una segunda corrida siempre deja el set entero, sin huecos ni
 * duplicados. El `PATCH /site` se aplica siempre. Las fotos de origen son de
 * uso libre; el pipeline del backend las re-codifica y les quita los metadatos.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const API = (process.env.SEED_PORTFOLIO_API ?? 'http://localhost:3050').replace(
  /\/$/,
  '',
);
const IMAGES_ROOT =
  process.env.SEED_PORTFOLIO_IMAGES ??
  '/home/bn/DvloprBn/projects/espiral/images/uso_libre';

/** Cuenta sembrada con rol `super` (ver prisma/seed.ts). Solo pruebas locales. */
const EMAIL = 'super+gallery@example.com';
const PASSWORD = 'TestOnly123!';

/** Lado mayor al que se reduce cada foto antes de subirla (para no pasar el tope de subida). */
const MAX_EDGE = 2400;

/** Identidad del sitio — persona ficticia. */
const SITE = {
  siteTitle: 'Mara Solís',
  ownerName: 'Mara Solís',
  tagline:
    'Fotografía documental — la calle, el oficio y lo que la ciudad escribe sobre sí misma.',
  bio:
    'Trabajo en Querétaro desde 2016. Me interesa la gente cuando está concentrada en lo suyo: ' +
    'el patinador midiendo un borde, el tatuador siguiendo una línea, el muro que amanece pintado. ' +
    'Luz disponible, poco equipo, mucho caminar.',
  aboutBody: [
    'Mara Solís (Querétaro, 1990) es fotógrafa documental. Se formó en el taller de imagen del ' +
      'Centro Cultural del Estado y lleva desde 2016 registrando la vida urbana de su ciudad: el ' +
      'skate, el tatuaje, el grafiti y las calles de cantera del centro.',
    'Su trabajo parte de una idea simple: quedarse el tiempo suficiente para que la cámara deje ' +
      'de notarse. Prefiere la luz disponible, los lentes fijos y las series largas —volver al ' +
      'mismo sitio hasta que aparece la foto.',
    'Ha colaborado con revistas independientes y colectivos locales, y su serie «Muros» se ' +
      'expuso en el Festival de Arte Público de Querétaro en 2023. Cuando no está en la calle, ' +
      'imparte un taller mensual de fotografía de calle para principiantes.',
  ].join('\n\n'),
  contactEmail: 'hola@marasolis.mx',
  contactIntro:
    'Encargos editoriales, retrato de oficio y cobertura de eventos culturales. Cuéntame qué ' +
    'tienes en mente y para cuándo.',
  instagram: '@marasolis.foto',
};

/** Tema base común a todas las colecciones — solo cambia el acento. */
function themeFor(accent: string) {
  return {
    colors: { bg: '#0b0b0f', fg: '#f5f5f7', accent },
    typography: { fontFamily: 'serif', scale: 1.05 },
    layout: { gap: 12, radius: 4, maxColumns: 3 },
    motion: { preset: 'fade-up', stagger: 60, durationMs: 460 },
  };
}

/**
 * Las seis colecciones y su(s) carpeta(s) de origen (relativas a
 * `IMAGES_ROOT`). `'.'` = los archivos sueltos en la raíz. Se sube **todo** el
 * contenido de cada carpeta, en orden alfabético.
 */
const COLLECTIONS: {
  title: string;
  description: string;
  dirs: string[];
  layout: 'masonry' | 'justified' | 'grid' | 'carousel';
  featured: boolean;
  accent: string;
}[] = [
  {
    title: 'Calle',
    description: 'Patinetas, concreto y la coreografía de esperar el turno.',
    dirs: ['Skate'],
    layout: 'justified',
    featured: true,
    accent: '#ff5d3a',
  },
  {
    title: 'Tinta',
    description: 'El oficio del tatuaje de cerca: la línea, la mano firme, la piel.',
    dirs: ['tatoos'],
    layout: 'grid',
    featured: true,
    accent: '#8ab4ff',
  },
  {
    title: 'Muros',
    description:
      'Lo que la ciudad escribe sobre sí misma, antes de que la repinten.',
    dirs: ['grafitti'],
    layout: 'masonry',
    featured: true,
    accent: '#f2c14e',
  },
  {
    title: 'Humo',
    description: 'Un estudio de forma: humo, aire y luz de ventana.',
    dirs: ['smoke'],
    layout: 'carousel',
    featured: true,
    accent: '#c9a2ff',
  },
  {
    title: 'Ciudad',
    description: 'Querétaro a pie: cantera, sombra y la rutina de los portales.',
    dirs: ['Qro', 'varias', 'espirales'],
    layout: 'masonry',
    featured: false,
    accent: '#7fd1c4',
  },
  {
    title: 'Cuaderno',
    description: 'El cuaderno de trabajo: lo que no entró en ninguna serie.',
    dirs: ['.'],
    layout: 'justified',
    featured: false,
    accent: '#9aa4b2',
  },
];

const IMG_RE = /\.(jpe?g|png|webp)$/i;

/** Lista, en orden alfabético, los archivos de imagen de varias carpetas (`'.'` = la raíz). */
async function listImages(dirs: string[]): Promise<string[]> {
  const all: string[] = [];
  for (const dir of dirs) {
    const full = dir === '.' ? IMAGES_ROOT : join(IMAGES_ROOT, dir);
    const entries = (await readdir(full, { withFileTypes: true }))
      .filter((e) => e.isFile() && IMG_RE.test(e.name))
      .map((e) => e.name)
      .sort();
    all.push(...entries.map((name) => join(full, name)));
  }
  return all;
}

/** Reduce una foto a JPEG ≤ MAX_EDGE px, ya orientada según su EXIF. */
async function prepare(path: string): Promise<Buffer> {
  return sharp(await readFile(path))
    .rotate()
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82 })
    .toBuffer();
}

/** Cliente HTTP mínimo con cookie de sesión. */
class Api {
  constructor(private cookie = '') {}

  async login(): Promise<void> {
    const res = await fetch(`${API}/auth/login/step2`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`Login falló: ${res.status} ${await res.text()}`);
    this.cookie = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0]).join('; ');
    if (!this.cookie) throw new Error('No se recibieron cookies de sesión.');
  }

  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init, headers: { ...(init.headers ?? {}), cookie: this.cookie },
    });
    if (!res.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  postJson<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  patchJson<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async upload(albumId: string, buffer: Buffer, name: string): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), name);
    const res = await fetch(`${API}/albums/${albumId}/images`, {
      method: 'POST', headers: { cookie: this.cookie }, body: form,
    });
    if (!res.ok) throw new Error(`Subida "${name}" → ${res.status} ${await res.text()}`);
  }
}

interface AlbumRow {
  album_id: string;
  slug: string;
  title: string;
  image_count: number;
  cover_image_id: string | null;
}
interface ImageRow { imageId: string }

async function main(): Promise<void> {
  const api = new Api();
  await api.login();
  console.log(`Sesión iniciada como ${EMAIL}.`);

  // 1. Identidad del sitio (siempre).
  await api.patchJson('/site', SITE);
  console.log('Identidad del sitio fijada (Mara Solís).');

  const existing = await api.json<AlbumRow[]>('/albums');
  const byTitle = new Map(existing.map((a) => [a.title, a]));
  const portfolioTitles = new Set(COLLECTIONS.map((c) => c.title));

  // El hero cuelga de una foto; si vamos a recrear "Calle", primero lo soltamos
  // para que el borrado no falle por la referencia.
  if (COLLECTIONS.some((c) => c.title === 'Calle' && byTitle.has('Calle'))) {
    await api.patchJson('/site', { heroImageId: null });
  }

  let heroAlbumSlug: string | null = null;
  let total = 0;

  for (const col of COLLECTIONS) {
    // Convergente: si ya existe, se borra y se rehace con el contenido completo.
    const prev = byTitle.get(col.title);
    if (prev) {
      await api.json(`/albums/${prev.album_id}`, { method: 'DELETE' });
      console.log(`» "${col.title}" existía — borrada para rehacerla.`);
    }

    const album = await api.postJson<AlbumRow>('/albums', {
      title: col.title,
      description: col.description,
      visibility: 'public',
      layout: col.layout,
      featured: col.featured,
      theme: themeFor(col.accent),
    });

    const files = await listImages(col.dirs);
    console.log(`» "${col.title}" (slug: ${album.slug}) — ${files.length} fotos`);
    let i = 0;
    for (const file of files) {
      i += 1;
      await api.upload(album.album_id, await prepare(file), `${album.slug}-${i}.jpg`);
      process.stdout.write(`\r   subiendo ${i}/${files.length}…`);
    }
    process.stdout.write('\n');
    total += files.length;

    const images = await api.json<ImageRow[]>(`/albums/${album.album_id}/images`);
    if (images.length > 0) {
      await api.patchJson(`/albums/${album.album_id}`, {
        coverImageId: images[0].imageId,
      });
    }
    if (col.title === 'Calle') heroAlbumSlug = album.slug;
  }

  // 2. Hero de la portada — una foto de "Calle".
  if (heroAlbumSlug) {
    const gallery = await api.json<{ images: ImageRow[] }>(`/g/${heroAlbumSlug}`);
    const pick = gallery.images[Math.min(2, gallery.images.length - 1)];
    if (pick) {
      await api.patchJson('/site', { heroImageId: pick.imageId });
      console.log('Hero de la portada fijado.');
    }
  }

  // Aviso si quedaron álbumes del portafolio de una versión anterior con otro título.
  const stale = existing.filter(
    (a) => !portfolioTitles.has(a.title) && a.title !== 'Demo — Galería de ejemplo',
  );
  if (stale.length > 0) {
    console.log(
      `\nNota: hay ${stale.length} álbum(es) ajenos al portafolio actual: ` +
        stale.map((a) => `"${a.title}"`).join(', '),
    );
  }

  console.log(
    `\nListo — ${total} fotos en ${COLLECTIONS.length} colecciones. ` +
      `Abre  ${process.env.FRONTEND_URL ?? 'http://localhost:3051'}/`,
  );
}

main().catch((error) => {
  console.error('\nseed-portfolio falló:', error);
  process.exitCode = 1;
});
