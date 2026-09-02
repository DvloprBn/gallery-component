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
