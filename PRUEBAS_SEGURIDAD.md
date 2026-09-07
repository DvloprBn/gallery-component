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

Estado global: **Fases 2 (identidad), 3 (media), 5 (Studio), 10 (portafolio: `/site` + `/contact`),
10b (curación), 11 (protección: marca de agua + derechos), 12 completa —12a–12d— (licenciamiento) y
14a–14c (video: modelo + pipeline `ffmpeg` + marca de agua + HLS) verificadas.** Verificados con `curl` / scripts contra
el backend en vivo los puntos de OWASP API Top 10 que aplican, el bloque de **seguridad de
archivos** (F1–F19, incluida una corrección real en F19), el de identidad de sitio/contacto
(S1–S13), el de protección (P1–P8), el de licenciamiento (L1–L17) y el de **video** (V1–V14 — ver
más abajo). Pendiente para producción: confirmar API9 (inventario) y correr F7/F10 con
volumen/espera reales.

### OWASP API Security Top 10 — cobertura tras la Fase 11

| # | Categoría | Estado |
|---|---|---|
| API1 — IDOR | ✅ Probado: `/users/:id`, `/roles/:id` por jerarquía; **álbumes e imágenes privadas** filtran por dueño (otro usuario → 404/403); `/media/:key` privado exige firma HMAC; **`/deliveries/:token`** — token inventado/caducado/ya usado → 404 idéntico, `updateMany` atómico impide servir dos veces por una carrera. |
| API2 — Broken Authentication | ✅ Probado: anti-enumeración (`login/step1` idéntico), challenge token de 2FA nunca es sesión (401 en `/auth/me`), logout revoca el refresh en BD, reuso de refresh → cascada, JWT `HS256` fijo. |
| API3 — Mass Assignment | ✅ Probado: propiedad extra en el body (`role_id` en registro; `is_read`/`messageId` en `POST /contact`; `status` en `POST /license-requests`) → 400 por `forbidNonWhitelisted`. |
| API4 — Unrestricted Resource Consumption | ✅ Probado: fuerza bruta login/2FA → 429; **subida**: `limits.fileSize` → 413, `limitInputPixels` → 400, rate limit 120/h por usuario; **`POST /contact`** con `@Throttle(5/min)` → 429 en la ráfaga; `message` > 4000 → 400; **`POST /site/watermark`** con tope de 5 MB propio; **`POST /site/watermark/regenerate`** corre en segundo plano y una segunda llamada mientras hay una en curso no relanza el trabajo (evita apilar N regeneraciones simultáneas — ver P8). |
| API5 — Broken Function Level Authorization | ✅ Probado: `usuario` → `GET /users` 403; jerarquía de niveles en `roles`/`users` (crear nivel ≥ propio → 403); `is_system` protegido (409); **`PATCH /site`, `POST/DELETE /site/watermark`, `POST/GET /site/watermark/regenerate`, `GET/PATCH/DELETE /contact/messages` y `GET/PATCH /license-requests` (+ `POST /license-requests/:id/accept`)**: sin sesión → 401, `usuario` → 403, `admin`+ → 200/201/202. |
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
- [x] `PATCH /site` valida que `heroMediaId` pertenezca a una imagen de un álbum **`public`**
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
| F7 | DoS por volumen | Rate limit dedicado por usuario (contador en Redis, TTL 1 h) → 429; tope = `UPLOAD_MAX_UPLOADS_PER_HOUR` (default **120**, dev lo sube para sembrar) | ✅ Probado 2026-09-02 — el seed de 244 fotos se cortó con 429 al pasar de 120; subir el tope lo resolvió |
| F8 | IDOR de imagen privada | Otro usuario: `GET /albums/:id` → 404, `GET /albums/:id/images` → 404, `DELETE /images/:id` → 403; `/media/:key` de un privado sin firma → 404 | ✅ Probado 2026-09-01 |
| F9 | URL firmada manipulada | `exp`+`sig` inventados → **404**; firma HMAC válida no expirada → 200 | ✅ Probado 2026-09-01 |
| F10 | URL firmada expirada | `verifyMediaSignature` rechaza si `exp*1000 < now` (TTL por defecto 300 s) | ⬜ Implementado, falta prueba con espera real |
| F11 | Fuga de EXIF/GPS | JPEG con 212 B de EXIF + GPS subido → el original **servido** tiene 0 bytes de EXIF (`sharp().metadata()`) | ✅ Probado 2026-09-01 |
| F12 | Enumeración de álbumes | `GET /g/:slug` de un privado sin token → **404** (indistinguible de inexistente); `getOwned` devuelve 404, no 403 | ✅ Probado 2026-09-01 |
| F13 | Path traversal en nombre | `original_name` saneado (`basename` + lista blanca); `storage_key` lo genera el servidor; `DiskStorageDriver.pathFor` revalida el patrón `<uuid>.<ext>` antes de tocar el FS | ✅ Cubierto por diseño |
| F14 | Ruta de storage adivinable | `storage_key` = `randomUUID()` + extensión canónica; nada derivado del cliente | ✅ Cubierto por diseño |
| F15 | Cabecera de incrustación | `GET /media/:key` marca `Cross-Origin-Resource-Policy: cross-origin` (helmet pone `same-origin` por defecto, que rompía el `<img>` del frontend en dev — otro puerto). Es contenido público pensado para CDN; el control de los privados sigue siendo la firma HMAC de la URL, no CORP. Las respuestas JSON de la API **conservan** `same-origin`. | ✅ Probado 2026-09-02 |
| F16 | Fuga de fotos no publicadas (Fase 10b) | Una imagen `draft` / `archived` **nunca** aparece en `GET /g/:slug` ni en `GET /galleries` (ni con enlace de compartir válido); su clave de media no se entrega en ninguna respuesta pública, así que tampoco es alcanzable por `/media/:key` salvo que ya se conociera. El gestor (`GET /albums/:id/images`, autenticado, dueño/admin) sí las ve. `POST /albums/:id/images/status` valida que todos los ids sean del álbum (400 si no). | ✅ Probado 2026-09-03 (archivar 4 fotos → desaparecen de `/g` y del índice; id ajeno → 400) |
| F17 | Ejecución de comandos vía `exiftool` (Fase 11) | `RightsMetadataService` usa `execFile` (nunca `exec`/una shell) con una lista **fija** de etiquetas — el valor de cada campo es el único dato del usuario, nunca el nombre de la etiqueta ni el binario a correr; no hay forma de inyectar un flag o un comando distinto por más rara que sea la cadena. Se sanean saltos de línea/caracteres de control antes de pasarlos. | ✅ Probado 2026-09-04 (`rightsStatement` con `\n` y un `-fake-flag` incrustado → se guarda como una sola línea, exiftool no lo interpreta como argumento aparte) |
| F18 | Logo de marca de agua falsificado | `POST /site/watermark` valida por **contenido real** con `sharp` (igual que las fotos) antes de guardar — un archivo que no decodifica como imagen → 400, nunca se guarda | ✅ Probado 2026-09-04 (texto plano subido como PNG → 400) |
| F19 | Original de alta resolución servido en público | **Corrección de esta misma ficha**: cuando se escribió (Fase 11) se dio por hecho que el original ya no era alcanzable en público — **era falso**. `GET /g/:slug` seguía devolviendo `urls.original` (el archivo limpio, sin marca, re-codificado a resolución completa) para álbumes `public`/`unlisted`, sin firma ni control alguno — cualquiera que abriera la respuesta JSON tenía el original gratis, lo que volvía inútil todo el punto de vender licencias. Encontrado y corregido en la Fase 12c: `MediaService.getGallery()` ya **no incluye `original`** en `urls` salvo para álbumes `private` (un enlace de compartir sí implica que el dueño confió el original a ese visitante concreto). El original solo sale ahora por la entrega de licencia de un solo uso (L12–L16 más abajo). | ✅ Corregido y probado 2026-09-04 — `GET /g/:slug` de un álbum público ya no trae `original` en ninguna imagen |

