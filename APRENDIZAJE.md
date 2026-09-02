# Bitácora de Aprendizaje — Galería

> Este es **el propósito central** del proyecto, no un extra: el dueño pidió un proyecto para
> estudiar código real. Cada entrada explica un concepto real usado en ESTE proyecto — el *por qué*,
> con el archivo/línea real como ejemplo, nunca una definición genérica de libro. Si el código
> cambia, se vuelve aquí a actualizar el ejemplo.

Se llena en paralelo a cada pieza que se construya (`PLAN_DESARROLLO.md` §10). Abajo, primero las
entradas ya escritas sobre código real; después el mapa de conceptos pendientes.

---

## Entradas sobre código real

### E1. Cómo se conecta Prisma 7 a la base de datos (driver adapter)

**Archivos**: `gallery_backend/prisma.config.ts`, `gallery_backend/src/common/prisma/prisma.service.ts`,
`gallery_backend/prisma/schema.prisma`.

En versiones anteriores de Prisma, la cadena de conexión se ponía en `schema.prisma`
(`datasource db { url = env("DATABASE_URL") }`) y un motor en Rust, embebido en el cliente,
hablaba con Postgres. **Prisma 7 quitó las dos cosas**:

1. **La URL sale del schema.** `schema.prisma` solo declara `provider = "postgresql"`. La URL para
   los comandos del CLI (`migrate`, `studio`) vive en `prisma.config.ts` → `datasource.url`.
2. **El cliente ya no trae motor propio.** Ahora las consultas salen por `pg` (la librería
   estándar de Postgres para Node) a través de un *driver adapter*: `@prisma/adapter-pg`.
   En `prisma.service.ts`:
   ```ts
   const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
   super({ adapter }); // se lo pasamos al constructor de PrismaClient
   ```
   *Por qué el cambio*: un cliente sin binario de Rust es más ligero, arranca más rápido y
   funciona en entornos donde no se puede ejecutar un binario nativo (edge, serverless). El costo
   es esta pieza extra de cableado.
3. **Prisma 7 ya no lee `.env` solo.** `prisma.config.ts` lo carga con `process.loadEnvFile()`
   —una función que trae Node de fábrica desde la 20.6, sin instalar `dotenv`—. Va en `try/catch`
   porque dentro del contenedor no hay archivo `.env` (las variables las pone docker-compose) y
   `loadEnvFile` lanza error si el archivo no existe.

### E2. `GET /health` — por qué comprueba las dependencias, no solo "estoy vivo"

**Archivo**: `gallery_backend/src/health/health.controller.ts`.

El endpoint no solo responde "ok": hace un `SELECT 1` real contra Postgres y un `PING` real contra
Redis. Si una falla, lo dice en `checks` y baja `status` a `"degraded"` — pero **siempre responde
200**. La razón: un balanceador o Docker usan esto para decidir si mandan tráfico; distinguir
"el proceso se cayó" (no responde nada) de "el proceso vive pero su base de datos no contesta"
(responde 200 con `database:false`) son dos problemas distintos que se atienden distinto.

### E3. La validación de entorno que impide arrancar "a medias"

**Archivo**: `gallery_backend/src/config/env.validation.ts`.

`ConfigModule.forRoot({ validate: validateEnv })` corre esta función *antes* de que arranque nada
más. Si falta una variable obligatoria, o `TOTP_ENCRYPTION_KEY` no son exactamente 64 caracteres
hexadecimales (32 bytes — el tamaño que exige AES-256-GCM), el proceso **falla de inmediato** con
un mensaje claro. Alternativa que se evita: arrancar igual y descubrir el hueco horas después,
cuando un usuario real intenta activar 2FA y el cifrado revienta.

### E4. Por qué el login son 3 pasos y qué es el "challenge token"

**Archivos**: `src/auth/auth.service.ts` (`loginStep1`/`loginStep2`/`login2fa`),
`src/auth/jwt-payload.interface.ts`.

El login imita la UX de Google: primero solo el correo, luego la contraseña, luego el segundo
factor — cada uno en su pantalla. La pieza interesante es qué pasa **entre** el paso 2 y el 3
cuando la cuenta tiene 2FA: el servidor NO emite la sesión todavía. Emite un *challenge token* —
un JWT firmado con `purpose: '2fa_challenge'` y 5 minutos de vida — que solo significa "este
correo ya pasó la contraseña, le falta el 2FA". `JwtStrategy.validate` rechaza cualquier token
cuyo `purpose` no sea `'access'`, así que ese challenge **no abre ningún endpoint** — se probó:
usarlo como cookie de sesión da 401.

