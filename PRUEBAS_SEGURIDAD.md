# Pruebas de Seguridad — Galería

> Cubre sistemáticamente el **OWASP API Security Top 10 (2023)** contra cada endpoint real que se
> construya, más un bloque específico de **seguridad de archivos** que una API normal no tiene.
>
> **Formato de cada prueba** (para que el dueño la pueda replicar, no solo leer que "ya se probó"):
> 1. **Qué vulnerabilidad prueba** y por qué importa en este caso concreto.
> 2. **Cómo reproducirla a mano** — comando exacto (`curl` / `psql` / script).
> 3. **Qué cuenta como "pasa"**.
> 4. **Resultado real** — fecha en que se corrió y qué pasó.
>
> Arranca **vacío**: sin endpoints todavía no hay nada que probar. Se llena en paralelo a cada
> pieza construida (`PLAN_DESARROLLO.md` §10, fase 7), nunca todo al final.

Estado global: **Fases 2 (identidad), 3 (media), 5 (Studio) y 10 (portafolio: `/site` + `/contact`)
verificadas.** Verificados con `curl` / scripts contra el backend en vivo los puntos de OWASP API
Top 10 que aplican, el bloque de **seguridad de archivos** (F1–F14) y el de identidad de sitio /
contacto (S1–S13 — ver más abajo). Pendiente para producción: confirmar API9 (inventario) y correr
F7/F10 con volumen/espera reales.

### OWASP API Security Top 10 — cobertura tras la Fase 10

| # | Categoría | Estado |
|---|---|---|
| API1 — IDOR | ✅ Probado: `/users/:id`, `/roles/:id` por jerarquía; **álbumes e imágenes privadas** filtran por dueño (otro usuario → 404/403); `/media/:key` privado exige firma HMAC. |
| API2 — Broken Authentication | ✅ Probado: anti-enumeración (`login/step1` idéntico), challenge token de 2FA nunca es sesión (401 en `/auth/me`), logout revoca el refresh en BD, reuso de refresh → cascada, JWT `HS256` fijo. |
| API3 — Mass Assignment | ✅ Probado: propiedad extra en el body (`role_id` en registro; `is_read`/`messageId` en `POST /contact`) → 400 por `forbidNonWhitelisted`. |
| API4 — Unrestricted Resource Consumption | ✅ Probado: fuerza bruta login/2FA → 429; **subida**: `limits.fileSize` → 413, `limitInputPixels` → 400, rate limit 120/h por usuario; **`POST /contact`** con `@Throttle(5/min)` → 429 en la ráfaga; `message` > 4000 → 400. |
| API5 — Broken Function Level Authorization | ✅ Probado: `usuario` → `GET /users` 403; jerarquía de niveles en `roles`/`users` (crear nivel ≥ propio → 403); `is_system` protegido (409); **`PATCH /site` y `GET/PATCH/DELETE /contact/messages`**: sin sesión → 401, `usuario` → 403, `admin`+ → 200. |
| API6 — Sensitive Business Flows | ✅ Parcial: registro y login limitados por el mismo mecanismo de API4. |
| API7 — SSRF | No aplica todavía (sin "importar imagen por URL" ni OAuth). |
| API8 — Security Misconfiguration | ✅ helmet, CORS explícito, Swagger solo dev, secretos fuera de git; cabeceras de seguridad del frontend (CSP env-aware, `X-Frame-Options`, HSTS en prod) — Fase 10 hardening. |
| API9 — Improper Inventory Management | ⬜ Pendiente de confirmar en runtime de producción. |
| API10 — Unsafe Consumption of APIs | No aplica todavía. |

### Configuración de seguridad ya verificada en la Fase 1

- [x] CORS restringido a lista **explícita** (`ALLOWED_ORIGINS`), nunca `*`; lista vacía ⇒ se
      rechaza todo origen cruzado (`main.ts`).
