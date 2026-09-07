# Estado del Proyecto — Galería

> Bitácora de estado día a día. Se actualiza cada vez que se pide o al cerrar un hito.
> La estrategia y las decisiones que no cambian seguido viven en `PLAN_DESARROLLO.md`.

Última actualización: **2026-09-07**

---

## 1. Dónde estamos

**Todas las fases + Fase 12 completa (12a–12d) + Fase 14 COMPLETA (14a–14d: video de punta a punta, 2026-09-07).**

**Fase 14d — licenciamiento de video + hero en video (2026-09-07).** Cierra la Fase 14. El backend
ya trataba el video en `consumeDelivery` desde 14b — la 14d lo **verifica de punta a punta en vivo**
y ajusta el resto: `LicenseRequestForm` y los correos de `LicensingService` dicen "este video" /
"un video de…" según `media.kind`; el flujo (endpoint, honeypot, throttle, validación) no cambia.
Hero en video: `PATCH /site` valida que el video esté procesado (`storage_key`); `HeroMedia` gana
`kind` y para un hero video expone `preview` + `hls` (nunca `original` — D9); frontend
`HeroMedia.tsx` (nuevo) pinta `<video autoplay muted loop>` salvo `prefers-reduced-motion` (→ póster
en pausa). **Verificado en vivo**: `verify-14d.mjs` 14/14 (solicitar licencia de un video →
cotizar → aceptar → **1ª descarga = master MP4 720p limpio con `Content-Disposition: attachment` y
la nota del licenciatario incrustada** → 2ª descarga 404 → `fulfilled`; el token se sacó con un
`logger.warn` temporal, quitado antes del commit); `verify-14d-hero.mjs` 6/6 (video sin procesar →
400; procesado → 200; `GET /site` `hero.kind='video'` con `preview`+`hls` sin `original`). Nuevo
test unitario de `consumeDelivery` para el caso video. **111 tests / 16 suites**; `next build` prod
OK. **Fase 14 completa** (14a modelo → 14b pipeline → 14c marca+HLS → 14d venta+hero). Detalle en
`DOCUMENTO_VIVO_ARQUITECTURA.md` §23.

**Fase 14c — marca de agua sobre el video + HLS adaptativo (2026-09-07).** `WatermarkService.buildFrameOverlay(w,h)`
(nuevo): PNG RGBA del tamaño exacto de una rendition con la marca ya estampada; `ffmpeg` lo aplica
con `overlay=0:0`. Se estampa en el póster (4 WebP), el `preview` y **todas** las renditions HLS —
nunca el master (D9), solo en álbumes `public`. `VideoPipelineService`: `buildRendition()` (escala a
tamaño exacto + marca + GOP alineado a 2 s) y `packageHls()` (un `ffmpeg -c copy` con
`-var_stream_map` → `master.m3u8` + `stream_N.m3u8` + `seg_N_*.ts`). Alturas 360/540/720/1080 que
quepan bajo el master, más la del master. El job sube segmentos y **reescribe las playlists** para
que apunten a las URLs servidas (las claves del almacenamiento son opacas); todas las claves HLS
van a `media.hls_keys String[]` (migración `20260907160000_media_hls_keys`) para poder borrarlas al
eliminar el elemento/álbum. `urls.hls` (el `master.m3u8`) se expone en `GET /g/:slug` y el Studio;
el `preview` MP4 sigue como respaldo. Frontend: `Lightbox` usa HLS nativo (Safari) o **`hls.js`**
(cargado de `cdnjs`, `enableWorker:false`), con caída al `preview` ante error fatal. **Bug propio
corregido**: `GET /media/:key` resolvía la visibilidad buscando la clave en `storage_key`/variantes
— los objetos HLS viven en `hls_keys` → todas las URLs HLS daban 404; `visibilityOfKey` gana una
búsqueda `hls_keys: { has: key }`. `DiskStorageDriver`: regex de clave a `[a-z0-9]{2,4}` (el `.ts`
tiene 2 chars) + `m3u8→application/vnd.apple.mpegurl`, `ts→video/mp2t`. URLs firmadas de álbum
privado: TTL más largo para HLS (`MEDIA_HLS_URL_TTL_SECONDS`, 3600 s). CSP gana `cdnjs` en
`script-src`. **Verificado**: 110 tests / 16 suites (nuevos: `buildRendition`/`packageHls` +
`buildFrameOverlay`, todo con `ffmpeg` real); `next build` prod OK; `verify-14c.mjs` **14/14** en
vivo (video 720p → 3 renditions; `master.m3u8` con URLs http absolutas; `.ts` sirve como MPEG-TS
`0x47`/`video/mp2t`; galería pública con `urls.hls`+`urls.preview` sin `original`; al borrar, los
`.ts` dan 404); `verify-14b.mjs` 13/13, `probe-fase10.mjs` 24/24. **No verificado en navegador
real** (sin herramienta de browser): la reproducción visual con `hls.js` no se comprobó en un
navegador, sí el flujo por API. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §22.

**Fase 14b — pipeline de video (2026-09-07).** Ya se puede subir un video, se valida por contenido
con `ffprobe` (contenedor, duración ≤120 s, resolución ≤1080p, tamaño ≤200 MiB, frame rate, número
de pistas), se crea la fila `media` (`kind=video`, `storage_key` anulable hasta que exista el
master) y se **transcodifica en segundo plano** (cola de concurrencia 1, progreso en memoria):
master limpio `libx264 -crf 18 -map_metadata -1` (nunca público), fotograma de portada → 4 WebP +
BlurHash por el pipeline de imagen, preview MP4 ≤720p `+faststart`, y derechos incrustados con
`exiftool` en master y preview (`EmbeddableFormat` gana `'mp4'`). `GET /media/:id/processing` para
que el Studio muestre "Procesando…" y refresque. Frontend: `<video controls>` en el lightbox para
`kind==='video'`, distintivo ▶ + duración en la miniatura, subida de video en el Studio. Sin marca
de agua ni HLS todavía (14c) — pero el master ya se entrega correctamente bajo licencia
(`consumeDelivery` reconoce `kind='video'`). Dependencia nueva: `ffmpeg` en los Dockerfiles.
`ffprobe` no acepta `-nostdin` (fue un tropiezo). `DiskStorageDriver` aceptaba solo extensiones
`[a-z]{3,4}` → `mp4` fallaba; corregido a `[a-z0-9]{3,4}` + `mp4→video/mp4`. CSP gana `media-src`.
**Verificado**: 107 tests / 16 suites (nuevo `video-pipeline.service.spec.ts` con `ffmpeg` real);
`next build` prod OK (16 rutas); `verify-14b.mjs` 13/13 en vivo (rechazo de no-video, subida real →
procesado → publicado → `GET /g/:slug` con `kind=video` y `preview`, sin `original`; el preview
descarga como MP4 real); `exiftool` confirma los derechos en el preview servido; `probe-fase10.mjs`
24/24. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §21.

**Fase 14a — refactor `images` → `media` (2026-09-05).** Primer tramo de la Fase 14 (video):
preparar el modelo sin añadir video todavía. Migración `20260905120000_media_unification` escrita a
mano (`ALTER TABLE … RENAME`, no destructiva — Prisma habría hecho DROP/CREATE y borrado las 244
fotos ya sembradas): tablas `images`→`media` / `image_variants`→`media_variants`, columnas
`image_id`→`media_id` / `cover_image_id`→`cover_media_id` / `image_count`→`media_count` /
`hero_image_id`→`hero_media_id`, más `enum media_kind` + `media.kind` (`DEFAULT 'photo'`). Rutas
`/albums/:id/images*`→`/media*` y `/images/:id`→`/media/:id`; `GET /g/:slug` devuelve
`{ album, media: [...] }`; campos de payload `imageId`→`mediaId`, `imageIds`→`mediaIds`,
`coverImageId`→`coverMediaId`, `heroImageId`→`heroMediaId`, etc.; tipos del frontend
(`ImageDto`→`MediaDto`, `GalleryImage`→`GalleryMedia`), `ImageGrid`→`MediaGrid`. Se dejó a
propósito el nombre del módulo NestJS `src/images/` + `ImagesService` (renombrarlo choca con el
`MediaModule`/`MediaService` de entrega ya existentes; no es contrato), y `status`/`sort_order` sin
convertir (no hacen falta para video). **Verificado**: BD migrada con 244 media / 976 variants
intactos; `tsc` back y front limpios; 101 tests / 15 suites; `next build` prod OK (16 rutas);
`verify-14a.mjs` 17/17 en vivo (galería pública, solicitud de licencia con `mediaId`, hero con
`heroMediaId`, flujo Studio completo sobre `/media`); `probe-fase10.mjs` 24/24. Detalle en
`DOCUMENTO_VIVO_ARQUITECTURA.md` §20 (diseño de toda la Fase 14 en §19).

**Fase 12d — público + registro + pulido (2026-09-04).** Cuarto y último tramo de la Fase 12 —
puro frontend, sin tocar el backend. Botón **"Solicitar licencia"** dentro del propio lightbox
(`LicenseRequestForm`, mismo patrón que `ContactForm`: honeypot, `Status` idle/sending/sent/error),
pestaña **"Licencias emitidas"** en `/studio/licencias` (filtra en el cliente `r.license !== null`,
sin endpoint nuevo), y contadores de pendientes ("N sin leer" / "N nuevas") en `/studio` junto a los
enlaces a Mensajes y Solicitudes — se descartó fundir ambas bandejas en una sola tabla porque tienen
acciones y modelos distintos; el objetivo real de "unificar" (saber de un vistazo si algo necesita
atención) ya lo resuelven los contadores. Verificado con un script que confirma que el frontend
consume exactamente el contrato del backend existente: 12/12 checks OK. De paso se descubrió y
documentó (no es un defecto del proyecto) que `next build` dentro del contenedor de desarrollo
hereda `NODE_ENV=development` y eso rompe el pre-render de `/_global-error` en Next 16 + Turbopack —
forzando `NODE_ENV=production` el build queda limpio, 16 rutas. Con esto la Fase 12 completa
(solicitud → cotización → emisión y entrega → pulido público) queda cerrada. Detalle en
`DOCUMENTO_VIVO_ARQUITECTURA.md` §18.

**Fase 12c — emitir licencia + entrega de un solo uso (2026-09-04).** El tramo más complejo de la
Fase 12: al aceptar una solicitud cotizada se emite la licencia y se entrega el archivo original
limpio por un enlace que se **consume**, no que expira.

- **Hallazgo real, corregido antes de seguir**: `GET /g/:slug` seguía devolviendo el original sin
  marca a resolución completa para álbumes públicos desde la Fase 3 — la Fase 11 lo había dado por
  resuelto sin verificarlo. `MediaService.getGallery()` ya no incluye `original` salvo en álbumes
  `private`. Se corrigió la ficha F19 (escrita mal en la Fase 11) en `PRUEBAS_SEGURIDAD.md`.
- **Backend**: migración `20260904221657_licenses_delivery` (`licenses` + `delivery_tokens`, mismo
  patrón que `album_share_tokens`). `LicensingService.accept()` (solo desde `quoted`; el gestor
  acepta en nombre del cliente, sin portal de autoservicio) + `consumeDelivery()` (token de un solo
  uso, `updateMany` atómico contra la carrera de dos descargas simultáneas, incrusta al
  licenciatario en los metadatos al vuelo). `POST /license-requests/:id/accept` +
  `GET /deliveries/:token` (público, el control es el token). `CloudinaryStorageDriver.read()`
  nuevo (implementado, no verificado contra Cloudinary real en esta sesión — el driver de disco sí
  se probó de punta a punta).
- **Frontend**: `/studio/licencias` gana "Aceptar y emitir licencia" + estado de la entrega.
- **Verificado en vivo, flujo completo**: solicitud → cotizar → aceptar (201) → primera descarga
  (200, archivo real) → segunda descarga del mismo token (404) → `fulfilled`. **101 tests / 15
  suites**. Bloque L12–L16 en `PRUEBAS_SEGURIDAD.md`. Detalle en
  `DOCUMENTO_VIVO_ARQUITECTURA.md` §17.