### E5. Rotación de refresh token y detección de robo

**Archivo**: `src/auth/auth.service.ts` (`refresh`, `issueSession`).

El access token vive 15 min; el refresh, 7 días. Cada vez que se usa el refresh para renovar, se
marca `used_at` y se emite uno nuevo (rotación). Si alguien presenta un refresh **ya usado**
pasada una ventana de gracia de 10 s (que tolera un doble-click en carrera), el sistema asume que
el token fue robado y **revoca todas las sesiones de esa cuenta** de golpe, no solo el intento
sospechoso. En la BD el refresh token nunca se guarda en claro: solo su `sha256` (256 bits de
entropía no necesitan bcrypt, y un hash sí se puede indexar para buscar O(1)).

### E6. Hash vs. cifrado, aplicado: contraseña, secreto TOTP, código de recuperación

**Archivos**: `src/common/utils/crypto.util.ts`, `src/two-factor/two-factor.service.ts`.

Tres secretos, tres tratamientos distintos, por una razón concreta en cada caso:
- **Contraseña** → `bcrypt` (hash de una vía, lento a propósito). El servidor nunca necesita
  recuperarla, solo comparar.
- **Secreto TOTP** → `AES-256-GCM` (cifrado simétrico, reversible). El servidor SÍ necesita leerlo
  de vuelta para recalcular el código de 6 dígitos y compararlo. La llave vive en su propia
  variable de entorno, distinta de `JWT_SECRET`.
- **Código de recuperación de 2FA** → `bcrypt` otra vez. Como la contraseña: solo se compara,
  nunca se re-muestra. Además es de un solo uso (`used_at`).

### E7. `otplib` v12 vs v13 — cuándo NO tomar la última versión

**Archivo**: `src/common/utils/totp.util.ts`, `package.json`.

La última versión de `otplib` (13) es una reescritura completa: ESM-first, API asíncrona, sin el
objeto `authenticator` de siempre. Para una pieza de seguridad como la verificación del segundo
factor, se fijó **`otplib@12`** — la API estable que usan todos los ejemplos y que no tiene CVEs.
No es pereza: es preferir lo probado en el punto donde un bug sutil significa "cualquier código
pasa el 2FA". La v13 se adoptará cuando esté rodada.

### E8. Por qué el pipeline de imagen no usa una librería de "magic bytes"

**Archivo**: `src/media-processing/image-pipeline.service.ts`.

Lo habitual para "¿de qué tipo es este archivo de verdad?" es una librería que lee los primeros
bytes (`file-type` y similares). Aquí se descartó, por dos razones: (1) su versión actual es
ESM-only y choca con el build CommonJS de Nest; (2) es **redundante**. `sharp` (libvips) tiene que
decodificar el contenido real para re-codificarlo — que es lo que hacemos de todos modos. Si
`sharp` no puede leerlo, no es una imagen; y `sharp().metadata().format` dice qué es en realidad.
Se comprueba contra una lista blanca (`jpeg/png/webp/avif`); un `.jpg` que en realidad es texto, o
un SVG (que es XML ejecutable, nunca se acepta), fallan aquí con 400.

### E9. Cómo se "limpia" una imagen al subirla (y por qué)

**Archivo**: `src/media-processing/image-pipeline.service.ts` (`process`).

Cada imagen que entra se **re-codifica** de cero con `sharp` antes de guardarse. Efectos:
- **Se van los metadatos EXIF/GPS.** Una foto de celular lleva dentro las coordenadas de dónde se
  tomó — un dato personal que no tiene por qué acabar en un CDN público. `sharp` no conserva
  metadatos salvo que se lo pidas; `.rotate()` sin argumentos aplica la orientación EXIF a los
  píxeles y luego la descarta. Verificado: un JPEG con 212 bytes de EXIF sale con 0.
- **Muere cualquier payload escondido.** Un "polyglot" (un archivo que es JPEG válido y a la vez
  otra cosa, con datos pegados después del fin de la imagen) queda reducido a solo la imagen.
- **Se normaliza el formato** y se generan 4 tamaños WebP (`thumb`/`small`/`medium`/`large`) para
  que la galería nunca sirva un archivo de 4000 px dentro de un hueco de 240.

### E10. Dos formas de dar acceso temporal a un archivo privado

