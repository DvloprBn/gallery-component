# Estado del Proyecto — Galería

> Bitácora de estado día a día. Se actualiza cada vez que se pide o al cerrar un hito.
> La estrategia y las decisiones que no cambian seguido viven en `PLAN_DESARROLLO.md`.

Última actualización: **2026-09-01**

---

## 1. Dónde estamos

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

**Fase 4 — Galería pública (frontend)** (`PLAN_DESARROLLO.md` §10): `/g/[slug]` en Next.js con los
layouts (masonry / justified / grid / carousel), `next/image` con `srcset` desde los derivados,
carga perezosa, placeholder BlurHash, lightbox base. **Depende de D8** (modelo de integración con
el portafolio) — conviene resolverlo antes de invertir en el frontend. En paralelo (backend):
tests de integración de la jerarquía y del pipeline; conmutar `STORAGE_DRIVER=cloudinary` y probar
contra la cuenta real; el portal de documentación autogenerada (`docs/` + Compodoc).

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
| 2026-09-01 | **Fase 3 (media core) completada y verificada.** `storage` (abstracción + driver disco con firma HMAC + driver Cloudinary con `authenticated`/URL firmada); `media-processing` (pipeline `sharp`: valida por contenido — **se descartó `file-type`, es redundante y ESM-only** —, re-codifica quitando EXIF/GPS, 4 derivados WebP `thumb`/`small`/`medium`/`large`, BlurHash, `limitInputPixels` contra decompression bombs); `albums` (CRUD con visibilidad/layout/tema al crear, enlaces de compartir `album_share_tokens` con caducidad, `canManage` dueño-o-admin, 404 sin acceso, `theme` limitado a 4 KB); `images` (subida con rate limit 120/h + pipeline + transacción con compensación de objetos huérfanos, listado Studio, edición de metadatos, reordenado validado, borrado con limpieza); `media` (`GET /g/:slug` galería pública con control por visibilidad y token de compartir; `GET /media/:key` servido del driver de disco con firma HMAC para privados, `X-Content-Type-Options: nosniff`, cache según visibilidad). **Verificado con `curl` + `sharp`**: texto renombrado `.jpg` → 400, SVG con `<script>` → 400, JPEG con EXIF+GPS subido → **EXIF eliminado del original servido**, PNG 81 MP → 400 (`limitInputPixels`), archivo de 20 MB → 413 (interceptor), IDOR (otro usuario → 404/404/403), URL de privado firmada + `/media/:key` sin firma o manipulada → 404, galería privada sin token → 404 / con enlace de compartir → 200, cambio a `public` → thumb sin firma servido `image/webp`, limpieza total (BD 6/6/0/0/0, **0 archivos** en el volumen). **Hallazgo**: `theme` debe castearse a `Prisma.InputJsonValue`. `tsc` limpio, 11 tests jest verdes. |
| 2026-09-01 | **Fase 2 (identidad) completada y verificada.** Utilidades puras con tests (`crypto.util` AES-256-GCM, `totp.util` RFC 6238, `escape-html.util`, `token.util`, `duration.util`) — 11 tests `jest` verdes. Módulos: `auth` (login 3 pasos en pantallas separadas con challenge token de 5 min entre contraseña y 2FA, registro con auto-login, `refresh` con rotación + gracia de 10 s + revocación en cascada por reuso, `logout`, `/me`, cambio y recuperación de contraseña; JWT `HS256` fijo, access en cookie httpOnly, refresh opaco con solo su `sha256` en BD), `two-factor` (TOTP real vía `otplib` v12, secreto cifrado AES-256-GCM, QR real, 10 códigos de recuperación de un solo uso), `roles` (CRUD dinámico + candado de jerarquía + protección de roles `is_system`), `users` (`assertCanManageRole` + `max_count` sobre cuentas activas, vista segura sin secretos), `security-events` (fuerza bruta en Redis: login 10/15min, 2FA 5/15min, reuso de refresh; fila real + alerta por correo al cruzar umbral), `mail` (Resend por `fetch`, degradación elegante). Guards globales `JwtAuthGuard` (todo exige sesión salvo `@Public()`) + `RolesGuard`. Seed idempotente (6 roles, 6 cuentas de prueba). **Verificado con `curl`**: anti-enumeración, `ValidationPipe` (whitelist), RBAC 403/200, jerarquía de roles y cuentas, `max_count` (2º director → 409), rotación de refresh + reuso → 401 + cascada, logout, 2FA completo (TOTP + código de recuperación, un solo uso, challenge token nunca es sesión), fuerza bruta (10 fallos → 429 + fila `security_events`). **Hallazgos**: `otplib` 13 es reescritura ESM/async → fijado v12; Nest 11 no exporta `TooManyRequestsException` → `HttpException`+`HttpStatus.TOO_MANY_REQUESTS`; `@nestjs/jwt` v12 tipa `expiresIn` estricto → se pasa en segundos. Datos de prueba borrados tras verificar. `tsc` limpio. |
| 2026-09-01 | **Encuadre confirmado: la galería es una demo de vitrina DENTRO del portafolio DvloprBn**, no un producto ni un sistema independiente. Su fin es comercial (mostrar capacidad a clientes potenciales). Se desarrolla autónoma aquí (patrón OmniUser) y se integra/enlaza desde el portafolio. Nueva decisión abierta **D8** (`PLAN_DESARROLLO.md` §4): modelo de integración — subdominio propio enlazado (lo que se está construyendo) vs. módulo dentro del código del portafolio reusando su auth. No bloquea las fases de backend; se resuelve antes de la Fase 4 (frontend) y del despliegue. El estándar de calidad sube, no baja: al ser una herramienta de venta, cada detalle (seguridad, rendimiento, pulido) tiene que verse de producción. |
| 2026-09-01 | **Cloudinary + Resend resueltos: cuenta compartida con el portafolio DvloprBn.** La galería vivirá en el mismo dominio que `projects/dvlopr-bn`, así que reutiliza sus credenciales de Cloudinary (`CLOUDINARY_CLOUD_NAME`/`API_KEY`/`API_SECRET`) y su `RESEND_API_KEY` — cargadas en `gallery/.env` (ignorado por git), placeholders en `.env.example` (repo público). `CLOUDINARY_FOLDER=gallery` aísla los recursos dentro de la cuenta compartida. En dev sigue `STORAGE_DRIVER=disk`. Riesgo asumido y documentado: un leak de esa credencial afecta a ambos proyectos. |
| 2026-09-01 | **Fase 1 (núcleo/infra) completada y verificada de punta a punta.** Monorepo `gallery_backend` (NestJS 11) + `gallery_frontend` (Next 16 / React 19) + `docker-compose.yml` (Postgres 18, Redis 8, ambos solo `127.0.0.1` + healthcheck). Backend: `main.ts` con helmet + CORS explícito + `ValidationPipe` whitelist + cookie-parser + Swagger dev; `PrismaService` con el **driver adapter de Prisma 7** (`@prisma/adapter-pg` + `pg`; la URL vive en `prisma.config.ts`, ya no en el schema); `RedisService` (ioredis); `validateEnv` al arranque; `GET /health` que verifica Postgres y Redis en vivo. Schema congelado migrado (`20260901235839_init`, 11 tablas). Frontend: landing placeholder + piso de `prefers-reduced-motion`. **Verificado**: `docker compose up -d --build` → 4 contenedores arriba; `/health` `200` `{"status":"ok","checks":{"database":true,"redis":true}}`; frontend `200`; `tsc` 0 errores. **Hallazgos** (detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §2): Prisma 7.10 quitó `url` del schema y exige driver adapter + `prisma.config.ts` + carga manual de `.env`; `migrate reset` bloqueado para agentes de IA (se recreó el volumen de la BD en su lugar); `postgres:18-alpine` monta el volumen en `/var/lib/postgresql`, no `/data`; 3040/3041/5437/5522 estaban ocupados por otro stack → puertos reasignados a 3050/3051/5438/6383/5523/8098/8099. `npm audit`: 4 *high* en transitivas del CLI de Prisma (devDep, sin ruta alcanzable — usamos Postgres), sin fix sin bajar a Prisma 6; en seguimiento. Primer commit del repo git propio. |
| 2026-09-01 | **Decisiones §4 confirmadas + inicio de Fase 1.** El dueño confirmó los 7 defaults propuestos (con D3 resuelto como **Cloudinary**: el backend corre igual su pipeline de seguridad — validación por contenido + re-encode con `sharp` + tiro de EXIF — *antes* de subir el derivado limpio a Cloudinary, que queda como almacén + CDN + entrega, no como límite de seguridad). Schema Prisma congelado. Marcas 🟡 retiradas de la documentación. Arranca la construcción de la Fase 1 (núcleo/infra) — ver `DOCUMENTO_VIVO_ARQUITECTURA.md` §2. |
| 2026-09-01 | **Documentación inicial del proyecto, autocontenida.** Set completo de documentos creado (`CLAUDE.md`, `PLAN_DESARROLLO.md`, `DOCUMENTO_VIVO_ARQUITECTURA.md`, este archivo, `APRENDIZAJE.md`, `PRUEBAS_SEGURIDAD.md`, `BIBLIOGRAFIA.md`, `README.md`). Diseño técnico provisional: monorepo, puertos, schema identidad + media, pipeline de subida seguro en 10 pasos, servido con URLs firmadas, módulos y endpoints, objeto `theme` de personalización. Sin código de aplicación (modo diseño). |