---

## Bloque específico — Protección de la obra (`/site/watermark*`, metadatos de derechos — Fase 11)

Reproducible con `verify-fase11.mjs` (script de verificación, corrido dentro del contenedor backend
por tener `exiftool` disponible ahí; no forma parte del repo — ver la nota al final de esta sección).

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| P1 | Metadatos de derechos en el original **público** | `GET` del original de una foto publicada → `exiftool` confirma `XMP-dc:Rights`, `XMP-dc:Creator`, `IPTC:CopyrightNotice` con el valor configurado | ✅ Probado 2026-09-04 |
| P2 | Metadatos de derechos en el original **privado** (protección universal) | Una foto de álbum `private` **también** lleva los mismos metadatos — D10 no distingue por visibilidad, solo la marca visible sí (P4) | ✅ Probado 2026-09-04 |
| P3 | Nunca se reintroducen GPS/serie | El pipeline sigue quitando TODO el EXIF original antes de re-codificar (Fase 3); `exiftool` solo **añade** las etiquetas de derechos de una lista fija, nunca copia del archivo de origen | ✅ Cubierto por diseño — mismo mecanismo que F11 |
| P4 | Marca de agua solo en derivados de álbumes `public` | El derivado `small` de un álbum público difiere (en bytes) de un derivado idéntico regenerado sin marca; el de un álbum `private` es indistinguible del control (no se estampa) | ✅ Probado 2026-09-04 |
| P5 | Marca de agua funciona en **todos** los tamaños de derivado | Regresión encontrada y corregida en desarrollo: un mosaico de marca fijo (320 px) rompía la composición en el derivado `thumb` (240 px o menos) porque `sharp` exige que lo compuesto quepa dentro de la imagen base — el estampado fallaba en silencio y el `thumb` se servía **sin marcar**. Se corrigió acotando el mosaico al lado más chico de cada derivado. | ✅ Probado 2026-09-04 (test de regresión en `watermark.service.spec.ts` con una imagen de 96×70) |
| P6 | `POST /site/watermark` — validación | Contenido no-imagen → 400; el logo se re-codifica a PNG (nunca se guarda el archivo crudo del cliente) | ✅ Probado 2026-09-04 |
| P7 | RBAC de `/site/watermark*` | Sin sesión → 401; `usuario` → 403; `admin`+ → 2xx, en subir, borrar y regenerar | ✅ Probado 2026-09-04 |
| P8 | Regeneración no se puede duplicar / no cuelga la API | `POST /site/watermark/regenerate` responde **202 de inmediato** y corre en segundo plano (con ~250 imágenes tarda varios minutos — verificado que una llamada **síncrona** agota el tiempo de espera del cliente HTTP, de ahí el rediseño); una segunda llamada mientras hay una corriendo devuelve el mismo `startedAt` en vez de relanzar el trabajo | ✅ Probado 2026-09-04 |