**Archivos**: `src/storage/media-signing.ts`, `src/storage/disk-storage.driver.ts`,
`src/storage/cloudinary-storage.driver.ts`.

Una imagen de un álbum `private` nunca tiene una URL adivinable ni permanente. El backend, tras
verificar que quien pide tiene acceso, genera una URL de **vida corta**:
- **Driver de disco**: `/media/<key>?exp=<epoch>&sig=<hmac>`. `sig` es `HMAC-SHA256(secreto,
  key.exp)`. El cliente no puede fabricarla porque no conoce `MEDIA_URL_SIGNING_SECRET`; el
  servidor la revalida en tiempo constante y comprueba `exp`. Sin firma o con firma mala → 404
  (no 403 — no confirmamos que el recurso existe).
- **Driver de Cloudinary**: el recurso se sube como `type: authenticated` y se entrega con una URL
  firmada por Cloudinary con `expires_at`. Mismo concepto, distinta implementación.

En ambos casos el `storage_key` es un UUID aleatorio: no se deriva del nombre del archivo, del
usuario ni de nada secuencial.

### E11. Imágenes responsivas sin librería: `srcset` + `sizes` + BlurHash

**Archivos**: `gallery_frontend/src/components/GalleryImage.tsx`, `BlurhashCanvas.tsx`.

El backend ya generó 4 tamaños (`thumb` 240 / `small` 640 / `medium` 1280 / `large` 2048) en
WebP. El frontend los ofrece todos al navegador en un `<img srcset>` con un atributo `sizes` que
describe qué ancho ocupará la imagen en cada breakpoint. El navegador elige el archivo más
pequeño que sirva para la pantalla y la densidad de píxeles de quien mira — sin JavaScript.

Mientras la imagen carga se ve el **BlurHash**: una cadena de ~30 caracteres que codifica una
versión difuminada de 4×4 "bloques de color". `BlurhashCanvas` la decodifica a un `<canvas>` de
32×32 px (instantáneo) y lo pinta detrás; cuando el `<img>` real dispara su `onLoad`, se
desvanece por encima. Así nunca hay un hueco en blanco ni un salto de layout (el `<img>` lleva
`width`/`height` reales, que reservan el espacio con `aspect-ratio`).

### E12. `NODE_ENV` y por qué `next build` fallaba

**Archivos**: `docker-compose.yml`, `DOCUMENTO_VIVO_ARQUITECTURA.md` §5.2.

Next tiene dos modos: `next dev` (servidor de desarrollo, recarga en caliente) y
`next build` + `next start` (producción). El contenedor de desarrollo fija
`NODE_ENV=development` porque es lo correcto para `next dev`. Pero `next build` **espera
`NODE_ENV=production`**: si se corre con `development`, carga la build de desarrollo de React y el
prerender de una página interna (`/_global-error`) truena con un error críptico
(`Cannot read properties of null (reading 'useContext')`) que parece un bug del código propio y
no lo es. La lección general: `NODE_ENV` no es una variable cualquiera — muchas herramientas del
ecosistema (React, Next, Express) cambian de comportamiento según su valor, y "development" no es
un sinónimo inofensivo de "no producción".

### E13. Animar sin una librería de animación

**Archivos**: `gallery_frontend/src/components/GalleryLayout.tsx`, `Lightbox.tsx`,
`src/app/globals.css`.

Se probó `motion` (antes `framer-motion`) y se quitó. La animación de entrada —cada imagen
aparece con un *fade-up* escalonado cuando entra en pantalla al hacer scroll— se hace con:
1. Un `IntersectionObserver` (API nativa del navegador) que añade la clase `.is-in` a cada
   elemento cuando entra en el viewport, una sola vez.
2. CSS: el elemento empieza en `opacity: 0; transform: translateY(24px)` y `.is-in` lo lleva a su
   posición final con una `transition`. El retardo escalonado va en una custom property
   (`--reveal-delay`) calculada por posición.
3. `@media (prefers-reduced-motion: reduce)` anula todo: los elementos aparecen ya visibles.

Para una galería con decenas de imágenes esto pesa **0 KB de JavaScript de animación** y el
navegador compone las transiciones en su hilo propio. El lightbox usa el mismo principio (una
clase `.is-open` y transiciones CSS).

---

## Mapa de conceptos pendientes

---

## 0. Checklist de lectura — por dónde empezar (se completa con rutas reales al construir)

Orden recomendado: seguir el flujo real de una petición, no la estructura de carpetas.

