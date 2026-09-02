# Estado del Proyecto — Galería

> Bitácora de estado día a día. Se actualiza cada vez que se pide o al cerrar un hito.
> La estrategia y las decisiones que no cambian seguido viven en `PLAN_DESARROLLO.md`.

Última actualización: **2026-09-01**

---

## 1. Dónde estamos

**Todas las fases + pulido posterior completos (2026-09-01).** Lo último:

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

Las fases planificadas (`PLAN_DESARROLLO.md` §10) están **todas completas**: 1 infra · 2 identidad ·
3 media · 4 galería pública · 5 Studio · 6 animación (resuelta con CSS en la Fase 4) · 7 seguridad
transversal (`PRUEBAS_SEGURIDAD.md`) · 8 docs · 9 despliegue (artefactos).

Lo que queda, cuando el dueño quiera:

1. **Desplegar de verdad**: VPS + DNS de `galeria.dvloprbn.dev` + `.env.prod` con secretos reales,
   y `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
2. **Enlazar la demo desde el portafolio** `projects/dvlopr-bn`.
3. Opcional: tests de integración de jerarquía/pipeline; probar `STORAGE_DRIVER=cloudinary` contra
   la cuenta real con `seed-demo`; pulido visual del frontend.

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
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