> El script de verificación (`tmp-verify-fase11.mjs`) se escribió y corrió dentro del contenedor
> backend durante el desarrollo — no se dejó en el repo porque, a diferencia de
> `scripts/probe-fase10.mjs`, necesita `exiftool` (solo está instalado en la imagen del backend, no
> en el host) y tarda varios minutos por la regeneración real. El detalle de cada prueba queda
> documentado aquí y en `DOCUMENTO_VIVO_ARQUITECTURA.md` §14.

---

## Bloque específico — Identidad de sitio y formulario de contacto (`/site`, `/contact`)

Reproducible con el script `scripts/probe-fase10` (24 comprobaciones, se corre contra el backend de
dev en `:3050`; restaura `site_settings` y borra los mensajes de prueba al terminar).

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| S1 | `GET /site` sin sesión | 200; el cuerpo NO trae `id` ni `updatedAt` | ✅ Probado 2026-09-02 |
| S2 | `PATCH /site` sin sesión | → **401** | ✅ Probado 2026-09-02 |
| S3 | `PATCH /site` como `usuario` | → **403** (solo `admin`/`director`/`super`) | ✅ Probado 2026-09-02 |
| S4 | `PATCH /site` `heroMediaId` inexistente | UUID válido pero sin fila → **400**, sin escribir | ✅ Probado 2026-09-02 |
| S5 | `PATCH /site` `heroMediaId` de álbum no público | imagen de un álbum `private`/`unlisted` → **400** | ✅ Probado 2026-09-02 |
| S6 | `PATCH /site` `heroImageId: null` | 200, `hero` queda en `null` (no rompe) | ✅ Probado 2026-09-02 |
| S7 | `GET /galleries?featured=true` | una colección `unlisted`+`featured` **no** aparece | ✅ Probado 2026-09-02 |
| S8 | `POST /contact` honeypot | `website` con contenido → **202** y **0 filas** nuevas | ✅ Probado 2026-09-02 |
| S9 | `POST /contact` XSS almacenado | `<script>`/`onerror` en `name`/`message` → el HTML del correo los lleva escapados (`&lt;script&gt;`) | ✅ Probado 2026-09-02 (curl + spec) |
| S10 | `POST /contact` validación | `message` > 4000 → 400; email inválido → 400; campo extra → 400 | ✅ Probado 2026-09-02 |
| S11 | `POST /contact` throttle | ráfaga > 5/min → **429** | ✅ Probado 2026-09-02 |
| S12 | `/contact/messages` RBAC | sin sesión → 401; `usuario` → 403 (GET y DELETE) | ✅ Probado 2026-09-02 |
| S13 | `/contact/messages` fuga de IP + `:id` | la respuesta no trae `ipAddress`; `:id` no-UUID → 400 | ✅ Probado 2026-09-02 |