**Mapa antes que código**
- [ ] `PLAN_DESARROLLO.md`
- [ ] `DOCUMENTO_VIVO_ARQUITECTURA.md`
- [ ] `gallery_backend/prisma/schema.prisma` — el vocabulario de todo lo demás

**1. Identidad** — login en 3 pasos, sesión, jerarquía de roles
**2. Piezas puras** — cifrado AES-256-GCM, TOTP, escape de HTML, firma HMAC de URLs (leer la
   función junto a su `*.spec.ts`)
**3. Media core** — el pipeline de subida, `sharp`, derivados, storage
**4. Galería y personalización** — álbumes, visibilidad, el objeto `theme`
**5. Animación** — orquestación, presupuesto de rendimiento, `prefers-reduced-motion`
**6. El resto del backend, ya con contexto** — `security-events`, `mail`, `main.ts`, `app.module.ts`

---

## Conceptos que este proyecto va a cubrir (índice, se desarrolla al construir)

### Identidad y sesión
- **JWT** (RFC 7519) — qué es un token firmado, por qué el algoritmo se fija explícito (`HS256`) y
  nunca se negocia.
- **Cookie httpOnly + refresh token con rotación y ventana de gracia** — por qué el access token
  vive poco y el refresh se rota; qué es la "ventana de gracia" y por qué reusar un token viejo
  fuera de ella revoca *todas* las sesiones.
- **Hash vs. cifrado** — `password_hash` es de una vía (bcrypt); `totp_secret_encrypted` es
  simétrico (AES-256-GCM) porque el servidor necesita leerlo de vuelta. Cuándo va cada uno.
- **RBAC dinámico + jerarquía de autoridad** — roles en tabla editable, `level`/`max_count`, y
  por qué nadie puede crear/gestionar un rol o cuenta de su mismo nivel o superior (escalada de
  privilegios).
- **2FA / TOTP** (RFC 6238) — cómo un secreto compartido + el reloj generan un código de 6 dígitos;
  por qué los códigos de recuperación se hashean y son de un solo uso.
- **Anti-enumeración de cuentas** — por qué `login/step1` y `forgot-password` responden igual exista
  o no el correo.

### Media y seguridad de archivos
- **Detección de tipo por contenido (magic bytes)** — por qué el `Content-Type` y la extensión no
  son confiables (los pone el cliente).
- **Re-encode como defensa** — cómo volver a codificar una imagen destruye payloads embebidos
  (polyglots) y por qué eso importa.
- **EXIF/GPS** — por qué una foto trae tu ubicación dentro y por qué se quita por defecto (dato
  personal).
- **Decompression bomb** — una imagen chica en bytes que se expande a millones de píxeles al
  decodificarse; cómo `limitInputPixels` la corta.
- **`limits.fileSize` en el interceptor** — por qué validar el tamaño *después* de recibir el
  archivo ya es un DoS.
- **URL firmada (HMAC + expiración)** — cómo se da acceso temporal a un archivo privado sin una
  sesión, y por qué la firma no se puede falsificar.
- **IDOR** — por qué todo endpoint filtra por el `user_id` del token y nunca solo por el `:id` de
  la URL.

### Presentación y rendimiento
- **Imágenes responsivas y derivados** — por qué nunca se sirve el original a un contenedor de
  300 px; `srcset`/`sizes`, WebP/AVIF con fallback.
- **Placeholder (blurhash / color dominante)** y **layout shift (CLS)** — por qué reservar el
  espacio de la imagen antes de que cargue.
- **Carga perezosa** — por qué un elemento oculto en el DOM igual descarga sus imágenes si no se
  marca `loading="lazy"`.
- **`prefers-reduced-motion`** — accesibilidad: cómo respetar a quien pidió menos animación.
- **Presupuesto de rendimiento** — medir Core Web Vitals con datos reales, no "se ve fluido".
- **CSP y cabeceras cross-origin** — por qué `Cross-Origin-Embedder-Policy` puede romper imágenes
  de un CDN de terceros y por qué se prueba en vivo, nunca solo por completar el checklist de un
  escáner.

### Infraestructura
- **Docker Compose multi-servicio** — por qué Postgres/Redis nunca publican puerto al host.
- **Variables `NEXT_PUBLIC_*`** — se resuelven en tiempo de *build*, no de arranque del contenedor.
- **`StorageService` abstracto** — por qué la lógica de negocio no debe saber si el archivo está
  en disco o en S3.
