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

Estado global: **Fase 2 (identidad) completada.** Verificados con `curl` contra el backend en vivo
los puntos de OWASP API Top 10 que aplican a identidad (ver más abajo). El bloque de **seguridad
de archivos** (F1–F14) arranca con la Fase 3 (media).

### OWASP API Security Top 10 — cobertura tras la Fase 2

| # | Categoría | Estado |
|---|---|---|
| API1 — IDOR | ✅ Parcial: `/users/:id`, `/roles/:id` filtran por jerarquía, no solo por `:id`. El grueso (media privada) llega en la Fase 3. |
| API2 — Broken Authentication | ✅ Probado: anti-enumeración (`login/step1` idéntico), challenge token de 2FA nunca es sesión (401 en `/auth/me`), logout revoca el refresh en BD, reuso de refresh → cascada, JWT `HS256` fijo. |
| API3 — Mass Assignment | ✅ Probado: propiedad extra en el body (`role_id` en registro) → 400 por `forbidNonWhitelisted`. |
| API4 — Unrestricted Resource Consumption | ✅ Probado: 10 fallos de login → 429 + fila `security_events`; mismo mecanismo en 2FA. Falta el límite de subida (Fase 3). |
| API5 — Broken Function Level Authorization | ✅ Probado: `usuario` → `GET /users` 403; jerarquía de niveles en `roles`/`users` (crear nivel ≥ propio → 403); `is_system` protegido (409). |
| API6 — Sensitive Business Flows | ✅ Parcial: registro y login limitados por el mismo mecanismo de API4. |
| API7 — SSRF | No aplica todavía (sin "importar imagen por URL" ni OAuth). |
| API8 — Security Misconfiguration | ✅ helmet, CORS explícito, Swagger solo dev, secretos fuera de git. |
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

### Deuda de seguridad conocida

| Ítem | Detalle | Plan |
|---|---|---|
| `npm audit` — 4 *high* | `mysql2 <3.22.0` y `deepmerge-ts <8.0.0`, transitivas del **CLI de Prisma** (`@prisma/config`). **devDependency**; sin ruta de explotación aquí (proyecto PostgreSQL, no MySQL; `deepmerge-ts` solo procesa el config de Prisma). | `npm audit fix --force` propone bajar a Prisma 6 — no se acepta. Seguir releases de Prisma 7 y actualizar al parche de transitivas. |

---

## OWASP API Security Top 10 (2023) — cobertura planeada

| # | Categoría | Aplica | Estado |
|---|---|---|---|
| API1 | Broken Object Level Authorization (IDOR) | Sí — álbumes e imágenes privadas | ⬜ Pendiente |
| API2 | Broken Authentication | Sí — login en 3 pasos, 2FA, refresh | ⬜ Pendiente |
| API3 | Broken Object Property Level Authorization (mass assignment) | Sí | ⬜ Pendiente |
| API4 | Unrestricted Resource Consumption | Sí — subida de imágenes es el punto crítico | ⬜ Pendiente |
| API5 | Broken Function Level Authorization | Sí — panel admin, jerarquía de roles | ⬜ Pendiente |
| API6 | Unrestricted Access to Sensitive Business Flows | Parcial — registro masivo, subida masiva | ⬜ Pendiente |
| API7 | Server Side Request Forgery (SSRF) | Solo si se agrega "importar imagen por URL" | No aplica todavía |
| API8 | Security Misconfiguration | Sí — cabeceras, CORS, portal de docs interno | ⬜ Pendiente |
| API9 | Improper Inventory Management | Sí | ⬜ Pendiente |
| API10 | Unsafe Consumption of APIs | Solo si se integra un proveedor externo (Cloudinary, OAuth) | No aplica todavía |

---

## Bloque específico — Seguridad de archivos de imagen

| # | Prueba | Qué valida | Estado |
|---|---|---|---|
| F1 | Tipo falsificado por extensión | Subir `shell.php`/`x.svg` renombrado a `.jpg` → rechazado por **contenido real** (magic bytes), no por extensión | ⬜ Pendiente |
| F2 | Tipo falsificado por `Content-Type` | `Content-Type: image/jpeg` sobre un archivo que no lo es → rechazado | ⬜ Pendiente |
| F3 | Payload embebido / polyglot | Un JPEG válido con datos ejecutables tras el marcador EOI → el re-encode con `sharp` los elimina; el archivo servido no los contiene | ⬜ Pendiente |
| F4 | SVG con `<script>` | Rechazado por defecto; si se habilita SVG, servido sanitizado + `Content-Type` forzado + `Content-Disposition: attachment` | ⬜ Pendiente |
| F5 | Decompression bomb | Imagen declarada 50 000 × 50 000 → rechazada por `limitInputPixels` antes de decodificar | ⬜ Pendiente |
| F6 | DoS por tamaño | Archivo de 500 MB → cortado por `limits.fileSize` del interceptor, nunca bufferizado entero | ⬜ Pendiente |
| F7 | DoS por volumen | 10 000 subidas seguidas → rate limit dedicado + fila `security_events` tipo `upload_abuse` | ⬜ Pendiente |
| F8 | IDOR de imagen privada | Cuenta A pide `/media/<key de B>` o `/images/<id de B>` → 403/404, nunca el archivo | ⬜ Pendiente |
| F9 | URL firmada manipulada | Cambiar `exp` o la firma de una URL firmada → 403; una válida no expirada → 200 | ⬜ Pendiente |
| F10 | URL firmada expirada | Esperar a que caduque → 403 | ⬜ Pendiente |
| F11 | Fuga de EXIF/GPS | La imagen servida no conserva coordenadas GPS ni metadatos personales del original | ⬜ Pendiente |
| F12 | Enumeración de álbumes | Fuerza bruta de slug/ID no revela álbumes `private`/`unlisted`; no aparecen en sitemap ni listados | ⬜ Pendiente |
| F13 | Path traversal en nombre | `../../etc/passwd` como nombre de archivo → saneado; `storage_key` siempre opaco y generado por el servidor | ⬜ Pendiente |
| F14 | Ruta de storage adivinable | Los `storage_key` son aleatorios (UUID), no secuenciales ni derivados del nombre/usuario | ⬜ Pendiente |

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
