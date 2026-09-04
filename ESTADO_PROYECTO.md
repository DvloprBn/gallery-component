# Estado del Proyecto — Galería

> Bitácora de estado día a día. Se actualiza cada vez que se pide o al cerrar un hito.
> La estrategia y las decisiones que no cambian seguido viven en `PLAN_DESARROLLO.md`.

Última actualización: **2026-09-02**

---

## 1. Dónde estamos

**Todas las fases + pulido + endurecimiento + reencuadre + protección completos (2026-09-04).**

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
  + media (`albums`/`images`/`image_variants`/`album_share_tokens`). Migración inicial única
  `20260901235839_init`.
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
4. **Fase 10b y 11 hechas.** Sigue la **Fase 12** (licenciamiento: solicitud → cotización → entrega
   firmada de un solo uso). La Fase 13 (pago Stripe) espera a ≈2026‑09‑17. `CLAUDE.md`
   "Qué es este proyecto" actualizado al marco nuevo.

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
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
