/**
 * Pruebas de seguridad de la Fase 10 (`/site` + `/contact`) contra el backend
 * en vivo — replicables (ver `PRUEBAS_SEGURIDAD.md`, bloque S1–S13).
 *
 *   node gallery_backend/scripts/probe-fase10.mjs
 *
 * Usa las cuentas del seed (`usuario`/`admin`/`super` + `TestOnly123!`).
 * No deja basura: restaura `site_settings` y borra los mensajes/álbumes de
 * prueba al terminar. Nota: S11 (throttle) necesita una ventana de 1 min
 * limpia — si se re-corre enseguida, S8/S9 pueden verse afectadas por el 429.
 */
const API = process.env.API ?? 'http://localhost:3050';
let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  (cond ? pass++ : fail++);
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!cond) console.error(`  !! ${name} ${detail}`);
}
async function login(email) {
  const r = await fetch(`${API}/auth/login/step2`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestOnly123!' }),
  });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return (r.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
}
const j = (cookie, extra = {}) => ({ cookie, 'Content-Type': 'application/json', ...extra });

const anon = '';
const usuario = await login('usuario+gallery@example.com');
const admin = await login('admin+gallery@example.com');
const superc = await login('super+gallery@example.com');

// ── snapshot de site_settings para restaurar al final ──
const snap = await (await fetch(`${API}/site`)).json();

// ═══ 1. GET /site — público, sin campos sensibles ═══
{
  const r = await fetch(`${API}/site`);
  const body = await r.json();
  check('1.1 GET /site sin sesión → 200', r.status === 200);
  const keys = Object.keys(body).sort().join(',');
  check('1.2 GET /site no expone id/updatedAt/ip', !/(^|,)(id|updatedAt|updated_at)(,|$)/.test(keys), keys);
}

// ═══ 2. PATCH /site — RBAC ═══
{
  const anonR = await fetch(`${API}/site`, { method: 'PATCH', headers: j(anon), body: '{"tagline":"x"}' });
  check('2.1 PATCH /site sin sesión → 401', anonR.status === 401, `got ${anonR.status}`);
  const userR = await fetch(`${API}/site`, { method: 'PATCH', headers: j(usuario), body: '{"tagline":"x"}' });
  check('2.2 PATCH /site como usuario → 403', userR.status === 403, `got ${userR.status}`);
  const adminR = await fetch(`${API}/site`, { method: 'PATCH', headers: j(admin), body: JSON.stringify({ tagline: snap.tagline }) });
  check('2.3 PATCH /site como admin → 200', adminR.status === 200, `got ${adminR.status}`);
}

// ═══ 3. PATCH /site — validación del heroImageId ═══
{
  // 3.1 UUID inexistente → 400
  const ghost = await fetch(`${API}/site`, { method: 'PATCH', headers: j(superc),
    body: JSON.stringify({ heroImageId: '00000000-0000-4000-8000-000000000000' }) });
  check('3.1 heroImageId inexistente → 400', ghost.status === 400, `got ${ghost.status}`);

  // 3.2 imagen de un álbum NO público → 400
  const priv = await (await fetch(`${API}/albums`, { method: 'POST', headers: j(superc),
    body: JSON.stringify({ title: `probe-priv-${Date.now()}`, visibility: 'private', layout: 'grid' }) })).json();
  // subir 1 imagen mínima (PNG 1x1) por el pipeline
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
  const up = await fetch(`${API}/albums/${priv.album_id}/images`, { method: 'POST', headers: { cookie: superc }, body: fd });
  const img = await up.json();
  const privHero = await fetch(`${API}/site`, { method: 'PATCH', headers: j(superc),
    body: JSON.stringify({ heroImageId: img.imageId ?? img.image_id }) });
  check('3.2 heroImageId de álbum privado → 400', privHero.status === 400, `got ${privHero.status}`);
  await fetch(`${API}/albums/${priv.album_id}`, { method: 'DELETE', headers: { cookie: superc } });

  // 3.3 null limpia el hero sin romper
  const clr = await fetch(`${API}/site`, { method: 'PATCH', headers: j(superc), body: '{"heroImageId":null}' });
  const clrBody = await clr.json();
  check('3.3 heroImageId:null → 200 y hero=null', clr.status === 200 && clrBody.hero === null, `got ${clr.status}`);
}

// ═══ 4. GET /galleries?featured=true — no filtra no-públicas ═══
{
  const unl = await (await fetch(`${API}/albums`, { method: 'POST', headers: j(superc),
    body: JSON.stringify({ title: `probe-unlisted-${Date.now()}`, visibility: 'unlisted', layout: 'grid', featured: true }) })).json();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
  await fetch(`${API}/albums/${unl.album_id}/images`, { method: 'POST', headers: { cookie: superc }, body: fd });
  const feat = await (await fetch(`${API}/galleries?featured=true`)).json();
  check('4.1 unlisted+featured NO aparece en ?featured=true',
    !feat.some((c) => c.slug === unl.slug), `slugs: ${feat.map((c) => c.slug).join(',')}`);
  await fetch(`${API}/albums/${unl.album_id}`, { method: 'DELETE', headers: { cookie: superc } });
}

