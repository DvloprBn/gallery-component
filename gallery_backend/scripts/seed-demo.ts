/**
 * Siembra una galería de DEMOSTRACIÓN usando el flujo real de la API (login →
 * crear álbum → subir imágenes por el pipeline de verdad). No forma parte del
 * arranque del contenedor — se corre a mano:
 *
 *   docker compose exec gallery_backend npx ts-node scripts/seed-demo.ts
 *
 * Es idempotente: si ya existe un álbum con el slug de demo, no hace nada.
 * Las imágenes son degradados generados con `sharp` (sin archivos externos).
 */
import sharp from 'sharp';

const API = process.env.SEED_DEMO_API ?? 'http://localhost:3040';
const EMAIL = 'usuario+gallery@example.com';
const PASSWORD = 'TestOnly123!';
const DEMO_TITLE = 'Demo — Galería de ejemplo';

/** Paleta de fondos para las imágenes generadas. */
const SWATCHES: { from: string; to: string; label: string }[] = [
  { from: '#0f2027', to: '#2c5364', label: 'Aurora' },
  { from: '#42275a', to: '#734b6d', label: 'Amatista' },
  { from: '#603813', to: '#b29f94', label: 'Arena' },
  { from: '#1f1c2c', to: '#928dab', label: 'Niebla' },
  { from: '#16222a', to: '#3a6073', label: 'Marea' },
  { from: '#334d50', to: '#cbcaa5', label: 'Musgo' },
  { from: '#000428', to: '#004e92', label: 'Abismo' },
  { from: '#8e0e00', to: '#1f1c18', label: 'Brasa' },
];

/** Genera un JPEG con un degradado diagonal y una etiqueta. */
async function makeImage(index: number, w: number, h: number): Promise<Buffer> {
  const s = SWATCHES[index % SWATCHES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${s.from}"/><stop offset="1" stop-color="${s.to}"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <text x="50%" y="52%" font-family="Georgia, serif" font-size="${Math.round(h / 9)}"
      fill="rgba(255,255,255,0.9)" text-anchor="middle">${s.label} ${index + 1}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function main(): Promise<void> {
  // 1. Login (guarda las cookies manualmente).
  const loginRes = await fetch(`${API}/auth/login/step2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login falló: ${loginRes.status}`);
  }
  const cookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) {
    throw new Error('No se recibieron cookies de sesión.');
  }

  // 2. ¿Ya existe el álbum de demo?
  const mine = await (
    await fetch(`${API}/albums`, { headers: { cookie } })
  ).json();
  if (Array.isArray(mine) && mine.some((a: { title: string }) => a.title === DEMO_TITLE)) {
    console.log('El álbum de demo ya existe — nada que hacer.');
    return;
  }

  // 3. Crear el álbum público con un tema propio.
  const albumRes = await fetch(`${API}/albums`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      title: DEMO_TITLE,
      description:
        'Galería de ejemplo: layout masonry, tema personalizado, animaciones de entrada y lightbox.',
      visibility: 'public',
      layout: 'masonry',
      theme: {
        colors: { bg: '#0c0d12', fg: '#f4f4f7', accent: '#8ab4ff' },
        typography: { fontFamily: 'serif', scale: 1.05 },
        layout: { gap: 14, radius: 12, maxColumns: 3 },
        motion: { preset: 'fade-up', stagger: 70, durationMs: 480 },
      },
    }),
  });
  const album = await albumRes.json();
  console.log(`Álbum creado: ${album.album_id} (slug: ${album.slug})`);

  // 4. Subir 8 imágenes por el pipeline real.
  for (let i = 0; i < SWATCHES.length; i++) {
    const landscape = i % 3 !== 0;
    const buffer = await makeImage(
      i,
      landscape ? 1600 : 1200,
      landscape ? 1067 : 1500,
    );
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }),
      `demo-${i + 1}.jpg`,
    );
    const up = await fetch(`${API}/albums/${album.album_id}/images`, {
      method: 'POST',
      headers: { cookie },
      body: form,
    });
    if (!up.ok) {
      throw new Error(`Subida ${i + 1} falló: ${up.status} ${await up.text()}`);
    }
    console.log(`  imagen ${i + 1}/${SWATCHES.length} subida`);
  }

  console.log(
    `\nListo. Abre la galería en:  ${
      process.env.FRONTEND_URL ?? 'http://localhost:3051'
    }/g/${album.slug}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