- [x] Postgres y Redis publican **solo en `127.0.0.1`** (nunca a la red) — `docker-compose.yml`.
- [x] Redis con contraseña (`--requirepass`), no abierto.
- [x] `helmet()` activo (cabeceras de seguridad por defecto).
- [x] `ValidationPipe` global con `whitelist: true` + `forbidNonWhitelisted: true` — cualquier
      propiedad no declarada en el DTO hace fallar la petición.
- [x] Validación de entorno al arranque: falta de variable obligatoria o `TOTP_ENCRYPTION_KEY`
      mal formada ⇒ el proceso no arranca (`validateEnv`).
- [x] Swagger / `api-json` servidos **solo** si `NODE_ENV !== 'production'`.
- [x] Secretos fuera de git (`.env` en `.gitignore`), con entropía real (`openssl rand`), propios
      de este proyecto (no compartidos con ningún otro).
### Añadido y verificado en la Fase 2

- [x] Cookies de sesión `httpOnly`, `sameSite: 'lax'`, `secure` en producción, `domain` opcional
      (`COOKIE_DOMAIN`) — `src/auth/cookies.ts`.
- [x] Algoritmo JWT fijado explícito a `HS256` en firma **y** verificación (`AuthModule`,
      `JwtStrategy`) — nunca se negocia con el cliente.
- [x] Access token en cookie httpOnly; refresh token opaco de 256 bits, en BD solo su `sha256`
      (indexable, sin coste bcrypt donde no aporta).
- [x] Rotación de refresh con ventana de gracia (10 s); reuso fuera de la ventana ⇒ revocación en
      cascada de **todas** las sesiones de la cuenta.
- [x] Rate limiting / fuerza bruta dedicado en login (10/15 min), 2FA (5/15 min) y reuso de
      refresh, por debajo del límite global — `SecurityEventsService`.
- [x] Secreto TOTP cifrado en reposo (AES-256-GCM, llave propia ≠ `JWT_SECRET`); códigos de
      recuperación hasheados (bcrypt), de un solo uso.
- [x] Candado de jerarquía en `roles` y `users`: nadie crea/gestiona un rol o cuenta de nivel ≥ al
      suyo (bloquea la auto-escalación de privilegios).
- [x] Cambio/reset de contraseña revoca todas las sesiones de refresh de la cuenta.
- [x] Anti-enumeración de cuentas en `login/step1` y `forgot-password` (respuesta genérica).

### Añadido y verificado en la Fase 10 (portafolio: `/site` + `/contact`)

- [x] `GET /site` es `@Public()` pero **solo proyecta** los campos públicos (`SiteService.toPublic`)
      — nunca la columna `id` ni `updated_at`.
- [x] `PATCH /site` valida que `heroImageId` pertenezca a una imagen de un álbum **`public`**
      (si no → 400, sin escribir). El hero se sirve **sin firma** en una página cacheable; una
      imagen de un álbum privado/unlisted ahí sería una fuga.
- [x] `POST /contact` **honeypot**: el campo `website` no se muestra (CSS `.hp-field` fuera de
      pantalla y del orden de tabulación); si llega con contenido, se responde 202 y **no se
      guarda ni se envía nada** — no se revela que se detectó el bot.
- [x] `POST /contact` con `@Throttle({ limit: 5, ttl: 60_000 })` propio, por debajo del global.
- [x] El texto libre del contacto (`name`, `message`) se **escapa** (`escapeHtml`) antes de
      interpolarse en el HTML del correo — anti-XSS almacenado. La fila guarda el texto crudo;
      el escape es responsabilidad de cada capa de salida.
- [x] `MailService.send` **nunca lanza** (captura error de red y `!response.ok` → `{delivered:false}`)
      → un fallo de correo no convierte el `POST /contact` en 500 tras guardar la fila.
- [x] `contact_messages.ip_address` se registra **solo en la fila** (para el panel); `MessageView`
      (la forma que devuelve `GET /contact/messages`) **no** incluye la IP.
- [x] `PATCH`/`DELETE /contact/messages/:id` con `ParseUUIDPipe` → un `:id` no-UUID es 400 antes de
      tocar la BD; `markRead`/`remove` usan `updateMany`/`deleteMany` acotados por `message_id`.