**Fase 12b — cotizar (2026-09-04).** Segundo tramo de "poder vender": el gestor responde una
solicitud con precio + condiciones + hasta cuándo es válida la oferta; el solicitante lo recibe por
correo. Emitir la licencia y entregar el archivo firmado quedan para 12c–12d.

- **Backend**: migración `20260904220024_license_quotes` (`quoted_price`/`quoted_conditions`/
  `quote_expires_at`/`quoted_at` en `license_requests`). `LicensingService.quote()`: solo se puede
  (re)cotizar desde `new`/`quoted` (400 si ya está `accepted`/`declined`/`fulfilled`); correo al
  solicitante. `PATCH /license-requests/:id` (`admin`+).
- **Frontend**: `/studio/licencias` (la misma página de 12a) gana, por solicitud, la cotización
  vigente y un formulario "Cotizar"/"Recotizar" colapsable.
- **Verificado**: solicitud inexistente → 404; cotizar una ya `accepted` → 400; recotizar desde
  `quoted` → permitido; `price` vacío → 400; RBAC (401/403/200); correo con precio/condiciones
  escapados. `next build` OK. `tsc` OK. **93 tests / 15 suites** (6 nuevos para `quote()`).
  Bloque L8–L11 en `PRUEBAS_SEGURIDAD.md`. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §16.

**Fase 12a — solicitud de licencia (2026-09-04).** Primer tramo de "poder vender": una foto
publicada → formulario de solicitud (uso previsto + mensaje + presupuesto) → bandeja del gestor.
Cotizar / emitir licencia / entregar el archivo firmado quedan para 12b–12d.

- **Backend**: tabla `license_requests` (migración `20260904155252_license_requests`); `POST
  /license-requests` (público, 202, honeypot, throttle 5/min, valida que la foto esté `published`
  de un álbum `public` → 400 si no); `GET /license-requests` (`admin`+, bandeja con miniatura y
  colección resueltas, sin IP). Mismo patrón que `ContactService` a propósito.
- **Frontend**: `/studio/licencias` (solo lectura por ahora), enlazada desde `/studio` y `/admin`.
- **Verificado**: imageId inexistente → 400; honeypot sin fila; campo extra → 400; uso inválido →
  400; RBAC de la bandeja; throttle → 429. `next build` OK (16 rutas). **87 tests / 15 suites**
  (nuevo `licensing.service.spec.ts`). Bloque L1–L7 en `PRUEBAS_SEGURIDAD.md`. Detalle en
  `DOCUMENTO_VIVO_ARQUITECTURA.md` §15.

**Fase 11 — protección de la obra (2026-09-04).** "El fotógrafo deja de regalar sus fotos": marca de
agua estampada por el servidor en todo lo público + registro de derechos incrustado como IPTC/XMP en
cada archivo servido (público o privado).

- **Backend** (migración `20260904142447_protection`): `images.rights` (JSON, override por imagen);
  `site_settings` gana campos de marca de agua (`watermark_asset_key`/`text`/`opacity`/`placement`)
  y de derechos por defecto (`rights_holder`/`creator`/`credit_line`/`rights_statement`/
  `default_license_terms`/`licensor_url`). `src/protection/` nuevo: `WatermarkService` (compone vía
  SVG rasterizado con `sharp`), `RightsMetadataService` (embebe con `exiftool` real, `execFile`,
  lista fija de etiquetas), `rights.util.ts` (saneo + resolución con herencia). `ImagesService.upload()`
  estampa (solo `public`) y embebe derechos (siempre) en el original y los 4 derivados.
  `POST/DELETE /site/watermark` (subir/quitar el logo); `POST /site/watermark/regenerate` +
  `GET` del mismo — **regeneración en segundo plano** (ver hallazgo abajo).
- **Frontend**: `/studio/ajustes` gana "Marca de agua" (subir logo, texto, opacidad, patrón,
  regenerar con progreso) y "Derechos por defecto"; `/studio/[albumId]` gana un editor de derechos
  por imagen (colapsable); `GalleryImage`/`Lightbox` con disuasores de copia (`draggable=false` +
  bloqueo de arrastre/clic-derecho, documentados como disuasores, no control real);
  `Lightbox`/`SiteFooter` muestran el aviso de derechos resuelto.
- **Hallazgo real (bug, corregido antes de producción)**: el mosaico de la marca de agua era de
  tamaño fijo (320 px) — `sharp` exige que lo compuesto quepa dentro de la imagen base, así que
  estampar el derivado `thumb` (240 px) fallaba en silencio y se servía **sin marcar**. Lo detectó
  un test de regresión antes de llegar a producción. Arreglo: el mosaico se acota al lado más chico
  de cada derivado.
- **Hallazgo real (rediseño necesario)**: la regeneración síncrona de ~250 fotos **superó los 5
  minutos** y el cliente HTTP cortó la conexión (verificado, no hipotético). Se rediseñó como
  trabajo en segundo plano — `POST` responde 202 de inmediato, progreso consultable con `GET`,
  estado en memoria del proceso (no Redis — documentado como fuera de su alcance).
- **Límite conocido, documentado**: la regeneración solo puede releer el original con el driver de
  **disco**; con Cloudinary (producción) cada imagen se cuenta como omitida — no se simula.
- **Verificado**: metadatos reales confirmados con `exiftool` en original público y privado; marca
  de agua presente solo en derivados `public`; inyección de saltos de línea/flags en un campo de
  derechos → saneada; subir basura como logo → 400; RBAC de los 4 endpoints nuevos correcto;
  regeneración real sobre ~250 fotos: arranca, no se duplica, termina con conteo correcto.
  **79 tests / 14 suites**. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §14.

**Fase 10b — curación (2026-09-03).** Ver más abajo en el historial.

**Fase 10 — reencuadre como portafolio de fotografía (2026-09-02).** El sitio se presenta como el
portafolio de un autor; el motor de colecciones/personalización no cambia. La sección pública
(entrar / crear cuenta) sigue visible.

- **Backend** (migración `20260902200738_portfolio`): `albums.featured`; `site_settings` (fila
  única con nombre, tagline, bio, texto de «Sobre», contacto, hero); `contact_messages`.
  Endpoints: `GET/PATCH /site` (lectura pública, escritura `admin`+), `POST /contact` (público,
  202, honeypot `website`, throttle 5/min), `GET/PATCH/DELETE /contact/messages` (`admin`+).
  `GET /galleries?featured=true`.
- **Frontend público**: `SiteHeader`/`SiteFooter` (identidad del sitio; reemplazan `SiteNav`);
  portada con hero a sangre completa + colecciones destacadas; páginas nuevas `/trabajo`,
  `/sobre`, `/contacto` (formulario → `POST /contact`). Titulares en serif de sistema.
- **Gestor**: "Studio" → "Gestor del sitio", "álbum" → "colección"; casilla "Destacar en la
  portada"; `/studio/ajustes` (editor de identidad + selector de hero) y `/studio/mensajes`
  (bandeja de contacto).
- **`scripts/seed-portfolio.ts`** (se corre desde el host): persona ficticia "Mara Solís" +
  **6 colecciones públicas / 244 fotos** — usa **todo** el contenido de la carpeta de origen
  (Calle←Skate 89, Tinta←tatoos 37, Muros←grafitti 38, Humo←smoke 25, Ciudad←Qro+varias+espirales
  34, Cuaderno←sueltas de la raíz 21) por el pipeline real. Convergente: borra y rehace cada
  colección para dejar siempre el set completo. Requiere `UPLOAD_MAX_UPLOADS_PER_HOUR` alto (el
  `.env` de dev lo pone en 5000; prod 120).
- **Verificado**: `GET /site` con hero resuelto; `/galleries` → 5, `?featured=true` → 4; honeypot
  descarta sin dejar fila; `next build` (prod) OK con 15 rutas; `tsc` backend OK.
- **Pasada de seguridad** (`scripts/probe-fase10.mjs`, 24 checks): RBAC de `/site` y
  `/contact/messages`, validación de `heroImageId` (álbum no público → 400), honeypot sin fila,
  XSS almacenado escapado en el correo, throttle 5/min → 429, `MessageView` sin IP,
  `?featured=true` no filtra no-públicas. Specs nuevas `site`/`contact` → **50 tests / 10 suites**.
  Bloque S1–S13 en `PRUEBAS_SEGURIDAD.md`.
- Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §11.

Bloque anterior (hardening — el dominio/VPS los gestiona el proyecto del portafolio):

- **Rate limit global** (`@nestjs/throttler`): 600/min por IP (2400/min para media, `/health`
  exento); los límites de fuerza bruta viven por debajo. Verificado: 650 req → 600×401 + 50×429.
- **Healthcheck del backend** en `docker-compose.prod.yml` + `condition: service_healthy` en
  frontend y Caddy.
- **CI** (`.github/workflows/ci.yml`): backend (Postgres+Redis, `tsc` + 36 tests + `nest build`) y
  frontend (`next build` prod).
- **Cabeceras de seguridad del frontend** (`next.config.ts`): CSP env-aware, `X-Frame-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS en prod.
- **Fix**: `incremental: true` quitado de `tsconfig.json` (rompía `nest start --watch` tras
  `restart` por chocar con `deleteOutDir`); `tsconfig.json` gana `include`/`exclude` (excluye la
  salida de Compodoc para que el `tsc` local == CI).
- Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §10.

Lo anterior:

- **Pruebas: de 11 a 36** (8 suites). Nuevas: `slug.util`, `media-signing`, `image-pipeline`
  (procesa JPEG, elimina EXIF, rechaza no-imagen/SVG/decompression bomb), y **dos suites de
  integración contra el Postgres real** (`roles.service.spec.ts`, `users.service.spec.ts`) que
  prueban la jerarquía y `max_count`, confirmando el estado en BD tras cada rechazo.
- **Cloudinary verificado de verdad** (`STORAGE_DRIVER=cloudinary`, carpeta aislada): público sin
  firma, privado con URL `authenticated` firmada (401 sin firma), borrado sin huérfanos. Revertido
  a `disk` después.
- **Pulido visual** en dos pasadas: (1) landing + galería pública + lightbox; (2) Studio y
  administración con aspecto de panel (sistema de tokens CSS, secciones como tarjetas, nav
  pegajosa con enlace activo, inputs con foco anillado, tablas con hover, listas como tarjetas,
  `auth-card` con sombra). Solo CSS + un ajuste en `SiteNav`.
- **Flake de tests corregido**: dos suites de integración usaban `count()` global en paralelo →
  comprobación acotada. 3 corridas seguidas limpias, 36/36.
- Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §9.

**Fase 8 (documentación autogenerada) — completada y verificada (2026-09-01).**

- Plugin `@nestjs/swagger` en `nest-cli.json` → `/api-json` con 18 schemas de DTOs (antes 0).
- `docs/` — portal MkDocs Material (5 páginas: Inicio, Arquitectura, Roles, Seguridad, API con
  Swagger UI embebido en vivo). Contenedor `gallery_docs` en `127.0.0.1:8098`.
- `gallery_compodoc` (`127.0.0.1:8099`) — documentación autogenerada del backend; **verificado que
  parsea los comentarios TSDoc reales** del código.
- `ALLOWED_ORIGINS` ganó `http://localhost:8098` (CORS del `/api-json` para el portal).
- **Hallazgos**: `compodoc` v2 usa `--host` (no `--hostname`); el `npm ci` de producción exigió
  regenerar `package-lock.json` tras mover `prisma` a deps y añadir `@compodoc/compodoc`.

**Fase 9 (despliegue) — artefactos listos y verificados en local (2026-09-01).**

- `gallery_backend/Dockerfile` (multi-etapa: `npm ci` → `prisma generate` → `nest build` → prune;
  runtime = node_modules podado + `dist` + prisma, usuario `node`; arranque = `migrate deploy` +
  seed + `node dist/main.js`). `prisma` movido a `dependencies`.
- `gallery_frontend/Dockerfile` (multi-etapa, `output: 'standalone'`, ≈68 MB;
  `NEXT_PUBLIC_API_BASE_URL=/api` como `ARG` de build).