// ═══ 5. POST /contact — honeypot ═══
const created = [];
{
  const hp = await fetch(`${API}/contact`, { method: 'POST', headers: j(anon),
    body: JSON.stringify({ name: 'Bot', email: 'bot@x.com', message: 'hola '.repeat(5), website: 'http://spam.example' }) });
  check('5.1 honeypot relleno → 202', hp.status === 202, `got ${hp.status}`);
  const before = await (await fetch(`${API}/contact/messages`, { headers: { cookie: admin } })).json();
  check('5.2 honeypot NO deja fila', !before.some((m) => m.email === 'bot@x.com'), `filas bot: ${before.filter((m) => m.email === 'bot@x.com').length}`);
}

// ═══ 6. POST /contact — mensaje válido + XSS almacenado ═══
{
  const xss = '<script>alert(1)</script> <img src=x onerror=alert(2)>';
  const ok = await fetch(`${API}/contact`, { method: 'POST', headers: j(anon),
    body: JSON.stringify({ name: 'Ana <b>', email: 'Ana@Example.COM', message: `probe ${xss} ${'x'.repeat(20)}` }) });
  check('6.1 mensaje válido → 202', ok.status === 202, `got ${ok.status}`);
  const list = await (await fetch(`${API}/contact/messages`, { headers: { cookie: admin } })).json();
  const mine = list.find((m) => m.email === 'ana@example.com');
  created.push(...list.filter((m) => m.email === 'ana@example.com').map((m) => m.messageId));
  check('6.2 email normalizado a minúsculas', !!mine, `emails: ${list.slice(0,3).map((m) => m.email)}`);
  check('6.3 body se guarda crudo (el escape es en la capa de salida)', mine && mine.body.includes('<script>'), 'ok si crudo en DB');
  check('6.4 MessageView NO incluye ip_address', mine && !('ipAddress' in mine) && !('ip_address' in mine), Object.keys(mine ?? {}).join(','));
}

// ═══ 7. POST /contact — validación de entrada ═══
{
  const long = await fetch(`${API}/contact`, { method: 'POST', headers: j(anon),
    body: JSON.stringify({ name: 'A', email: 'a@b.com', message: 'x'.repeat(4001) }) });
  check('7.1 message > 4000 → 400', long.status === 400, `got ${long.status}`);
  const bad = await fetch(`${API}/contact`, { method: 'POST', headers: j(anon),
    body: JSON.stringify({ name: 'A', email: 'no-es-email', message: 'x'.repeat(20) }) });
  check('7.2 email inválido → 400', bad.status === 400, `got ${bad.status}`);
  const extra = await fetch(`${API}/contact`, { method: 'POST', headers: j(anon),
    body: JSON.stringify({ name: 'A', email: 'a@b.com', message: 'x'.repeat(20), is_read: true, messageId: 'x' }) });
  check('7.3 campos extra (whitelist) → 400', extra.status === 400, `got ${extra.status}`);
}

// ═══ 8. /contact/messages — RBAC + ParseUUID ═══
{
  const anonL = await fetch(`${API}/contact/messages`, { headers: { cookie: anon } });
  check('8.1 GET /contact/messages sin sesión → 401', anonL.status === 401, `got ${anonL.status}`);
  const userL = await fetch(`${API}/contact/messages`, { headers: { cookie: usuario } });
  check('8.2 GET /contact/messages como usuario → 403', userL.status === 403, `got ${userL.status}`);
  const userD = await fetch(`${API}/contact/messages/${created[0] ?? '11111111-1111-4111-8111-111111111111'}`, { method: 'DELETE', headers: { cookie: usuario } });
  check('8.3 DELETE /contact/messages/:id como usuario → 403', userD.status === 403, `got ${userD.status}`);
  const badId = await fetch(`${API}/contact/messages/no-uuid`, { method: 'PATCH', headers: j(admin), body: '{"read":true}' });
  check('8.4 PATCH con :id no-UUID → 400', badId.status === 400, `got ${badId.status}`);
}

// ═══ 9. POST /contact — throttle (5/min) ═══
{
  let codes = [];
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${API}/contact`, { method: 'POST', headers: j(anon),
      body: JSON.stringify({ name: 'T', email: `t${i}@b.com`, message: 'throttle probe xxxxx' }) });
    codes.push(r.status);
  }
  check('9.1 ráfaga de 7 → aparece 429', codes.includes(429), `codes: ${codes.join(',')}`);
  // recoger para limpiar
  const list = await (await fetch(`${API}/contact/messages`, { headers: { cookie: admin } })).json();
  created.push(...list.filter((m) => /^t\d@b\.com$/.test(m.email)).map((m) => m.messageId));
}

// ── limpieza ──
for (const id of [...new Set(created)]) {
  await fetch(`${API}/contact/messages/${id}`, { method: 'DELETE', headers: { cookie: superc } });
}
await fetch(`${API}/site`, { method: 'PATCH', headers: j(superc), body: JSON.stringify({
  siteTitle: snap.siteTitle, ownerName: snap.ownerName, tagline: snap.tagline, bio: snap.bio,
  aboutBody: snap.aboutBody, contactEmail: snap.contactEmail, contactIntro: snap.contactIntro,
  instagram: snap.instagram, heroImageId: snap.hero?.imageId ?? null,
}) });
const restored = await (await fetch(`${API}/site`)).json();
check('CLEANUP site_settings restaurado', restored.hero?.imageId === (snap.hero?.imageId ?? undefined) || (!restored.hero && !snap.hero), `hero ${restored.hero?.imageId}`);

console.log('\n' + results.join('\n'));
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