- [x] `GET /galleries?featured=true` filtra por `visibility: 'public'` **y** `featured: true`: una
      colección `unlisted`/`private` marcada como destacada **no** aparece.
- Specs: `src/site/site.service.spec.ts` (7) y `src/contact/contact.service.spec.ts` (7) —
  50 tests / 10 suites en total.

### Deuda de seguridad conocida

| Ítem | Detalle | Plan |
|---|---|---|
| `npm audit` — 4 *high* | `mysql2 <3.22.0` y `deepmerge-ts <8.0.0`, transitivas del **CLI de Prisma** (`@prisma/config`). **devDependency**; sin ruta de explotación aquí (proyecto PostgreSQL, no MySQL; `deepmerge-ts` solo procesa el config de Prisma). | `npm audit fix --force` propone bajar a Prisma 6 — no se acepta. Seguir releases de Prisma 7 y actualizar al parche de transitivas. |

---

## Bloque específico — Seguridad de archivos de imagen

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| F1 | Tipo falsificado por extensión | Texto plano renombrado `.jpg` (con `Content-Type: image/jpeg`) → `sharp` no lo decodifica → **400** | ✅ Probado 2026-09-01 |
| F2 | Tipo falsificado por `Content-Type` | Ídem F1 — el `Content-Type` del cliente se ignora; manda `sharp` | ✅ Probado 2026-09-01 |
| F3 | Payload embebido / polyglot | El re-encode con `sharp` reescribe la imagen entera — nada tras el EOI sobrevive (mismo mecanismo confirmado por F11) | ✅ Cubierto por diseño |
| F4 | SVG con `<script>` | `<svg><script>` renombrado → formato `svg` no está en la lista blanca → **400** | ✅ Probado 2026-09-01 |
| F5 | Decompression bomb | PNG 9000×9000 (81 MP, 253 KB) → **400** por `limitInputPixels` (tope `UPLOAD_MAX_IMAGE_PIXELS`) | ✅ Probado 2026-09-01 |
| F6 | DoS por tamaño | Archivo de 20 MB (tope 15 MiB) → **413** cortado en el `FileInterceptor` | ✅ Probado 2026-09-01 |
| F7 | DoS por volumen | Rate limit dedicado (120 subidas/hora por usuario, contador en Redis) → 429 | ⬜ Implementado, falta prueba en runtime |
| F8 | IDOR de imagen privada | Otro usuario: `GET /albums/:id` → 404, `GET /albums/:id/images` → 404, `DELETE /images/:id` → 403; `/media/:key` de un privado sin firma → 404 | ✅ Probado 2026-09-01 |
| F9 | URL firmada manipulada | `exp`+`sig` inventados → **404**; firma HMAC válida no expirada → 200 | ✅ Probado 2026-09-01 |
| F10 | URL firmada expirada | `verifyMediaSignature` rechaza si `exp*1000 < now` (TTL por defecto 300 s) | ⬜ Implementado, falta prueba con espera real |
| F11 | Fuga de EXIF/GPS | JPEG con 212 B de EXIF + GPS subido → el original **servido** tiene 0 bytes de EXIF (`sharp().metadata()`) | ✅ Probado 2026-09-01 |
| F12 | Enumeración de álbumes | `GET /g/:slug` de un privado sin token → **404** (indistinguible de inexistente); `getOwned` devuelve 404, no 403 | ✅ Probado 2026-09-01 |
| F13 | Path traversal en nombre | `original_name` saneado (`basename` + lista blanca); `storage_key` lo genera el servidor; `DiskStorageDriver.pathFor` revalida el patrón `<uuid>.<ext>` antes de tocar el FS | ✅ Cubierto por diseño |
| F14 | Ruta de storage adivinable | `storage_key` = `randomUUID()` + extensión canónica; nada derivado del cliente | ✅ Cubierto por diseño |

---

## Bloque específico — Identidad de sitio y formulario de contacto (`/site`, `/contact`)