- `Caddyfile` (`/api/*` → backend, resto → frontend; TLS automático; un solo origen).
- `docker-compose.prod.yml` (Postgres/Redis sin puertos publicados; solo Caddy expone 80/443;
  `NODE_ENV=production`, `GLOBAL_PREFIX=api`, `STORAGE_DRIVER=cloudinary`).
- `.env.prod.example`; `main.ts` activa `trust proxy` en producción.
- **Verificado en local** (stack prod tras Caddy en `http://localhost`): `/api/health` ok,
  `/api/galleries` 200, `/` 200 (Next standalone), `/api/api-json` → 404 (Swagger off en prod),
  login por el mismo origen con cookies httpOnly funcionando. Detalle en
  `DOCUMENTO_VIVO_ARQUITECTURA.md` §7.
- **Falta lo que no se puede hacer desde aquí**: el VPS, el DNS de `galeria.dvloprbn.dev`, y
  `.env.prod` con los secretos reales.

**Fase 5 (Studio + paneles, frontend) — completada y verificada (2026-09-01).**

- Sesión en el cliente: `apiFetch` (cookies httpOnly), `<AuthProvider>` + `useAuth()`,
  `<RequireAuth roles={...}>`, `SiteNav`.
- Rutas: `/login` (3 pasos + Suspense por `useSearchParams`), `/registro`, `/cuenta` (contraseña +
  activación de 2FA con QR real + códigos de recuperación), `/studio` (lista + crear con **todos
  los ajustes de una vez**), `/studio/[albumId]` (subir varios, rejilla editable con reordenado
  arrastrando, ajustes, enlaces de compartir crear/listar/revocar, borrar), `/admin`,
  `/admin/usuarios`, `/admin/roles`.
- Backend menor: `/auth/me` + `AuthenticatedUser` ganan `totpEnabled`; `GET /albums/:id/share-tokens` nuevo.
- **Verificado**: endpoints con la forma exacta de la UI (theme anidado, coverImageId, reorder,
  share-tokens); las 7 páginas nuevas → 200 SSR; `NODE_ENV=production next build` pasa (11 rutas);
  `tsc` backend limpio; 11 tests jest.

**Fase 4 (galería pública, frontend) — completada y verificada (2026-09-01).**

- Next.js: `/g/[slug]` (Server Component, valida con Zod, `notFound()` sin acceso, `noindex` si no
  es público), índice `/` (galerías públicas vía `GET /galleries`, endpoint nuevo), `not-found` y
  `global-error` propias.
- 4 layouts en **CSS puro** (masonry / grid / justified / carousel); animación de entrada por
  `IntersectionObserver` + transición CSS escalonada; lightbox con teclado y transiciones CSS.
  **Sin librería de animación** (`motion` se probó y se quitó — menos bundle, mejor rendimiento).
- `<img>` con `srcset` de los 4 derivados + `sizes` por layout, `loading="lazy"`, BlurHash detrás.
- Tema del álbum → CSS custom properties validadas con Zod (nunca CSS crudo).
- `scripts/seed-demo.ts` (backend): siembra una galería de demo por el flujo real (8 imágenes).
- **Hallazgo clave**: `next build` debe correr con `NODE_ENV=production` (el compose de dev fija
  `development`, correcto para `next dev` pero rompe el prerender de `/_global-error`). Anotado
  para la Fase 9.

**Fase 3 (media core) — completada y verificada de punta a punta (2026-09-01).**

- `storage`: `StorageService` abstracto + `DiskStorageDriver` (dev, con firma HMAC) y
  `CloudinaryStorageDriver` (prod, `authenticated` + URL firmada para privados).
- `media-processing`: pipeline `sharp` — valida por contenido (sin `file-type`, se descartó),
  re-codifica quitando EXIF/GPS, genera 4 derivados WebP + BlurHash, `limitInputPixels`.
- `albums`: CRUD (visibilidad/layout/tema al crear), enlaces de compartir con caducidad,
  `canManage` (dueño o admin), 404 sin acceso.
- `images`: subida (rate limit 120/h, pipeline, transacción + compensación), listado para Studio,
  edición de metadatos, reordenado, borrado con limpieza de objetos.
- `media`: `GET /g/:slug` (galería pública con control por visibilidad y token de compartir),
  `GET /media/:key` (servido del driver de disco, firma HMAC para privados, `nosniff`).
- **Verificado con `curl` + `sharp`**: tipo falsificado y SVG → 400, EXIF eliminado del original
  servido, decompression bomb → 400, límite de tamaño → 413, IDOR → 404/403, URL firmada, galería
  privada por token, cambio a público, limpieza total (0 archivos huérfanos). Detalle en
  `DOCUMENTO_VIVO_ARQUITECTURA.md` §4.

**Fase 2 (identidad) — completada y verificada de punta a punta (2026-09-01).**

- Módulos reales: `auth` (login en 3 pasos, registro con auto-login, refresh con rotación +
  ventana de gracia + revocación en cascada, logout, `/me`, cambio y recuperación de contraseña),
  `two-factor` (TOTP real: setup + QR, confirm con 10 códigos de recuperación, disable, regenerate),
  `roles` (CRUD dinámico + candado de jerarquía), `users` (`assertCanManageRole` + `max_count`),
  `security-events` (fuerza bruta en Redis para login/2FA/reuso de refresh), `mail` (Resend con
  degradación elegante). Guards globales `JwtAuthGuard` + `RolesGuard`.
- Seed idempotente: 6 roles (`usuario`=0 … `super`=5) + 6 cuentas de prueba
  (`<rol>+gallery@example.com`, contraseña `TestOnly123!`).
- 11 tests `jest` (utilidades puras: AES-256-GCM, TOTP, escape HTML) verdes. Verificación real
  con `curl` de todos los flujos — detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §3.
- **Decisión técnica**: `otplib` fijado en la v12 (la v13 es una reescritura ESM/async; para 2FA
  se prefiere la API estable y probada).

**Fase 1 (núcleo / infraestructura) — completada y verificada de punta a punta (2026-09-01).**

- Documentación autocontenida completa (8 archivos), con las **7 decisiones de `PLAN_DESARROLLO.md`
  §4 confirmadas**:
  - D1 multiusuario · D2 con visibilidad `public`/`unlisted`/`private` · **D3 Cloudinary** (tras
    el pipeline propio de `sharp`; el dueño crea la cuenta y pasa credenciales después) ·
    D4 Framer Motion · D5 con 2FA TOTP · D6 paquetes `gallery_backend`/`gallery_frontend` (nombre
    de marca pendiente, no bloqueante) · D7 repo público.
- Schema Prisma **congelado** (`DOCUMENTO_VIVO_ARQUITECTURA.md` §1.3) y migrado: identidad
  (`roles`/`users`/`refresh_tokens`/`totp_recovery_codes`/`password_reset_tokens`/`security_events`)
  + media (`albums`/`media`/`media_variants`/`album_share_tokens` — `images`/`image_variants` hasta
  la Fase 14a). Migración inicial `20260901235839_init` + las de cada fase.
- **Stack corriendo y verificado** (`docker compose up -d --build`): `GET /health` →
  `{"status":"ok","checks":{"database":true,"redis":true}}`; frontend Next `200`; `tsc` limpio.
  Detalle técnico y hallazgos (Prisma 7.10 driver adapter, `postgres:18` volumen, colisión de
  puertos) en `DOCUMENTO_VIVO_ARQUITECTURA.md` §2.
- **Puertos reales de este proyecto** (verificados libres): frontend `3051`, API `3050`,
  Postgres `5438`, Redis `6383` — solo `127.0.0.1` los de datos.

## 2. Pendiente del dueño

- **Cloudinary + Resend: resuelto (2026-09-01).** La galería vive en el mismo dominio que el
  portafolio DvloprBn y reutiliza su cuenta de Cloudinary y su llave de Resend — credenciales
  tomadas de `projects/dvlopr-bn/.env` y cargadas en `gallery/.env` (ignorado por git).
  `CLOUDINARY_FOLDER=gallery` aísla los recursos. En desarrollo sigue `STORAGE_DRIVER=disk`
  (no se ensucia la cuenta real con pruebas); se conmuta a `cloudinary` en la Fase 3 / producción.
- Nombre de marca del producto (D6) — no bloqueante.

## 3. Deuda / seguimiento

- **`npm audit`: 4 vulnerabilidades *high* en el árbol del CLI de Prisma** (`mysql2`,
  `deepmerge-ts` vía `@prisma/config`). Solo devDependency, sin ruta alcanzable (usamos
  PostgreSQL). El fix automático baja a Prisma 6 — no se aplica. Seguir releases de Prisma 7.
  Ver `DOCUMENTO_VIVO_ARQUITECTURA.md` §2.2 y `PRUEBAS_SEGURIDAD.md`.

## 4. Próximo paso

Las fases 1–10 están **completas**: 1 infra · 2 identidad · 3 media · 4 galería pública · 5 Studio ·
6 animación (CSS) · 7 seguridad transversal · 8 docs · 9 despliegue (artefactos) · 10 reencuadre
como portafolio.

**Reencuadre de alcance (2026-09-02) — decisiones D9–D13 RESUELTAS.** El dueño amplió el objetivo:
el sitio debe demostrar el **kit real para que un fotógrafo publique, proteja y venda su obra** (no
una galería más), y cerró las cinco decisiones el mismo día:

- **D9** marca de agua: obligatoria en `public`, **formulario en el gestor para subir la imagen**
  (PNG) + texto de respaldo; estampada por el servidor en todos los derivados públicos.
- **D10** datos de derechos: **captura completa** por imagen (titular, autor, crédito, año, aviso,
  término de licencia, descripción, keywords) **+ embebido IPTC/XMP** en cada archivo servido; el
  pipeline pasa de "quitar todo el EXIF" a "quitar GPS/serie/personal, poner derechos".
- **D11** venta: **solo licencia digital** por ahora (provisional, el dueño investigará impresiones).
- **D12** pago: Fase 12 sin cobro; **Fase 13 = Stripe modo test tras flag, diferida ≈2026‑09‑17**
  (hasta tener cuenta Stripe; el proyecto padre cobrará de verdad, aquí solo claves de prueba; el
  padre aún **no tiene** claves Stripe).
- **D13** comercial/editorial: campo `category` en `albums`, IA plana por ahora.

Fases nuevas en `PLAN_DESARROLLO.md` §10: **10b Curación** ✅, **11 Protección**, **12 Licenciamiento**,
**13 Pago (diferida)**. Diseño técnico + modelo de datos + *por qué* de cada decisión en
`DOCUMENTO_VIVO_ARQUITECTURA.md` **§12**.

**Fase 10b — Curación (completada 2026-09-03).** `images.status` (`published`/`draft`/`archived`,
default `draft`); migración `20260903220045_image_status` (backfill a `published` para no ocultar
nada). `PATCH /images/:id` acepta `status`; `POST /albums/:id/images/status` cambia en bloque
(valida pertenencia al álbum). `GET /g/:slug` y `/galleries` muestran/cuentan **solo publicadas**
(siempre, tenga o no enlace de compartir); portada y `hero_image_id` resilientes si la foto deja de
estar publicada; `PATCH /site` exige hero publicado. Gestor (`/studio/[albumId]`): selector de
estado por imagen + selección múltiple + acciones en bloque + recuentos en vivo; tarjetas `draft`
punteadas, `archived` atenuadas. `seed-portfolio.ts` cura: sube todo (244) y publica una selección
repartida (~81: 16/14/15/12/14/10). Verificado end-to-end. **53 tests / 11 suites**
(nuevo `images.service.spec.ts`; `site.service.spec.ts` ampliado). Detalle en
`DOCUMENTO_VIVO_ARQUITECTURA.md` §13.

**Repositorio remoto: hecho (2026-09-02).** El código está en `github.com/DvloprBn/gallery-component`
(rama `main`, historial completo). El `origin` local usa **SSH** (`git@github.com:DvloprBn/gallery-component.git`),
no HTTPS — ver el detalle en el Historial de cambios de esa fecha. `git push` funciona sin
interacción desde esta máquina.

Lo que queda, cuando el dueño quiera:

1. **Desplegar de verdad**: VPS + DNS de `galeria.dvloprbn.dev` + `.env.prod` con secretos reales,
   y `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`. Tras el
   despliegue, correr `scripts/seed-portfolio.ts` apuntando a la API de producción (o sembrar a
   mano desde el gestor) y **rotar las llaves de Cloudinary/Resend** (el repo es público).
2. **Enlazar la demo desde el portafolio** `projects/dvlopr-bn`.
3. Opcional: prev/next entre colecciones en `/g/[slug]`; probar `STORAGE_DRIVER=cloudinary` contra
   la cuenta real; sustituir la "Selección de encargos" fija de `/sobre` por contenido editable.
4. **Fase 12 completa (10b, 11, 12a–12d)** — el flujo completo de venta (solicitud → cotización →
   licencia → entrega de un solo uso), el botón público "Solicitar licencia" en el lightbox y el
   registro de licencias emitidas ya funcionan de punta a punta. La Fase 13 (pago Stripe) espera a
   ≈2026‑09‑17. `CLAUDE.md` "Qué es este proyecto" actualizado al marco nuevo. No queda ninguna
   sub-tarea de licenciamiento pendiente — lo que sigue es el despliegue real (punto 1 de arriba) o
   la Fase 13 cuando llegue su fecha.
5. **Fase 14 — Video ✅ COMPLETA (14a–14d, 2026-09-07)** — `DOCUMENTO_VIVO_ARQUITECTURA.md` §19–§23.
   Unificación `images`→`media`; pipeline `ffmpeg` propio; marca de agua + HLS adaptativo;
   licenciamiento de video + hero en video. Verificado en vivo de punta a punta.