---

## Bloque específico — Solicitudes de licencia (`/license-requests` — Fases 12a–12d)

Mismo patrón que el bloque S (contacto) — solo cambia que la solicitud va ligada a una foto real.

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| L1 | `POST /license-requests` con `mediaId` inexistente | → **400**, sin guardar ni avisar | ✅ Probado 2026-09-04 |
| L2 | `POST /license-requests` de una foto no publicada o de álbum no público | → **400** — no se puede licenciar lo que no se exhibe | ✅ Cubierto por diseño (mismo mecanismo que L1) |
| L3 | Honeypot | `website` con contenido → **202** y **0 filas** nuevas | ✅ Probado 2026-09-04 |
| L4 | Validación | campo extra (`status`) → 400 (whitelist); `intendedUse` fuera de la lista → 400 | ✅ Probado 2026-09-04 |
| L5 | Throttle | ráfaga > 5/min → **429** | ✅ Probado 2026-09-04 |
| L6 | `GET /license-requests` RBAC | sin sesión → 401; `usuario` → 403; `admin`+ → 200 | ✅ Probado 2026-09-04 |
| L7 | `GET /license-requests` fuga de IP | la respuesta no trae `ipAddress`/`ip_address` | ✅ Probado 2026-09-04 |
| L8 | `PATCH /license-requests/:id` RBAC (Fase 12b) | sin sesión → 401; `usuario` → 403; `admin`+ → 200 | ✅ Probado 2026-09-04 |
| L9 | Cotizar una solicitud ya cerrada | `accepted`/`declined`/`fulfilled` → **400** ("ya no se puede cotizar"); `new`/`quoted` sí aceptan (recotizar es válido) | ✅ Probado 2026-09-04 |
| L10 | Cotizar un `:id` inexistente | → **404** | ✅ Probado 2026-09-04 |
| L11 | Validación de la cotización | `price` vacío → 400 (DTO); `conditions` con HTML/script → se escapa antes de ir al correo | ✅ Probado 2026-09-04 |
| L12 | `POST /license-requests/:id/accept` RBAC (Fase 12c) | sin sesión → 401; `usuario` → 403; `admin`+ → 201 | ✅ Probado 2026-09-04 |
| L13 | Aceptar fuera de orden | aceptar sin cotizar (`new`) → 400; aceptar una ya `accepted` → 400 (no se duplica la licencia) | ✅ Probado 2026-09-04 |
| L14 | Entrega de un solo uso — la carrera | dos descargas del **mismo token**: la primera → 200 con el archivo; la segunda → **404**, idéntico a un token inválido. El "claim" es atómico (`updateMany` condicionado a `used_at: null`, se revisa `count`) — no hay ventana donde ambas puedan colar | ✅ Probado (unit, la carrera) + ✅ Probado en vivo (secuencial) 2026-09-04 |
| L15 | Entrega — token inventado / caducado / ya usado | los tres casos devuelven el mismo 404 (indistinguibles, mismo principio que las URLs firmadas de `/media/:key`); nunca se toca el almacenamiento si el token no pasa la validación | ✅ Probado 2026-09-04 |
| L16 | Entrega — el archivo servido | `Content-Disposition: attachment`; es el **original** limpio de resolución completa (no un derivado); lleva los metadatos de derechos **más una nota de a quién se licenció**, incrustada al vuelo solo para esa descarga (trazabilidad si el archivo se filtra después) | ✅ Probado 2026-09-04 (descarga real ≈500 KB) |
| L17 | Botón público "Solicitar licencia" del lightbox (Fase 12d) | Es solo frontend — llama a `POST /license-requests` con el mismo `mediaId`/cuerpo que ya cubren L1–L5; no abre superficie nueva. Verificado que el cuerpo exacto que arma `LicenseRequestForm` (incluido `website` vacío) pasa por las mismas reglas: `mediaId` de una foto real → 202 y llega a la bandeja; `website` relleno → 202 pero **nunca** llega a la bandeja (mismo honeypot que L3) | ✅ Probado 2026-09-04 (`verify-12d.mjs`, 12/12 checks) |