Reproducible con el script `scripts/probe-fase10` (24 comprobaciones, se corre contra el backend de
dev en `:3050`; restaura `site_settings` y borra los mensajes de prueba al terminar).

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| S1 | `GET /site` sin sesión | 200; el cuerpo NO trae `id` ni `updatedAt` | ✅ Probado 2026-09-02 |
| S2 | `PATCH /site` sin sesión | → **401** | ✅ Probado 2026-09-02 |
| S3 | `PATCH /site` como `usuario` | → **403** (solo `admin`/`director`/`super`) | ✅ Probado 2026-09-02 |
| S4 | `PATCH /site` `heroImageId` inexistente | UUID válido pero sin fila → **400**, sin escribir | ✅ Probado 2026-09-02 |
| S5 | `PATCH /site` `heroImageId` de álbum no público | imagen de un álbum `private`/`unlisted` → **400** | ✅ Probado 2026-09-02 |
| S6 | `PATCH /site` `heroImageId: null` | 200, `hero` queda en `null` (no rompe) | ✅ Probado 2026-09-02 |
| S7 | `GET /galleries?featured=true` | una colección `unlisted`+`featured` **no** aparece | ✅ Probado 2026-09-02 |
| S8 | `POST /contact` honeypot | `website` con contenido → **202** y **0 filas** nuevas | ✅ Probado 2026-09-02 |
| S9 | `POST /contact` XSS almacenado | `<script>`/`onerror` en `name`/`message` → el HTML del correo los lleva escapados (`&lt;script&gt;`) | ✅ Probado 2026-09-02 (curl + spec) |
| S10 | `POST /contact` validación | `message` > 4000 → 400; email inválido → 400; campo extra → 400 | ✅ Probado 2026-09-02 |
| S11 | `POST /contact` throttle | ráfaga > 5/min → **429** | ✅ Probado 2026-09-02 |
| S12 | `/contact/messages` RBAC | sin sesión → 401; `usuario` → 403 (GET y DELETE) | ✅ Probado 2026-09-02 |
| S13 | `/contact/messages` fuga de IP + `:id` | la respuesta no trae `ipAddress`; `:id` no-UUID → 400 | ✅ Probado 2026-09-02 |

---

## Checklist transversal (se responde revisando el código real, no en abstracto)

- [ ] ¿`ALLOWED_ORIGINS`/CORS explícito, nunca `*`, en producción?
- [ ] ¿Postgres/Redis SIN puerto publicado al host — solo red interna de Docker?
- [ ] ¿El único puerto público real es el del reverse proxy (80/443)?
- [ ] ¿Todas las variables `NEXT_PUBLIC_*` llegan como `build.args`, no solo `environment:`?
- [ ] ¿Se comparó variable por variable el compose de desarrollo contra el de producción?
- [ ] ¿Los secretos (JWT, llave AES, credenciales de S3) tienen entropía real y viven fuera de git?
- [ ] ¿El algoritmo JWT está fijado explícitamente (`HS256`), no negociado?
- [ ] ¿Detectar reuso de refresh token fuera de la ventana de gracia revoca TODAS las sesiones?
- [ ] ¿Rate limiting dedicado en login/registro/reset/subida, por debajo del límite global?
- [ ] ¿Las cookies de sesión tienen `httpOnly`, `secure` en producción y `domain` explícito?
- [ ] ¿Cualquier texto libre (título de álbum, caption, alt) que se interpola en HTML de correo o
      en JSON-LD pasa por `escapeHtml()` real?
- [ ] ¿El objeto `theme` se valida contra un schema (Zod) y se traduce a CSS custom properties,
      nunca se inyecta crudo en un `<style>`?
- [ ] ¿Se probó en vivo `Cross-Origin-Embedder-Policy`/`Cross-Origin-Opener-Policy` antes de
      agregarlos? (pueden romper imágenes de un CDN de terceros sin ningún error visible)
- [ ] ¿El contenedor corre en UTC y se distingue instante (`timestamptz`) de fecha pura (`date`)?