6. **Fase 15 — Layout "libro" (diseño listo, sin construir, 2026-09-07)** — el dueño pidió replicar
   la sección "The Story" de nois7.com/world-of-dreams (un fotolibro que se hojea con el scroll).
   Decisión D15 en `PLAN_DESARROLLO.md` §4 + diseño en `DOCUMENTO_VIVO_ARQUITECTURA.md` §24: nuevo
   layout de álbum `book` (sin migración — `albums.layout` ya es String); sección fija + pase de
   página fotorrealista con **`page-flip` (StPageFlip) en modo HTML** bundleado por npm (mantiene
   los `<img>` reales → `srcset`/BlurHash/lazy/SEO intactos); dos imágenes por pliego; móvil = una
   página con gesto; **`prefers-reduced-motion` / sin JS / fallo de la librería → cae a `grid`**.
   Sub-fases 15a (plumbing + pliego estático + fallback) → 15b (curl realista con gesto) → 15c
   (scroll fijo + teclado + rendimiento) → 15d (pulido). No depende de Stripe ni del despliegue; se
   construye cuando el dueño lo confirme.

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
| 2026-09-07 | **Fase 14d — Licenciamiento de video + hero en video (construida). Fase 14 COMPLETA.** El backend ya trataba el video en `consumeDelivery` desde 14b (`kind==='video'` → `format:'mp4'`, ext `.mp4`, `metadata.embed` con etiquetas QuickTime/XMP); la 14d lo **verifica de punta a punta en vivo** y ajusta el resto. **Licenciamiento**: `LicenseRequestForm` recibe `kind` → "Solicitar licencia de **este video**"/"de esta foto"; los correos de `LicensingService.submit`/`accept` dicen "un video de «…»"/"una foto de «…»" según `media.kind`; el endpoint/honeypot/throttle/validación no cambian — un video se licencia por el mismo camino. **Hero en video**: `PATCH /site` valida además `media.storage_key` (rechaza un video a medio transcodificar) y el mensaje deja de decir solo "foto"; `SiteService.toPublic` → `HeroMedia` gana `kind`, y para un hero video `urls` = `preview` (MP4) + `hls` (`master.m3u8`) + WebP del póster, **nunca** `original` (D9); para foto sigue igual. Frontend: `components/HeroMedia.tsx` (nuevo, cliente) → `<img>` para foto, `<video autoplay muted loop playsInline>` (usa el `preview`) para video **salvo `prefers-reduced-motion`** → el mismo `<video>` en pausa mostrando el póster (no se cambia el tipo de elemento, para no romper la hidratación); `app/page.tsx` lo usa; el selector de hero de `/studio/ajustes` marca "(video)" en la etiqueta. **Verificado en vivo**: `verify-14d.mjs` **14/14** (subir video 720p → publicar → `POST /license-requests {mediaId: video}` → 202 con miniatura del póster → cotizar → aceptar 201 → **1ª descarga → 200, `video/mp4`, `Content-Disposition: attachment; filename="licencia-XXXXXXXX.mp4"`, MP4 real 720p** = el master limpio, no una rendition con marca; `exiftool` confirma derechos + nota del licenciatario incrustada; **2ª descarga del mismo token → 404**; solicitud → `fulfilled`). El token se extrajo con un `logger.warn('[VERIFY-14D] …')` temporal en `accept()`, usado una vez y **quitado antes del commit** (mismo método que la Fase 12c — el `RESEND_API_KEY` del `.env` es real, `MailService` no vuelca el cuerpo). `verify-14d-hero.mjs` **6/6** (video sin procesar → 400; procesado y publicado → 200; `GET /site` `hero.kind='video'` con `preview`+`hls` y **sin** `original`; el `preview` del hero descarga como MP4). Nuevo test unitario de `consumeDelivery` para el caso video (assert `format:'mp4'`, `filename` `.mp4`) para no depender del truco del log. **111 tests / 16 suites**; `tsc` back+front limpios; `next build` prod OK (16 rutas); `verify-14b` 13/13, `verify-14c` 14/14, `probe-fase10` 24/24. **NO verificado en navegador real** (entorno sin browser): la reproducción visual del `<video>`/`hls.js` en lightbox y hero y el respeto a `prefers-reduced-motion` en pantalla no se probaron en un navegador. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §23. |
| 2026-09-07 | **Fase 14c — Marca de agua sobre el video + HLS adaptativo (construida).** `WatermarkService.buildFrameOverlay(w,h,config)` (nuevo): PNG RGBA del tamaño exacto de un fotograma con la marca estampada (mosaico/esquina, misma lógica que las fotos); `ffmpeg` lo aplica con `overlay=0:0`. Se estampa el póster (4 WebP, vía `composite`), el `preview` y **todas** las renditions HLS — nunca el master (D9), solo `public`. `VideoPipelineService`: `buildRendition(master, out, {w,h}, fps, bitrateKbps, overlayPng|null, hasAudio)` (escala exacta sin ampliar, marca opcional, GOP alineado a 2 s `-g/-keyint_min=2·fps -sc_threshold 0`, bitrate por altura 800/1400/2800/5000k) y `packageHls(paths, outDir, hasAudio)` (un `ffmpeg -c copy` con `-var_stream_map` → `master.m3u8` + `stream_N.m3u8` + `seg_N_*.ts`, `-hls_time 4 -hls_playlist_type vod -hls_flags independent_segments`). Alturas: 360/540/720/1080 que quepan **bajo** el master + la del master. El job sube cada `.ts`, **reescribe** cada `stream_N.m3u8` (líneas no-`#` = segmentos → URLs servidas) y el `master.m3u8` (líneas = playlists → URLs), y guarda TODAS las claves HLS en `media.hls_keys String[]` (migración `20260907160000_media_hls_keys`) para poder borrarlas (`ImagesService.remove`/`AlbumsService.remove` iteran el array). `media.hls_manifest_key` = clave del master → `urls.hls` en `GET /g/:slug` y el Studio; el `preview` MP4 sigue de respaldo. **Bug propio**: `GET /media/:key` resolvía la visibilidad buscando la clave en `storage_key`/`media_variants` — los objetos HLS viven en `hls_keys`, así que **todas las URLs HLS daban 404**; `visibilityOfKey` gana `media.findFirst({ where: { hls_keys: { has: key } } })`. `DiskStorageDriver`: la regex de clave pasa de `[a-z0-9]{3,4}` a `[a-z0-9]{2,4}` (el `.ts` tiene 2 chars) + `CONTENT_TYPES` gana `m3u8→application/vnd.apple.mpegurl` y `ts→video/mp2t`. Álbum privado: los objetos HLS usan un TTL de URL firmada más largo (`MEDIA_HLS_URL_TTL_SECONDS`, default 3600 s) — una reproducción pausada seguiría pidiendo segmentos; añadido `StorageService.urlFor(key, visibility, ttl?)`. Frontend: `lib/load-hls.ts` (carga `hls.min.js` 1.5.17 de `cdnjs` una vez); `Lightbox` para `kind==='video'` con `urls.hls` → HLS nativo (`canPlayType('application/vnd.apple.mpegurl')`, Safari) o `hls.js` (`enableWorker:false`), caída al `preview` ante error fatal o si no hay `hls.js`; `next.config.ts` CSP gana `https://cdnjs.cloudflare.com` en `script-src`. Env nueva: `MEDIA_HLS_URL_TTL_SECONDS` (`.env`/`.env.example`/`.env.prod.example`). **Verificado**: `tsc` back+front limpios; **110 tests / 16 suites** (`video-pipeline.service.spec.ts` gana `buildRendition`/`packageHls`; `watermark.service.spec.ts` gana `buildFrameOverlay` — todo con `ffmpeg` real); `next build` prod OK (16 rutas); `verify-14c.mjs` **14/14** en vivo (video 720p → 3 renditions 360/540/720; `master.m3u8` con `#EXT-X-STREAM-INF` y las 3 playlists como URLs **http absolutas**; cada `stream_N.m3u8` con `#EXTINF` y segmentos como URLs absolutas; un `.ts` descarga como MPEG-TS —byte sync `0x47`, `Content-Type: video/mp2t`—; galería pública con `urls.hls`+`urls.preview` sin `urls.original`; el póster WebP descarga; **al borrar el elemento, los `.ts` dan 404** → la limpieza de `hls_keys` funciona); `verify-14b.mjs` 13/13; `probe-fase10.mjs` 24/24. **No verificado en navegador real** (sin herramienta de browser en el entorno): la reproducción visual con `hls.js` y el cambio automático de calidad no se probaron en un navegador; sí el flujo por API y que cada pieza HLS se sirve bien. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §22. |
| 2026-09-07 | **Fase 14b — Pipeline de video (construida).** Subir/procesar/reproducir video, sin marca de agua ni HLS todavía (14c). `ffmpeg` en `Dockerfile`+`Dockerfile.dev`. Migración `20260907120000_media_video_columns` (aditiva): `media` gana `duration_ms`/`frame_rate`/`video_codec`/`audio_codec`/`has_audio`/`hls_manifest_key`/`poster_key`/`processing_error`, y `storage_key` pasa a **anulable** (un video tiene fila antes de tener master). `VideoPipelineService` (nuevo, en `media-processing/`): `probe()` valida por contenido con `ffprobe` (contenedor MP4/MOV/WebM/MKV, ≤120 s, ≤1920×1080, ≤200 MiB, frame rate, ≤1 pista de video y de audio → 400); `transcodeMaster()` (`libx264 -crf 18 -movflags +faststart -map_metadata -1`), `extractPoster()`, `buildPreview()` (≤720p). Todo con `execFile`+array de args, `-protocol_whitelist file,crypto` (sin red → sin SSRF); `ffprobe` NO acepta `-nostdin` (dos listas de flags base). El interceptor de subida pasa a `diskStorage` (un video no cabe en memoria); `POST /albums/:id/media` detecta la rama por pista (`mimetype`/extensión) pero valida por contenido. `ImagesService`: `uploadVideo()` crea la fila `kind=video status=draft storage_key=null` y encola el transcode (cola de concurrencia 1, progreso en `Map` en memoria — nunca Redis); `runVideoTranscode()` hace master→póster (por el pipeline de imagen: 4 WebP + BlurHash)→preview→derechos (`RightsMetadataService.embedInPlace()`, nuevo, `exiftool` directo sobre el archivo; `EmbeddableFormat` gana `'mp4'` → XMP + QuickTime)→sube→rellena la fila. Fallo → `media.processing_error` + limpieza de objetos; reinicio a mitad → `GET /media/:id/processing` lo reporta `interrumpido`. `GET /media/:id/processing` (`admin`+, valida propiedad). `toDto`/`PublicMedia`/`getGallery` añaden `kind`+`durationMs`; el master (`urls.original`) solo en la vista del Studio, nunca en la galería pública. **Bugs propios encontrados y corregidos**: `DiskStorageDriver` validaba extensión `[a-z]{3,4}` → `mp4` (con dígito) daba "clave inválida" → `[a-z0-9]{3,4}` + `CONTENT_TYPES` gana `mp4→video/mp4`; `next.config.ts` CSP no tenía `media-src` → el `<video>` no cargaba el preview. `storage_key` anulable rompió tipos en `albums`/`licensing`/`media`/`site` services → guardas añadidas (la regeneración de marca ahora filtra `kind:'photo'`). `consumeDelivery` reconoce `kind='video'` → el master ya se entrega bien bajo licencia (adelanto de 14d). Frontend: `MediaDto`/`galleryMediaSchema` ganan `kind`/`durationMs`/`processing`/`processingError`; `Lightbox` pinta `<video controls playsInline preload=metadata controlsList=nodownload>`; `GalleryImage` añade ▶ + duración; `[albumId]` `MediaGrid` acepta video en el `Uploader` y sondea `GET /media/:id/processing` cada 4 s mostrando "Procesando video…". Env nuevas: `VIDEO_MAX_INPUT_BYTES`/`_DURATION_S`/`_PIXELS`/`_FRAME_RATE`/`_TRANSCODE_TIMEOUT_MS` (`.env.example`+`.env.prod.example`). **Verificado**: `tsc` back+front limpios; **107 tests / 16 suites** (nuevo `video-pipeline.service.spec.ts`, 6 tests con `ffmpeg`/`ffprobe`/`exiftool` reales); `next build` prod OK (16 rutas); `verify-14b.mjs` **13/13** en vivo (PNG con nombre `.mp4` → 400; subida real → 201 `processing:true` → sondeo hasta `done` → bandeja con `urls.preview`+`urls.large`+`placeholder` → publicar → `GET /g/:slug` `kind=video`, `preview` sí / `original` no → el preview descarga con box `ftyp` de MP4 → `DELETE` 204); `exiftool` sobre el preview servido confirma Copyright/Artist/XMP dc:Rights/Credit/UsageTerms/WebStatement (invariante D10 en video); `probe-fase10.mjs` 24/24. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §21. |
| 2026-09-05 | **Fase 14a — Refactor `images` → `media` (construida).** Primer tramo de la Fase 14: unificar el modelo para poder soportar video, sin añadir video todavía. Migración `20260905120000_media_unification` **escrita a mano** — Prisma no detecta renombrados y habría hecho `DROP TABLE images; CREATE TABLE media`, borrando las 244 fotos + 976 derivados del portafolio ya sembrado; en su lugar `ALTER TABLE … RENAME` (tablas, columnas, **y** todos los índices/FK para que casen con los nombres que Prisma deriva) + `CREATE TYPE media_kind` + `media.kind DEFAULT 'photo'`. `prisma migrate dev` confirmó "in sync" sin drift; BD verificada: 244 `media` / 976 `media_variants` / 4 `license_requests` / 1 `licenses`, cero pérdida. **Renombrado**: modelo `images`→`media`, `image_variants`→`media_variants`; columnas `image_id`→`media_id`, `cover_image_id`→`cover_media_id`, `image_count`→`media_count`, `hero_image_id`→`hero_media_id`; rutas `POST/GET /albums/:id/images`→`/media`, `…/images/reorder|status`→`…/media/…`, `PATCH/DELETE /images/:id`→`/media/:id`; tag Swagger `images`→`media`; payloads `imageId`→`mediaId`, `imageIds`→`mediaIds`, `imageThumbUrl`→`mediaThumbUrl`, `imageCount`→`mediaCount`, `coverImageId`→`coverMediaId`, `heroImageId`→`heroMediaId`; `GET /g/:slug` devuelve `{ album, media: [...] }`; tipos frontend `ImageDto`→`MediaDto`, `GalleryImage`→`GalleryMedia`, `ImageRights`→`MediaRights`, `IMAGE_STATUSES`/`ImageStatus`→`MEDIA_*`; componente `ImageGrid`→`MediaGrid`, prop `image`→`media`. **Dejado igual a propósito**: módulo NestJS `src/images/` + clases `ImagesService`/`ImagesController` (renombrarlas choca con `MediaModule`/`MediaService` de entrega ya existentes; no es contrato), `ImagePipelineService`/`src/media-processing/` (operan sobre buffers), `status`/`sort_order` sin convertir (no hacen falta para video). **Verificado**: `tsc` back+front limpios; **101 tests / 15 suites** (sin tests nuevos — es un renombrado); `next build` prod (`NODE_ENV=production`) OK, 16 rutas; `verify-14a.mjs` **17/17** en vivo (galería pública, `POST /license-requests { mediaId }` → 202, `PATCH /site { heroMediaId }`, flujo Studio completo sobre `/media`: subir/patch/status/cover/borrar); `probe-fase10.mjs` **24/24**. `seed-portfolio.ts`/`seed-demo.ts`/`probe-fase10.mjs` ajustados. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §20. |
| 2026-09-05 | **Fase 14 — Video (diseño, sin construir).** El dueño preguntó si se pueden subir videos (hoy no: el pipeline solo acepta `jpeg/png/webp/avif`) y pidió diseñar la fase; delegó las decisiones técnicas al arquitecto. Resueltas: **(1)** video con el mismo estándar que las fotos —validación por contenido, re-encode obligatorio, marca de agua del servidor, licenciamiento y entrega de un solo uso— **y** reproducción inline; **(2)** transcodificación con **`ffmpeg` propio**, no un servicio de pago (mismo principio que `sharp`: el pipeline de seguridad corre antes del almacenamiento); **(3)** entrega **HLS adaptativa** para ver + **master MP4 limpio de un solo uso** para la licencia (cada transporte encaja con su uso, igual que "derivados públicos vs. original entregado una vez"); **(4)** modelo **unificado `media`** con discriminador `kind` (`photo`/`video`) en vez de una tabla `videos` aparte — el refactor se hace ahora que no hay producción ni datos reales (seed convergente), retrofitear después es lo que se quiere evitar. Diseño completo (schema, pipeline `ffmpeg` paso a paso, límites anti-DoS, whitelist de protocolos de ffmpeg contra SSRF, frontend con `hls.js`, hero de portada en video con `prefers-reduced-motion`) en `DOCUMENTO_VIVO_ARQUITECTURA.md` §19; decisión marco D14 en `PLAN_DESARROLLO.md` §4; fila en la tabla de fases §10. Sub-fases 14a–14d. **Sin código** — el proyecto sigue en pausa. |
| 2026-09-04 | **Fase 12d — Público + registro + pulido (construida).** Cuarta y última sub-tarea de la Fase 12 — puro frontend, cero cambios de backend. `components/LicenseRequestForm.tsx` (nuevo) replica el patrón de `ContactForm` (honeypot, `Status` idle/sending/sent/error, manejo de 429) sobre `POST /license-requests`; recibe `imageId` como prop y añade el selector de uso previsto (`lib/intended-use.ts`, nuevo, único origen de las etiquetas en español — lo usan tanto este formulario público como la bandeja del gestor). `Lightbox.tsx` gana un botón "Solicitar licencia" dentro del `<figure>` que abre el formulario como un panel dentro del propio visor (el `stopPropagation` que ya tenía cubre los campos); un `useEffect` sobre `index` lo cierra al cambiar de foto. `/studio/licencias` gana una pestaña **"Licencias emitidas"** que filtra en el cliente el mismo array de `GET /license-requests` (`r.license !== null`) — sin endpoint nuevo, el backend ya manda todo lo necesario. `/studio` (landing del gestor) carga en paralelo `GET /contact/messages` y `GET /license-requests` (solo si admin) y muestra "(N sin leer)"/"(N nuevas)" junto a los enlaces — se descartó fundir Mensajes y Licencias en una sola tabla porque tienen acciones y modelos distintos; el objetivo real de "bandeja unificada" (saber de un vistazo si algo espera atención) ya lo resuelven los contadores. **Verificado** con un script de un solo uso que confirma que el frontend consume el contrato exacto del backend: solicitud real vía el mismo cuerpo que arma el formulario → 202 → aparece en la bandeja admin con `status: 'new'` y la forma correcta (`imageId`/`license`/`requesterEmail`); honeypot → 202 pero nunca llega a la bandeja; `GET /contact/messages` trae `isRead` en cada fila; el filtro de licencias emitidas no revienta con 0 ni con N. **12/12 checks OK**. `tsc` limpio. **Hallazgo de entorno (no es un defecto del proyecto)**: `next build` dentro del contenedor de desarrollo hereda `NODE_ENV=development` (necesario para `next dev`) y eso dispara un fallo de Next 16 + Turbopack al pre-renderizar `/_global-error` (`Cannot read properties of null (reading 'useContext')`), reproducible incluso con un volumen `.next` aislado — forzando `NODE_ENV=production` explícito el build queda limpio, **16 rutas, sin errores**; documentado para no perder tiempo redescubriéndolo. Con 12d se cierra la Fase 12 completa. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §18. |
| 2026-09-04 | **Fase 12c — Emitir licencia + entrega de un solo uso (construida).** Tercera y más compleja sub-tarea de la Fase 12. **Hallazgo real corregido antes de construir nada**: al revisar qué protegía la entrega, se encontró que `GET /g/:slug` seguía devolviendo `urls.original` (el archivo limpio, sin marca, resolución completa) para álbumes `public`/`unlisted` desde la Fase 3 — la Fase 11 había dado por hecho que esto ya no pasaba (ficha F19 de `PRUEBAS_SEGURIDAD.md`, escrita mal) sin verificarlo; se comprobó en vivo (descarga real de un JPEG 2400×1600 sin marca desde la respuesta pública). Arreglo: `MediaService.getGallery()` ya no incluye `original` salvo en álbumes `private`. Migración `20260904221657_licenses_delivery`: tablas `licenses` (1:1 con la solicitud, copia de los términos aceptados) y `delivery_tokens` (mismo patrón que `album_share_tokens` — `token_hash`, nunca el token en claro — más `used_at`: se **consume**, no expira). `LicensingService.accept(requestId)`: solo desde `quoted` (400 si no); el gestor acepta en nombre del cliente (confirmado por otro canal) — no se construyó un portal de autoservicio; crea licencia + token en una transacción, correo con el enlace. `consumeDelivery(rawToken)`: valida (mismo 404 para inexistente/usado/caducado), marca usado con un `updateMany` **atómico** condicionado a `used_at: null` (la carrera de dos descargas simultáneas se resuelve por el `count`), incrusta al licenciatario en los metadatos del archivo al vuelo (nombre, correo, uso, condiciones) antes de servirlo, pasa la solicitud a `fulfilled`. `POST /license-requests/:id/accept` + `GET /deliveries/:token` (público, `DeliveryController`). `CloudinaryStorageDriver.read()` nuevo — implementado de verdad (baja el recurso por HTTPS desde su URL, firmada si es `authenticated`) porque la entrega es el corazón de la Fase 12, no una comodidad de admin; **no verificado contra una cuenta Cloudinary real en esta sesión** (dev usa `STORAGE_DRIVER=disk`, que sí se probó de punta a punta) — documentado con honestidad. Frontend: `/studio/licencias` gana "Aceptar y emitir licencia" + estado de la entrega (sin descargar / descargada / caducada). **Verificado en vivo, flujo completo**: crear solicitud → cotizar → aceptar sin cotizar → 400 → RBAC de aceptar (401/403) → aceptar → 201 → re-aceptar → 400 → primera descarga → 200 (archivo real ≈500 KB, `Content-Disposition: attachment`) → segunda descarga del mismo token → 404 → solicitud en `fulfilled`; token inventado → 404. La carrera de descargas simultáneas se probó como test unitario. `next build` OK (16 rutas). `tsc` OK. **101 tests / 15 suites** (`licensing.service.spec.ts` gana 8 tests). Bloque L12–L16 + corrección de F19 en `PRUEBAS_SEGURIDAD.md`. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §17. |
| 2026-09-04 | **Fase 12b — Cotizar (construida).** Segunda sub-tarea de la Fase 12. Migración `20260904220024_license_quotes`: `license_requests` gana `quoted_price`/`quoted_conditions`/`quote_expires_at`/`quoted_at` (se decidió no modelar estos campos en una tabla `licenses` aparte hasta que la Fase 12c defina qué necesita de verdad). `LicensingService.quote(requestId, dto)`: solo se puede (re)cotizar desde `new`/`quoted` (400 si ya está `accepted`/`declined`/`fulfilled` — recotizar sí se permite, el gestor puede ajustar el precio antes de que el cliente acepte); correo al solicitante con precio/condiciones/vigencia escapados. `PATCH /license-requests/:id` (`admin`+). `list()` y `quote()` comparten la proyección (`toView()` privado, refactor sin duplicar). Frontend: `/studio/licencias` (misma página de 12a) gana la cotización vigente por solicitud + un formulario "Cotizar"/"Recotizar" colapsable (precio, condiciones, fecha de vigencia opcional). **Verificado**: solicitud inexistente → 404; cotizar una `accepted` → 400; recotizar desde `quoted` → 200; `price` vacío → 400 (DTO); RBAC (401/403/200); correo con contenido escapado. `next build` OK. `tsc` OK. **93 tests / 15 suites** (`licensing.service.spec.ts` gana 6 tests para `quote()`). Bloque L8–L11 en `PRUEBAS_SEGURIDAD.md`. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §16. |
| 2026-09-04 | **Fase 12a — Solicitud de licencia (construida).** Primer tramo de la Fase 12, subdividida por el dueño en 4 sub-tareas de menor a mayor dificultad (12a–12d) para empezar por la más sencilla. Tabla `license_requests` (migración `20260904155252_license_requests`): foto + solicitante + uso previsto (`editorial`/`commercial`/`social`/`print`) + mensaje + presupuesto + estado (`new` por ahora). `src/licensing/` calca a propósito el patrón de `contact` (honeypot, throttle 5/min, `MailService`, `escapeHtml`) — la diferencia real es que valida que la foto esté `published` de un álbum `public` antes de aceptar la solicitud (400 si no: no se puede licenciar lo que no se exhibe). `POST /license-requests` (público, 202) + `GET /license-requests` (bandeja, `admin`+, con miniatura y colección resueltas, sin IP). Frontend: `/studio/licencias` (solo lectura — cotizar/aceptar llegan en 12b/12c), enlazada desde `/studio` y `/admin`. **Verificado**: imageId inexistente → 400; honeypot sin fila; campo extra (`status`) → 400; `intendedUse` inválido → 400; RBAC de la bandeja (401/403/200); ráfaga → 429; sin fuga de IP. `next build` OK (16 rutas). `tsc` OK. **87 tests / 15 suites** (nuevo `licensing.service.spec.ts`, 8 tests). Bloque L1–L7 en `PRUEBAS_SEGURIDAD.md`. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §15. |
| 2026-09-04 | **Fase 11 — Protección de la obra (construida).** El dueño pidió "lo más completo y de mayor seguridad" → embebido de metadatos con `exiftool` real (no solo lo básico de `sharp`). Migración `20260904142447_protection`: `images.rights` (JSON); `site_settings` gana campos de marca de agua y de derechos por defecto. `src/protection/`: `WatermarkService` (SVG rasterizado + `sharp().composite`, mosaico `tiled`/`corner`), `RightsMetadataService` (`exiftool` vía `execFile`, lista fija de etiquetas — nunca shell, nunca el nombre de la etiqueta del usuario), `rights.util.ts`. `ImagesService.upload()` estampa (`public`) y embebe derechos (siempre) en el original y los 4 derivados. `POST/DELETE /site/watermark` (subir/quitar logo, valida por contenido real); `POST/GET /site/watermark/regenerate`. **Dockerfile + Dockerfile.dev**: `libimage-exiftool-perl`. **Frontend**: `/studio/ajustes` gana "Marca de agua" y "Derechos por defecto"; `/studio/[albumId]` gana editor de derechos por imagen; `GalleryImage`/`Lightbox` con disuasores de copia; `Lightbox`/`SiteFooter` muestran el aviso de derechos. **Bug real encontrado y corregido por un test de regresión**: el mosaico de la marca era de tamaño fijo (320px) y `sharp` exige que quepa dentro de la imagen base — el `thumb` (240px) fallaba en silencio y se servía sin marcar; se acotó el mosaico al lado más chico de cada derivado. **Rediseño real**: la regeneración síncrona de ~250 fotos superó los 5 minutos y el cliente HTTP cortó la conexión (verificado, no hipotético) → se rediseñó como trabajo en segundo plano (202 + estado consultable, en memoria del proceso — nunca Redis, documentado como fuera de su alcance). **Límite documentado**: la regeneración solo relee el original con el driver de disco; con Cloudinary cada imagen se cuenta como omitida, sin simularlo. **Verificado**: metadatos reales con `exiftool` en original público y privado; marca solo en derivados `public`; saneo de inyección de saltos de línea/flags; logo falso → 400; RBAC de los 4 endpoints; regeneración real sobre ~250 fotos sin duplicarse. **79 tests / 14 suites**. Bloque P1–P8 en `PRUEBAS_SEGURIDAD.md`. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §14. |
| 2026-09-03 | **Fase 10b — Curación (construida).** Salió de modo diseño (el dueño confirmó el orden de ejecución). `CLAUDE.md` "Qué es este proyecto" reescrito a los 4 ejes (personalización, animación, **protección**, **licenciamiento/venta**). **Backend**: `images.status` (`published`/`draft`/`archived`, default `draft`, índice `(album_id,status)`), migración `20260903220045_image_status` con backfill a `published`; `PATCH /images/:id` acepta `status`; `POST /albums/:id/images/status` (bloque, valida pertenencia → 400); `MediaService.listPublic`/`getGallery` filtran y cuentan solo `published`, portada cae a la primera publicada; `SiteService.toPublic` y `PATCH /site` exigen hero publicado. **Frontend**: `ImageGrid` del gestor con selector de estado por imagen (optimista), checkbox + barra de acciones en bloque, recuentos en vivo, tarjetas `draft` punteadas y `archived` atenuadas; `ImageDto.status` en `studio-types.ts` + CSS. **Seed**: `seed-portfolio.ts` sube todo (244) y publica una selección repartida (`spread()`): 16/14/15/12/14/10 = ~81; portada = foto publicada. **Verificado**: `POST .../images/status` con id ajeno → 400; archivar 4 de "Calle" → `/g` 89→85, restaurado; seed curado → `/galleries` 6 col / 81 publicadas, gestor de "Calle" ve 89 (16 pub + 73 arch); `/`, `/trabajo`, `/sobre`, `/g/<slug>`, `/studio/<id>` → 200; `next build` prod OK; `tsc` OK; **53 tests / 11 suites** (nuevo `images.service.spec.ts`, `site.service.spec.ts` ampliado). Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §13. |
| 2026-09-02 | **Decisiones D9–D13 resueltas + diseño técnico del reencuadre.** El dueño cerró las cinco decisiones abiertas: **D9** marca de agua obligatoria en `public`, con **formulario en el gestor para subir el PNG** (+ texto de respaldo), estampada por el servidor en todos los derivados públicos; **D10** — aclarado que "metadatos" = **capturar** un registro de derechos por imagen (titular, autor, crédito, año, aviso, término de licencia, descripción, keywords) **y embeberlo** en IPTC/XMP en cada archivo servido, con el pipeline pasando de "quitar todo el EXIF" a "quitar solo GPS/serie/personal, poner derechos"; **D11** solo licencia digital por ahora (provisional); **D12** Fase 12 sin cobro, **Fase 13 = Stripe modo test tras flag `PAYMENTS_ENABLED`, diferida ≈2026‑09‑17** (hasta tener cuenta Stripe — el proyecto padre `projects/dvlopr-bn` cobrará de verdad y aún **no tiene** claves Stripe; esta demo solo usará claves de prueba, nunca `live` en el repo público); **D13** campo `category` en `albums` con IA plana por ahora. `PLAN_DESARROLLO.md` §4 pasa D9–D13 a "resueltas" con el *por qué* de cada una; §2 y §10 ajustados (formulario de marca de agua, registro de derechos, Fase 13 con fecha). **`DOCUMENTO_VIVO_ARQUITECTURA.md` §12 nueva** — diseño completo sin construir: modelo de datos (`images.status`/`images.rights`, `albums.category`, campos de marca de agua y derechos en `site_settings`, tablas `license_requests`/`licenses`/`delivery_tokens`), pipeline de marca de agua (`sharp().composite`, tras el re-encode, antes de los derivados), embebido IPTC/XMP, flujo de licenciamiento con diagrama, pago diferido, e impacto en lo ya construido. Sin código — sigue en modo diseño hasta que el dueño confirme. |
| 2026-09-02 | **Reencuadre de alcance: portafolio que protege y vende.** El dueño, tras investigar cómo se arma un portafolio de fotografía que sirva de verdad, amplió el objetivo: el sitio debe demostrar el **kit real para publicar, proteger y vender** obra — marca de agua, derechos embebidos, el archivo bueno tras un muro, y un flujo de licenciamiento — no una galería más "que hoy nadie va a ver". Datos ficticios, funcionalidad real. Analizada la investigación del dueño (7 principios de portafolio + guía tipo VSCO): **adoptados** "mostrar menos de lo que se tiene" (→ estado de publicación por imagen + selección curada), "contacto en un clic desde cualquier lugar", "agrupar por tipo no por cliente", "un scroll por especialidad"; **ya cubiertos** "abrir con imagen no con menú", "poseer el dominio" (D8), "segundas opiniones" (enlaces de compartir); **opcional** separar comercial/editorial (campo `category`); **descartado como software** el resto (proceso del fotógrafo, no del sitio). `PLAN_DESARROLLO.md` reescrito: §1 (marco), §2 (capas nuevas de **protección** y **licenciamiento**), §4 (decisiones abiertas **D9–D13**), §10 (fases **10b Curación**, **11 Protección**, **12 Licenciamiento**, **13 Pago opcional**). Sin código: modo diseño, y las fases 11+ están bloqueadas hasta cerrar D9–D13. Recomendaciones del arquitecto para cada decisión en §4. |
| 2026-09-02 | **Fix: las imágenes no cargaban en el navegador (CORP).** `helmet()` pone `Cross-Origin-Resource-Policy: same-origin` en toda respuesta; en desarrollo el frontend (`:3051`) y la entrega de media (`:3050`) son orígenes distintos, así que el navegador se negaba a pintar cada `<img>` (con `curl` no se veía — CORP no se aplica ahí; salían 200). `GET /media/:key` pasa a marcar `Cross-Origin-Resource-Policy: cross-origin` — es contenido público pensado para CDN, y el control de los privados es la firma HMAC de la URL, no CORP. Las respuestas **JSON** de la API conservan `same-origin`. Verificado: `/media/:key` → `cross-origin`, `/galleries` y `/site` → `same-origin`; `tsc` + 50 tests OK. Ficha F15 en `PRUEBAS_SEGURIDAD.md`. |
| 2026-09-02 | **Fase 10 — seed completo + límite de subida configurable.** `seed-portfolio.ts` pasa a consumir **todo** el contenido de `projects/espiral/images/uso_libre` (244 fotos) en **6 colecciones**: Calle←`Skate/` (89), Tinta←`tatoos/` (37), Muros←`grafitti/` (38), Humo←`smoke/` (25), Ciudad←`Qro/`+`varias/`+`espirales/` (34) y **Cuaderno** nueva ←`*.jpg` sueltos de la raíz (21). Ahora es **convergente**: borra y rehace cada colección del portafolio en cada corrida (suelta antes el `hero_image_id` para no bloquear el borrado de "Calle"). `ImagesService.MAX_UPLOADS_PER_HOUR` se lee de **`UPLOAD_MAX_UPLOADS_PER_HOUR`** (default 120; `.env` de dev → 5000 para sembrar de un tirón, `.env.prod.example` → 120) — sin esto el seed se corta con 429 al pasar de 120 subidas/hora. **Verificado**: `GET /galleries` → 6 colecciones / 244 fotos, todas con portada; `?featured=true` → 4; volumen `gallery_storage` 1260 objetos ≈235 MB; `/` y `/trabajo` → 200 con las 6 tarjetas; `tsc` + 50 tests OK. `.env.example`/`.env.prod.example` documentan la variable. |
| 2026-09-02 | **Primer push al repositorio remoto de GitHub (`github.com/DvloprBn/gallery-component`).** El repo remoto lo creó el dueño vacío (sin README/licencia). El repo **local ya estaba completo** — `git init` hecho desde la Fase 1, rama `main`, 8 commits reales, `origin` ya configurado y árbol de trabajo limpio — así que **NO** se corrió `git init` / `git add` / `git commit -m "first commit"` (esas instrucciones de la página de GitHub son para una carpeta vacía; aquí habrían creado un commit basura o fallado). Lo único que faltaba era el `push`. **Cambio necesario:** `origin` apuntaba a la URL **HTTPS** (`https://github.com/DvloprBn/gallery-component.git`), pero esta máquina solo tiene autenticación **SSH** con GitHub (llave `~/.ssh/id_ed25519_github` sin passphrase, mapeada en `~/.ssh/config` con `IdentitiesOnly yes`; no hay credential helper ni token para HTTPS) — un `push` por HTTPS habría pedido usuario/contraseña y fallado. Se resolvió con `git remote set-url origin git@github.com:DvloprBn/gallery-component.git` (mismo patrón que el resto de repos del dueño: `delyDoggy`, `dvlopr-bn`, `login`). Luego `git push -u origin main` → subió los **8 commits / 161 archivos / historial completo** (`.git` ≈ 3.7 MB); `main` quedó trackeando `origin/main`. **Verificación de seguridad previa al push** (el push publica TODO el historial, no solo HEAD): barrido de los 161 archivos versionados y de cada commit del historial — **0 secretos reales** (sin `sk_live_`/`sk_test_`/llaves AWS/`ghp_`/llaves privadas), **ningún `.env` real versionado** (solo `.env.example` y `.env.prod.example`, que son plantillas), y sin `node_modules/`/`dist/`/`.next/` colados. La identidad de los commits es `dvloprbn <dvloprbn@gmail.com>` tomada de `~/.gitconfig` global del dueño — no se configuró nada nuevo de git. **Sigue pendiente** (no lo hace un push): rotar las llaves de Cloudinary/Resend antes de que el repo sea de acceso amplio, ya que comparten cuenta con `projects/dvlopr-bn` (ver §4 punto 1). |
| 2026-09-02 | **Fase 10 — reencuadre como portafolio de fotografía.** El sitio pasa de "galería genérica" a portafolio de un autor; el motor de colecciones/personalización/animación no cambia y la sección pública (entrar/crear cuenta) sigue visible. **Backend** (migración `20260902200738_portfolio`): `albums.featured` (sale en la portada); `site_settings` (fila única: `site_title`, `owner_name`, `tagline`, `bio`, `about_body`, `contact_email`, `contact_intro`, `instagram`, `hero_image_id`); `contact_messages` (`is_read`, índice `(is_read, created_at)`). Módulos `site` (`GET /site` público, `PATCH /site` `admin`+; valida que el hero sea de un álbum público) y `contact` (`POST /contact` público 202 con **honeypot** `website` + throttle 5/min; `GET/PATCH/DELETE /contact/messages` `admin`+). `MediaService.listPublic({ featuredOnly })` + `GET /galleries?featured=true`. **Frontend**: `SiteHeader`/`SiteFooter` con la identidad de `GET /site` (reemplazan `SiteNav`); `lib/site.tsx` (`SiteProvider`/`useSite`, el layout resuelve `/site` en el servidor); portada nueva (hero a sangre completa con `BlurhashCanvas` + degradado + `owner_name`/`tagline`/CTA, luego bio y colecciones destacadas); `/trabajo` (índice), `/sobre` (retrato + `about_body` en párrafos + "Selección de encargos" fija de demo), `/contacto` (`ContactForm` → `POST /contact`, honeypot en `.hp-field` fuera de pantalla); `/g/[slug]` con "← Trabajo" si es pública; titulares en **serif de sistema** (`--pf-display`, sin webfont). **Gestor**: "Studio" → "Gestor del sitio", "álbum" → "colección"; `AlbumSettingsForm` gana la casilla "Destacar en la portada"; `/studio/ajustes` (editor de identidad + selector de hero entre fotos públicas con vista previa) y `/studio/mensajes` (bandeja: marcar leído / borrar); `/admin` enlaza a ambas. **`scripts/seed-portfolio.ts`** (se corre desde el host — necesita la carpeta de fotos y el backend en `:3050`): persona ficticia "Mara Solís" (fotógrafa documental, Querétaro) + 5 colecciones públicas Calle/Tinta/Muros/Humo/Ciudad (layouts justified/grid/masonry/carousel/masonry; 4 destacadas) con fotos de uso libre reducidas a ≤2400 px y subidas por el pipeline real; idempotente por título; fija portada y `hero_image_id` solo si están vacíos. **Verificado**: `GET /site` tras el seed → persona + `hero` con las 5 URLs de derivados; `GET /galleries` → 5 (todas con portada), `?featured=true` → 4; `POST /contact` honeypot vacío → 202 + fila, honeypot relleno → 202 sin fila; `PATCH /site` con hero de álbum privado → 400; `/`, `/trabajo`, `/sobre`, `/contacto`, `/g/<slug>` → 200; `next build` (`NODE_ENV=production`) → 15 rutas, TypeScript OK; `tsc` backend OK. **Pasada de seguridad** `scripts/probe-fase10.mjs` (24 checks: RBAC `/site` y `/contact/messages` 401/403/200, `heroImageId` de álbum no público → 400, honeypot sin fila, XSS almacenado escapado en el correo, `message`>4000 → 400, whitelist, `@Throttle(5/min)` → 429, `MessageView` sin `ip_address`, `?featured=true` no filtra no-públicas — bloque S1–S13 en `PRUEBAS_SEGURIDAD.md`) + specs `site.service.spec.ts`/`contact.service.spec.ts` → **50 tests / 10 suites**. Detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §11. |
| 2026-09-01 | **Pulido posterior (punto 4 del plan de cierre).** (1) **Pruebas de 11 a 36, 8 suites**: `slug.util`, `media-signing` (HMAC), `image-pipeline.service.spec.ts` (procesa JPEG válido → original + 4 derivados WebP + BlurHash; EXIF eliminado; rechaza texto/SVG/decompression bomb 81 MP), y **`roles.service.spec.ts` + `users.service.spec.ts` de integración contra el Postgres real** (jerarquía: no crear/gestionar nivel ≥ propio, `is_system` protegido, no borrar rol con cuentas, `max_count`, exclusión de la propia cuenta, no auto-gestión; cada rechazo confirma que la BD no cambió; limpieza en `afterAll`). `test/setup-integration.ts` en `jest.setupFiles` (contenedor: `DATABASE_URL` tal cual; host: carga `../.env` y reescribe a `localhost:5438`). (2) **Cloudinary verificado de verdad** con `STORAGE_DRIVER=cloudinary` y carpeta aislada `gallery_devtest`: álbum público → URLs `image/upload` sin firma (200 `image/webp`); álbum privado → URLs `image/authenticated/s--<sig>--` firmadas (200 con firma, **401 sin ella**); borrado → `uploader.destroy` de todos los recursos, carpeta confirmada en 0 recursos (sin huérfanos). Revertido a `STORAGE_DRIVER=disk` + re-sembrada la demo local. (3) **Pulido visual**: landing (título en degradado, tarjetas con elevación al hover), galería pública (tipografía del encabezado, hover sutil en las imágenes), lightbox (`backdrop-filter: blur`, contador `n/total`, pie enmarcado, botones "pill"). Studio/admin se dejan como estaban. **Hallazgo de entorno**: un `*.tsbuildinfo` en el árbol montado hace que `nest start --watch` no emita `dist/main.js` tras `--force-recreate` → borrar `dist`+`*.tsbuildinfo` en el contenedor; los typechecks manuales van con `tsc -p tsconfig.json` (base). `next build` de producción sigue pasando (11 rutas). |
| 2026-09-01 | **Fase 8 (documentación autogenerada) completada y verificada.** Plugin `@nestjs/swagger` en `nest-cli.json` → `/api-json` pasa de 0 a **18 schemas** de DTOs sin `@ApiProperty` manual. `docs/` = portal MkDocs Material (`squidfunk/mkdocs-material:9.5.49` + `mkdocs-swagger-ui-tag`), 5 páginas (Inicio, Arquitectura, Jerarquía de roles, Seguridad, API con Swagger UI embebido en vivo). `gallery_compodoc` = contenedor `node:22-slim` que reusa el `node_modules` del backend y corre `compodoc -s -w` (`@compodoc/compodoc` añadido a devDependencies). Ambos en `docker-compose.yml` **solo `127.0.0.1`** (8098 docs, 8099 compodoc). `ALLOWED_ORIGINS` ganó `http://localhost:8098` (CORS del `/api-json`). **Hallazgos**: `compodoc` v2 renombró `--hostname`→`--host` (sin `--host 0.0.0.0` no llegaba el mapeo de puerto); el `npm ci` del build de producción falló hasta regenerar `gallery_backend/package-lock.json` (había cambiado `package.json`: `prisma`→dependencies, `@compodoc/compodoc` nuevo). **Verificado**: `/api-json` 29 rutas/18 schemas + CORS ok; las 5 páginas del portal → 200; `/api/` embebe el `<swagger-ui>`; compodoc sirve el grafo de 14 módulos y **parsea los TSDoc reales** (la página de `AuthService` muestra el texto exacto del código); el build de producción del backend sigue pasando con el plugin activo. |
| 2026-09-01 | **Fase 9 (despliegue) — artefactos listos y verificados en local.** `gallery_backend/Dockerfile` (build multi-etapa: `npm ci` → `prisma generate` → `nest build` → `npm prune --omit=dev`; runtime `node:22-slim` usuario `node` con node_modules podado + `dist` + `prisma`; arranque = `migrate deploy` + seed roles/cuentas idempotente + `node dist/main.js`; `prisma` movido a `dependencies` para el `migrate deploy` de runtime). `gallery_frontend/Dockerfile` (multi-etapa con `output: 'standalone'`, imagen ≈68 MB; `NEXT_PUBLIC_API_BASE_URL=/api` como `ARG` de build — se hornea en `next build`). `Caddyfile` (un solo site: `/api/*`→backend, resto→frontend; TLS automático). `docker-compose.prod.yml` (Postgres/Redis **sin puertos publicados**; único puerto público = Caddy 80/443; `NODE_ENV=production`, `GLOBAL_PREFIX=api`, `STORAGE_DRIVER=cloudinary`, `env_file: .env.prod`). `.env.prod.example`. `main.ts` activa `trust proxy: 1` en producción (IP real del cliente para la fuerza bruta). **Hallazgos**: `nest build` metía todo en `dist/src/main.js` porque `tsconfig.build.json` incluía `prisma/` y `scripts/` → corregido con `include: ["src/**/*"]` + `rootDir: src` + excludes; el `tsconfig.build.tsbuildinfo` del host se colaba por `COPY . .` y tsc incremental no emitía nada → `*.tsbuildinfo` añadido al `.dockerignore`. **Verificado en local** (`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`, Caddy en `http://localhost`): 5 contenedores, migrate+seed al arrancar, `/api/health` ok, `/api/galleries` 200, `/` 200 (`<title>Galería</title>`, Next standalone), `/api/api-json` → **404** (Swagger off con `NODE_ENV=production`), login por el mismo origen con cookie `HttpOnly` y `/api/auth/me` devolviendo el usuario. Falta lo que no se puede hacer desde aquí: VPS, DNS de `galeria.dvloprbn.dev`, `.env.prod` real. |
| 2026-09-01 | **Fase 5 (Studio + paneles, frontend) completada y verificada.** Infra de sesión en cliente: `apiFetch` (cookies httpOnly, `credentials: include`, `ApiError` con el mensaje de la API), `<AuthProvider>`/`useAuth()` (pide `/auth/me` al montar), `<RequireAuth roles>`, `SiteNav`. Rutas: `/login` (3 pasos en pantallas separadas + `<Suspense>` por `useSearchParams`), `/registro` (auto-login), `/cuenta` (cambio de contraseña + **activación de 2FA con QR real** + 10 códigos de recuperación mostrados una vez + desactivar con contraseña), `/studio` (lista de álbumes + crear con **todos los ajustes de una vez**: visibilidad, layout, tokens del tema), `/studio/[albumId]` (subir varios archivos con estado por archivo, rejilla editable — alt/pie inline, portada, borrar, **reordenar arrastrando** → `POST /images/reorder` —, ajustes del álbum, enlaces de compartir crear/listar/revocar, borrar álbum), `/admin` + `/admin/usuarios` (listar, alta con contraseña temporal, cambiar rol/estado) + `/admin/roles` (listar, crear, borrar) bajo `RequireAuth roles=['admin','director','super']`. **Backend menor**: `AuthenticatedUser` + `/auth/me` ganan `totpEnabled` (leído en vivo en `JwtStrategy`); `GET /albums/:id/share-tokens` nuevo (lista sin el token en claro). **Hallazgo**: `useSearchParams()` exige `<Suspense>` alrededor o `next build` falla al prerenderizar con una recursión engañosa en el runtime de Next. **Verificado con `curl`** (forma exacta de la UI): login 3 pasos + `totpEnabled`, crear álbum con `theme` anidado (persistido), subir imagen + `PATCH coverImageId` + `GET .../images` + `reorder`, share-tokens crear/listar/revocar; las 7 páginas nuevas → 200 SSR; `NODE_ENV=production next build` pasa (11 rutas); `tsc` backend limpio; 11 tests jest. |
| 2026-09-01 | **D8 resuelto + Fase 4 (galería pública, frontend) completada y verificada.** D8: demo **autónoma con su propio ambiente** en **`galeria.dvloprbn.dev`** (subdominio del portafolio); un solo origen (API bajo `/api/*` vía reverse proxy → sin CORS en prod, cookies host-only); solo se comparten Cloudinary + Resend + el dominio raíz. `GLOBAL_PREFIX` (env, vacío en dev) sirve la API bajo `/api` en prod; bloque de producción de referencia añadido a `.env.example`. **Fase 4**: Next.js — `/g/[slug]` (Server Component, valida con Zod, `notFound()` sin acceso, `noindex` si no es público), índice `/` (`GET /galleries`, endpoint nuevo), `not-found`/`global-error` propias. 4 layouts en **CSS puro** (masonry/grid/justified/carousel); animación de entrada por `IntersectionObserver` + transición CSS escalonada; lightbox con teclado/Escape y transiciones CSS — **sin librería de animación** (`motion` se probó y se quitó: menos bundle, mejor rendimiento). `<img srcset>` de los 4 derivados + `sizes` por layout + `loading=lazy` + BlurHash en `<canvas>` detrás. Tema del álbum → CSS custom properties validadas con Zod. `scripts/seed-demo.ts` siembra una galería de demo por el flujo real (8 imágenes). **Hallazgo clave**: `next build` DEBE correr con `NODE_ENV=production` — el compose de dev fija `development` (correcto para `next dev`) y eso rompe el prerender de `/_global-error` con un `useContext` null engañoso; con `production` el build pasa. `fonts-dejavu-core` añadido al Dockerfile del backend (rasterizado de texto en el seed). **Verificado**: `seed-demo` → álbum público con 8 imágenes; `/` y `/g/<slug>` → 200 con el HTML SSR correcto (layout, `g-figure`×8, `g-reveal` escalonado, `srcSet`×4); `/g/no-existe` → 404; `NODE_ENV=production next build` pasa (`/` y `/g/[slug]` dinámicas); `tsc` backend limpio. |
| 2026-09-01 | **Fase 3 (media core) completada y verificada.** `storage` (abstracción + driver disco con firma HMAC + driver Cloudinary con `authenticated`/URL firmada); `media-processing` (pipeline `sharp`: valida por contenido — **se descartó `file-type`, es redundante y ESM-only** —, re-codifica quitando EXIF/GPS, 4 derivados WebP `thumb`/`small`/`medium`/`large`, BlurHash, `limitInputPixels` contra decompression bombs); `albums` (CRUD con visibilidad/layout/tema al crear, enlaces de compartir `album_share_tokens` con caducidad, `canManage` dueño-o-admin, 404 sin acceso, `theme` limitado a 4 KB); `images` (subida con rate limit 120/h + pipeline + transacción con compensación de objetos huérfanos, listado Studio, edición de metadatos, reordenado validado, borrado con limpieza); `media` (`GET /g/:slug` galería pública con control por visibilidad y token de compartir; `GET /media/:key` servido del driver de disco con firma HMAC para privados, `X-Content-Type-Options: nosniff`, cache según visibilidad). **Verificado con `curl` + `sharp`**: texto renombrado `.jpg` → 400, SVG con `<script>` → 400, JPEG con EXIF+GPS subido → **EXIF eliminado del original servido**, PNG 81 MP → 400 (`limitInputPixels`), archivo de 20 MB → 413 (interceptor), IDOR (otro usuario → 404/404/403), URL de privado firmada + `/media/:key` sin firma o manipulada → 404, galería privada sin token → 404 / con enlace de compartir → 200, cambio a `public` → thumb sin firma servido `image/webp`, limpieza total (BD 6/6/0/0/0, **0 archivos** en el volumen). **Hallazgo**: `theme` debe castearse a `Prisma.InputJsonValue`. `tsc` limpio, 11 tests jest verdes. |
| 2026-09-01 | **Fase 2 (identidad) completada y verificada.** Utilidades puras con tests (`crypto.util` AES-256-GCM, `totp.util` RFC 6238, `escape-html.util`, `token.util`, `duration.util`) — 11 tests `jest` verdes. Módulos: `auth` (login 3 pasos en pantallas separadas con challenge token de 5 min entre contraseña y 2FA, registro con auto-login, `refresh` con rotación + gracia de 10 s + revocación en cascada por reuso, `logout`, `/me`, cambio y recuperación de contraseña; JWT `HS256` fijo, access en cookie httpOnly, refresh opaco con solo su `sha256` en BD), `two-factor` (TOTP real vía `otplib` v12, secreto cifrado AES-256-GCM, QR real, 10 códigos de recuperación de un solo uso), `roles` (CRUD dinámico + candado de jerarquía + protección de roles `is_system`), `users` (`assertCanManageRole` + `max_count` sobre cuentas activas, vista segura sin secretos), `security-events` (fuerza bruta en Redis: login 10/15min, 2FA 5/15min, reuso de refresh; fila real + alerta por correo al cruzar umbral), `mail` (Resend por `fetch`, degradación elegante). Guards globales `JwtAuthGuard` (todo exige sesión salvo `@Public()`) + `RolesGuard`. Seed idempotente (6 roles, 6 cuentas de prueba). **Verificado con `curl`**: anti-enumeración, `ValidationPipe` (whitelist), RBAC 403/200, jerarquía de roles y cuentas, `max_count` (2º director → 409), rotación de refresh + reuso → 401 + cascada, logout, 2FA completo (TOTP + código de recuperación, un solo uso, challenge token nunca es sesión), fuerza bruta (10 fallos → 429 + fila `security_events`). **Hallazgos**: `otplib` 13 es reescritura ESM/async → fijado v12; Nest 11 no exporta `TooManyRequestsException` → `HttpException`+`HttpStatus.TOO_MANY_REQUESTS`; `@nestjs/jwt` v12 tipa `expiresIn` estricto → se pasa en segundos. Datos de prueba borrados tras verificar. `tsc` limpio. |
| 2026-09-01 | **Encuadre confirmado: la galería es una demo de vitrina DENTRO del portafolio DvloprBn**, no un producto ni un sistema independiente. Su fin es comercial (mostrar capacidad a clientes potenciales). Se desarrolla autónoma aquí (patrón OmniUser) y se integra/enlaza desde el portafolio. Nueva decisión abierta **D8** (`PLAN_DESARROLLO.md` §4): modelo de integración — subdominio propio enlazado (lo que se está construyendo) vs. módulo dentro del código del portafolio reusando su auth. No bloquea las fases de backend; se resuelve antes de la Fase 4 (frontend) y del despliegue. El estándar de calidad sube, no baja: al ser una herramienta de venta, cada detalle (seguridad, rendimiento, pulido) tiene que verse de producción. |
| 2026-09-01 | **Cloudinary + Resend resueltos: cuenta compartida con el portafolio DvloprBn.** La galería vivirá en el mismo dominio que `projects/dvlopr-bn`, así que reutiliza sus credenciales de Cloudinary (`CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET`) y su `RESEND_API_KEY` — cargadas en `gallery/.env` (ignorado por git), placeholders en `.env.example` (repo público). `CLOUDINARY_FOLDER=gallery` aísla los recursos dentro de la cuenta compartida. En dev sigue `STORAGE_DRIVER=disk`. Riesgo asumido y documentado: un leak de esa credencial afecta a ambos proyectos. |
| 2026-09-01 | **Fase 1 (núcleo/infra) completada y verificada de punta a punta.** Monorepo `gallery_backend` (NestJS 11) + `gallery_frontend` (Next 16 / React 19) + `docker-compose.yml` (Postgres 18, Redis 8, ambos solo `127.0.0.1` + healthcheck). Backend: `main.ts` con helmet + CORS explícito + `ValidationPipe` whitelist + cookie-parser + Swagger dev; `PrismaService` con el **driver adapter de Prisma 7** (`@prisma/adapter-pg` + `pg`; la URL vive en `prisma.config.ts`, ya no en el schema); `RedisService` (ioredis); `validateEnv` al arranque; `GET /health` que verifica Postgres y Redis en vivo. Schema congelado migrado (`20260901235839_init`, 11 tablas). Frontend: landing placeholder + piso de `prefers-reduced-motion`. **Verificado**: `docker compose up -d --build` → 4 contenedores arriba; `/health` `200` `{"status":"ok","checks":{"database":true,"redis":true}}`; frontend `200`; `tsc` 0 errores. **Hallazgos** (detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §2): Prisma 7.10 quitó `url` del schema y exige driver adapter + `prisma.config.ts` + carga manual de `.env`; `migrate reset` bloqueado para agentes de IA (se recreó el volumen de la BD en su lugar); `postgres:18-alpine` monta el volumen en `/var/lib/postgresql`, no `/data`; 3040/3041/5437/5522 estaban ocupados por otro stack → puertos reasignados a 3050/3051/5438/6383/5523/8098/8099. `npm audit`: 4 *high* en transitivas del CLI de Prisma (devDep, sin ruta alcanzable — usamos Postgres), sin fix sin bajar a Prisma 6; en seguimiento. Primer commit del repo git propio. |
| 2026-09-01 | **Decisiones §4 confirmadas + inicio de Fase 1.** El dueño confirmó los 7 defaults propuestos (con D3 resuelto como **Cloudinary**: el backend corre igual su pipeline de seguridad — validación por contenido + re-encode con `sharp` + tiro de EXIF — *antes* de subir el derivado limpio a Cloudinary, que queda como almacén + CDN + entrega, no como límite de seguridad). Schema Prisma congelado. Marcas 🟡 retiradas de la documentación. Arranca la construcción de la Fase 1 (núcleo/infra) — ver `DOCUMENTO_VIVO_ARQUITECTURA.md` §2. |
| 2026-09-01 | **Documentación inicial del proyecto, autocontenida.** Set completo de documentos creado (`CLAUDE.md`, `PLAN_DESARROLLO.md`, `DOCUMENTO_VIVO_ARQUITECTURA.md`, este archivo, `APRENDIZAJE.md`, `PRUEBAS_SEGURIDAD.md`, `BIBLIOGRAFIA.md`, `README.md`). Diseño técnico provisional: monorepo, puertos, schema identidad + media, pipeline de subida seguro en 10 pasos, servido con URLs firmadas, módulos y endpoints, objeto `theme` de personalización. Sin código de aplicación (modo diseño). |