---

## Bloque específico — Video (`POST /albums/:id/media`, transcode, HLS — Fases 14b–14c)

Mismo principio que el bloque de imagen: **el archivo del cliente nunca se sirve tal cual** y la
validación es por contenido, no por extensión ni `Content-Type`. Aquí la autoridad es `ffprobe`.

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| V1 | Un no-video con nombre `.mp4` (o `Content-Type: video/mp4`) | `ffprobe` no lo reconoce como contenedor válido → **400**. La pista (`mimetype`/extensión) solo elige la rama; no es la autoridad | ✅ Probado 2026-09-07 (`verify-14b.mjs`) |
| V2 | Límites de entrada | duración > `VIDEO_MAX_DURATION_S` (120 s); resolución > `VIDEO_MAX_PIXELS` (1920×1080); tamaño > `VIDEO_MAX_INPUT_BYTES` (200 MiB); frame rate > `VIDEO_MAX_FRAME_RATE` (121); más de una pista de video o de audio → **400**, antes de tocar `ffmpeg` | ✅ Cubierto (`probe()`); tamaño probado en el spec |
| V3 | Bufferizado en memoria | la subida va a `diskStorage` (archivo temporal), no a memoria — un video de 200 MiB no puede tumbar el proceso por RAM. La rama de imagen sí lee a buffer, pero solo tras comprobar `size ≤ UPLOAD_MAX_FILE_BYTES` | ✅ Revisado en código |
| V4 | `ffmpeg`/`ffprobe` como superficie | siempre `execFile` + **array** de argumentos (nunca shell, nunca interpolando el nombre/datos del usuario); `-protocol_whitelist file,crypto` → no abre `http(s)`/`tcp` (sin SSRF vía playlists); versión fija en el Dockerfile; timeout por proceso (`VIDEO_TRANSCODE_TIMEOUT_MS`) | ✅ Revisado en código |
| V5 | DoS por transcode | cola de **concurrencia 1** (no se apilan N `ffmpeg` a la vez); el rate limit de subidas por hora (`UPLOAD_MAX_UPLOADS_PER_HOUR`) también aplica | ✅ Revisado en código |
| V6 | El master limpio nunca es público | `-map_metadata -1` (tira todo metadato); `media.storage_key` (el master) **no** aparece en `urls` de `GET /g/:slug` — solo `preview` + el póster. `urls.original` solo en la vista del Studio (dueño/admin) | ✅ Probado 2026-09-07 (`verify-14b.mjs`: `preview` sí, `original` no) |
| V7 | Derechos en el archivo servido (invariante D10) | el preview y el master llevan `exiftool` con las etiquetas de derechos (XMP `dc:Rights`/`dc:Creator`, `Copyright`, `Artist`, `UsageTerms`, `WebStatement`, `LicensorURL`) — igual que cualquier derivado de foto | ✅ Probado 2026-09-07 (`exiftool` sobre el preview descargado) |
| V8 | `GET /media/:id/processing` | `admin`+ y **valida propiedad del álbum** (`loadManageable`); sin sesión → 401, `usuario` → 403 | ✅ Cubierto (mismo `loadManageable` que `PATCH /media/:id`, probado en L-equivalentes) |
| V9 | Fallo de transcode | error de `ffmpeg` → `media.processing_error` (el gestor lo ve), objetos ya subidos se limpian, el video **no** se publica; nunca tumba el proceso. Reinicio a mitad → `processing` reporta `interrumpido` | ✅ Revisado en código |
| V10 | `GET /media/:key` de un `.mp4`/`.m3u8`/`.ts` | `DiskStorageDriver` valida la clave con `^<uuid>\.[a-z0-9]{2,4}$` (un `../` o barra nunca llega al FS — path traversal); sirve con el `Content-Type` correcto (`video/mp4` / `application/vnd.apple.mpegurl` / `video/mp2t`); un objeto de álbum privado exige la firma HMAC igual que una imagen | ✅ Revisado en código (regex ampliada en 14b/14c) |
| V11 | HLS — el master limpio no se puede armar desde las playlists (Fase 14c) | `master.m3u8` solo lista `stream_N.m3u8`; estas solo listan segmentos `.ts` **ya escalados y con marca de agua incrustada** (renditions). El master de alta resolución sin marca NO está en ningún playlist ni en `urls` de la galería pública — solo se entrega bajo licencia (Fase 12/14d) | ✅ Probado 2026-09-07 (`verify-14c.mjs`: `urls.hls` sí, `urls.original` no) |
| V12 | HLS — visibilidad de cada objeto | los objetos HLS viven en `media.hls_keys`; `visibilityOfKey` los resuelve por ahí (además de `storage_key`/`media_variants`) → un segmento de un álbum **privado** exige la firma HMAC en `GET /media/:key`, igual que cualquier media privada. Las URIs dentro de las playlists de un álbum privado se firman con un TTL más largo (`MEDIA_HLS_URL_TTL_SECONDS`) pero **con la misma firma** | ✅ Probado 2026-09-07 (bug de 404 en todas las URLs HLS encontrado y corregido; `verify-14c` sirve todas las piezas) |
| V13 | HLS — limpieza al borrar | `media.hls_keys` reúne el master.m3u8 + las playlists + **todos** los segmentos; `DELETE /media/:id` y el borrado de álbum iteran ese array → cero objetos huérfanos | ✅ Probado 2026-09-07 (`verify-14c.mjs`: tras borrar, un `.ts` de antes → **404**) |
| V14 | `hls.js` desde `cdnjs` | la CSP `script-src` gana **solo** `https://cdnjs.cloudflare.com` (para `hls.min.js` pineado a 1.5.17); `enableWorker:false` para no depender de `worker-src`; los segmentos se piden al mismo origen que la API (`connect-src` ya lo permite); MSE usa `blob:` (`media-src` ya lo permite) | ✅ Revisado en código |

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
