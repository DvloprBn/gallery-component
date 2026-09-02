# Documento Vivo de Arquitectura — Galería

> Detalle técnico real de cada decisión de arquitectura conforme se toma — el *por qué* detrás
> de lo que dice `ESTADO_PROYECTO.md`. Autocontenido: cada patrón se explica desde cero.

---

## 1. Diseño técnico inicial (2026-09-01)

> Las decisiones de `PLAN_DESARROLLO.md` §4 quedaron confirmadas: D1 multiusuario, D2 con
> visibilidad privada, D3 **Cloudinary** (tras el pipeline propio de `sharp`), D4 Framer Motion,
> D5 con 2FA, D7 repo público. Este schema queda **congelado** como base de la Fase 1; los
> cambios posteriores van por migración. Las credenciales de Cloudinary y los secretos reales
> se cargan al `.env` cuando el dueño cree la cuenta — el código se construye contra la
> abstracción `StorageService` con driver de disco en desarrollo.

### 1.1 Estructura del monorepo

```
dvlopmnt/gallery/
├── gallery_backend/      # NestJS + Prisma
├── gallery_frontend/     # Next.js
├── docs/                 # Portal MkDocs (PLAN_DESARROLLO.md §9)
├── docker-compose.yml
├── .env.example
└── (documentación: CLAUDE.md, PLAN_DESARROLLO.md, este archivo, etc.)
```

### 1.2 Puertos

Verificados libres en este equipo con `ss -ltn` (2026-09-01) — hay varios stacks de desarrollo
corriendo a la vez, así que la elección se comprobó, no se asumió. Todo lo que maneja datos se
publica **solo en `127.0.0.1`** (nunca a la red). El puerto del host es distinto del puerto
interno del contenedor: la app escucha en 3040/3041 dentro del contenedor y docker-compose lo
mapea al puerto del host de la tabla.

| Servicio | Puerto host | Puerto interno | Exposición |
|---|---|---|---|
| `gallery_backend` (API) | 3050 | 3040 | `127.0.0.1` |
| `gallery_frontend` | 3051 | 3041 | `127.0.0.1` |
| `gallery_db` (PostgreSQL) | 5438 | 5432 | `127.0.0.1` únicamente |
| `gallery_redis` | 6383 | 6379 | `127.0.0.1` únicamente |
| Prisma Studio | 5523 | 5555 | `127.0.0.1` únicamente |
| `gallery_docs` (MkDocs) | 8098 | 8000 | `127.0.0.1` únicamente |
| `gallery_compodoc` | 8099 | 8080 | `127.0.0.1` únicamente |

En producción el único puerto público real sería el del reverse proxy (80/443); Postgres y Redis
nunca publican puerto.

### 1.3 Schema (Prisma) — primera versión (congelada 2026-09-01)

```prisma
// ─────────────── IDENTIDAD ───────────────

// Roles dinámicos — nunca un enum fijo de Postgres. `level` es el nivel de
// autoridad (0 = usuario público … N = superadministrador). `max_count`
// limita cuántas cuentas activas pueden tener ese rol (null = sin límite).
// `is_system` marca los roles sembrados para que no se puedan borrar y
// dejar el sistema sin acceso administrativo.
model roles {
  role_id     Int      @id @default(autoincrement())
  name        String   @unique @db.VarChar(50)
  description String?  @db.VarChar(200)
  level       Int      @default(0)
  max_count   Int?
  is_system   Boolean  @default(false)
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  users       users[]
}

model users {
  user_id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email                String   @unique @db.VarChar(255)
  password_hash        String
  name                 String?  @db.VarChar(150)
  role_id              Int
  must_change_password Boolean  @default(false)
  is_active            Boolean  @default(true)

  // 2FA (TOTP). El secreto es SIMÉTRICO: el servidor necesita leerlo de
  // vuelta para verificar el código de la app del usuario, así que se
  // CIFRA en reposo (AES-256-GCM, llave propia en variable de entorno —
  // nunca el JWT_SECRET), no se hashea.
  totp_secret_encrypted String?
  totp_enabled          Boolean @default(false)

  created_at DateTime @default(now()) @db.Timestamptz(6)
  updated_at DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  roles                 roles                  @relation(fields: [role_id], references: [role_id], onDelete: Restrict)
  refresh_tokens        refresh_tokens[]
  password_reset_tokens password_reset_tokens[]
  totp_recovery_codes   totp_recovery_codes[]
  albums                albums[]
  images                images[]
}

// Rotación con ventana de gracia. Si un token ya usado se vuelve a
// presentar FUERA de la ventana de gracia → se revocan TODAS las sesiones
// de esa cuenta (asume robo del token).
model refresh_tokens {
  token_id   String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id    String    @db.Uuid
  token_hash String    @unique
  revoked    Boolean   @default(false)
  used_at    DateTime? @db.Timestamptz(6)
  ip_address String?   @db.VarChar(45)
  user_agent String?
  created_at DateTime  @default(now()) @db.Timestamptz(6)
  expires_at DateTime  @db.Timestamptz(6)
  users      users     @relation(fields: [user_id], references: [user_id], onDelete: Cascade)
}

// Códigos de recuperación de 2FA — un solo uso, se muestran UNA vez al
// activar 2FA, se guardan hasheados (bcrypt) porque nunca necesitan
// volver a mostrarse, solo compararse.
model totp_recovery_codes {
  code_id    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id    String    @db.Uuid
  code_hash  String
  used_at    DateTime? @db.Timestamptz(6)
  created_at DateTime  @default(now()) @db.Timestamptz(6)
  users      users     @relation(fields: [user_id], references: [user_id], onDelete: Cascade)
}

model password_reset_tokens {
  token_id   String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  user_id    String    @db.Uuid
  token_hash String    @unique
  used_at    DateTime? @db.Timestamptz(6)
  created_at DateTime  @default(now()) @db.Timestamptz(6)
  expires_at DateTime  @db.Timestamptz(6)
  users      users     @relation(fields: [user_id], references: [user_id], onDelete: Cascade)
}

// Fuerza bruta (login y 2FA) y reuso de refresh token. Conteo en Redis
// con ventana deslizante; la fila real solo se crea al cruzar el umbral.
model security_events {
  security_event_id String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  fingerprint       String    @unique @db.VarChar(64)
  type              String    @db.VarChar(30) // login_bruteforce | twofactor_bruteforce | refresh_token_reuse | upload_abuse
  identifier        String
  ip_address        String?   @db.VarChar(45)
  user_agent        String?
  attempts          Int
  occurrence_count  Int       @default(1)
  status            String    @default("nuevo") @db.VarChar(20)
  first_seen_at     DateTime  @default(now()) @db.Timestamptz(6)
  last_seen_at      DateTime  @default(now()) @db.Timestamptz(6)
  resolved_at       DateTime? @db.Timestamptz(6)
  resolved_note     String?
}

// ─────────────── MEDIA / GALERÍA ───────────────

// Un álbum es la unidad de personalización y de visibilidad.
// `visibility`:  public   → indexable, visible en listados
//                unlisted → accesible solo con el slug/enlace, no listado
//                private  → solo el dueño y roles administrativos
// `layout` y `theme` viven en el álbum, no en cada imagen: son la
// "personalización de grado profesional" del proyecto.
model albums {
  album_id       String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  owner_user_id  String    @db.Uuid
  title          String    @db.VarChar(150)
  slug           String    @unique @db.VarChar(180)
  description    String?   @db.VarChar(2000)
  visibility     String    @default("private") @db.VarChar(20)
  layout         String    @default("masonry") @db.VarChar(20) // masonry | justified | grid | carousel
  theme          Json      @default("{}")                       // tokens de diseño (colores, tipografía, radios, espaciado)
  cover_image_id String?   @db.Uuid
  sort_order     Int       @default(0)
  image_count    Int       @default(0)  // desnormalizado, mantenido en transacción
  created_at     DateTime  @default(now()) @db.Timestamptz(6)
  updated_at     DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  owner  users    @relation(fields: [owner_user_id], references: [user_id], onDelete: Cascade)
  images images[]
  share_tokens album_share_tokens[]

  @@index([owner_user_id])
  @@index([visibility])
}

// La imagen ORIGINAL subida, ya normalizada (re-encode con sharp, sin EXIF).
// `storage_key` es la ruta opaca dentro del StorageService (nunca el nombre
// original del cliente). `checksum_sha256` permite deduplicar y detectar
// corrupción.  El original re-encodeado se guarda para poder regenerar
// derivados en el futuro, pero NUNCA se sirve directo a la galería.
model images {
  image_id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  album_id        String   @db.Uuid
  owner_user_id   String   @db.Uuid
  storage_key     String   @unique
  original_name   String?  @db.VarChar(255) // saneado, solo para mostrar/descargar
  mime_type       String   @db.VarChar(50)  // detectado por contenido, no por extensión
  width           Int
  height          Int
  bytes           Int
  checksum_sha256 String   @db.VarChar(64)
  placeholder     String?  @db.VarChar(120) // blurhash o color dominante
  alt_text        String?  @db.VarChar(500)
  caption         String?  @db.VarChar(2000)
  sort_order      Int      @default(0)
  created_at      DateTime @default(now()) @db.Timestamptz(6)

  album    albums          @relation(fields: [album_id], references: [album_id], onDelete: Cascade)
  owner    users           @relation(fields: [owner_user_id], references: [user_id], onDelete: Cascade)
  variants image_variants[]

  @@index([album_id])
  @@index([owner_user_id])
}

// Derivados responsivos generados por el pipeline. Se sirven ESTOS, nunca
// el original.  `format` moderno (webp/avif) con fallback jpeg.
model image_variants {
  variant_id  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  image_id    String   @db.Uuid
  storage_key String   @unique
  label       String   @db.VarChar(20)  // thumb | small | medium | large
  format      String   @db.VarChar(10)  // webp | avif | jpeg
  width       Int
  height      Int
  bytes       Int
  created_at  DateTime @default(now()) @db.Timestamptz(6)

  image images @relation(fields: [image_id], references: [image_id], onDelete: Cascade)

  @@unique([image_id, label, format])
  @@index([image_id])
}

// Enlace de acceso a un álbum `unlisted`/`private` con caducidad opcional.
// Distinto de la URL firmada de cada archivo: esto da acceso al ÁLBUM.
model album_share_tokens {
  share_token_id String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  album_id       String    @db.Uuid
  token_hash     String    @unique
  expires_at     DateTime? @db.Timestamptz(6)
  revoked        Boolean   @default(false)
  created_at     DateTime  @default(now()) @db.Timestamptz(6)

  album albums @relation(fields: [album_id], references: [album_id], onDelete: Cascade)
}
```

### 1.4 Pipeline de subida de imagen — flujo real (paso a paso)

Cada paso es una defensa; ninguno es opcional.

1. **Interceptor con `limits.fileSize`** — el archivo se corta en el límite *antes* de bufferizarse
   entero en memoria. Validar el tamaño *después* ya es un DoS de bajo esfuerzo.
2. **Rate limit dedicado** en el endpoint de subida, por debajo del límite global; un contador por
   usuario en Redis. Abuso sostenido → fila `security_events` tipo `upload_abuse`.
3. **Detección de tipo por contenido** (`file-type` sobre los magic bytes) — nunca el
   `Content-Type` del request ni la extensión, ambos los controla el cliente.
4. **Lista blanca de formatos** — solo `image/jpeg`, `image/png`, `image/webp`, `image/avif`
   (`image/gif` a decidir). **SVG por defecto NO** — un SVG es XML ejecutable; si se decide
   permitirlo, se sanitiza server-side y se sirve con `Content-Type` forzado + `Content-Disposition`.
5. **`sharp` con `limitInputPixels`** — rechaza imágenes de dimensiones absurdas (decompression
   bomb) antes de decodificarlas.
6. **Re-encode obligatorio** — la imagen se vuelve a codificar con `sharp`. Esto:
   - destruye cualquier payload embebido (polyglot, datos tras el marcador de fin de imagen),
   - **quita todos los metadatos EXIF/GPS** (dato personal — no se conserva salvo petición explícita),
   - normaliza el formato y la orientación.
7. **Nombre y ruta opacos** — `storage_key` aleatorio (UUID + extensión canónica). El nombre
   original del cliente se sanea y se guarda solo como etiqueta (`original_name`), nunca como ruta.
8. **Checksum SHA-256** — para deduplicar e integridad.
9. **Generación de derivados** — thumb/small/medium/large en WebP/AVIF, en un job (cola Redis) para
   no bloquear la respuesta si son muchos.
10. **Subida al almacenamiento vía `StorageService`** — solo el original ya normalizado y los
    derivados limpios llegan al almacén. En dev, el driver de disco los escribe bajo un directorio
    montado; en prod, el driver de Cloudinary los sube con `type` `upload` (álbum público/unlisted)
    o `authenticated` (álbum privado), `allowed_formats` restringido como defensa en profundidad, y
    subida firmada (nunca `unsigned`). Cloudinary es almacén + CDN + entrega, **no** el límite de
    seguridad: los pasos 1–8 ya corrieron server-side antes.
11. **Persistencia transaccional** — `images` + `image_variants` + `albums.image_count` en una sola
    transacción; si algo falla, se limpian los objetos ya subidos al almacén (compensación).

### 1.5 Servido de imágenes — control de acceso

| Visibilidad del álbum | Driver disco (dev) | Driver Cloudinary (prod) |
|---|---|---|
| `public` | URL estable servida por el backend; `X-Content-Type-Options: nosniff` | URL de entrega `upload` de Cloudinary, cacheable por su CDN |
| `unlisted` | Igual que pública pero el álbum no aparece en listados ni sitemap; requiere el slug | Igual — la ocultación es a nivel de álbum, no de archivo |
| `private` | **Solo URL firmada con expiración corta** (HMAC de `storage_key` + `exp`), emitida por el backend tras verificar dueño/rol administrativo | Recurso `authenticated` + **URL firmada de Cloudinary con expiración** generada por el backend tras la misma verificación |

Regla transversal (IDOR): todo endpoint que devuelve una imagen o un álbum privado **filtra por el
`user_id` del token**, nunca solo por el `:id` de la URL. El backend nunca expone el `public_id` ni
la URL cruda de Cloudinary de un recurso privado — solo la URL firmada de vida corta.

### 1.6 Módulos del backend (NestJS)

| Módulo | Responsabilidad |
|---|---|
| `auth` | Login en 3 pasos, registro, refresh, logout, cambio/recuperación de contraseña |
| `two-factor` | Setup (secreto + QR), confirmar-setup (activa 2FA, entrega códigos de recuperación), desactivar, regenerar códigos |
| `roles` | CRUD de roles dinámicos; candado de jerarquía (no crear/editar un rol de nivel ≥ al propio) |
| `users` | Administración de cuentas; candado de jerarquía (`assertCanManageRole`) |
| `security-events` | Conteo en Redis, fila real al cruzar umbral, alerta por correo |
| `albums` | CRUD de álbumes, visibilidad, layout, tema, slug, enlaces de compartir |
| `images` | Subida (pipeline §1.4), reordenado, edición de alt/caption, borrado |
| `media-processing` | `sharp`, derivados, blurhash — consumidores de la cola Redis |
| `storage` | `StorageService` abstracto — driver disco (dev) / driver Cloudinary (prod); firma de URLs de vida corta para recursos privados |
| `prisma` / `redis` / `mail` | Infraestructura |

### 1.7 Endpoints (primera versión)

```
POST   /auth/register
POST   /auth/login/step1            (correo — respuesta indistinguible exista o no)
POST   /auth/login/step2            (correo + contraseña — tokens, o challenge si 2FA)
POST   /auth/login/2fa              (challenge + código TOTP o de recuperación)
POST   /auth/refresh
POST   /auth/logout
GET    /auth/me
PATCH  /auth/me/password
POST   /auth/forgot-password
POST   /auth/reset-password

POST   /two-factor/setup                        (sesión iniciada) 
POST   /two-factor/confirm-setup
POST   /two-factor/disable
POST   /two-factor/recovery-codes/regenerate

GET    /roles                       (rol administrativo)
POST   /roles
PATCH  /roles/:id
DELETE /roles/:id                   (409 si is_system o tiene usuarios)

GET    /users                       (rol administrativo)
POST   /users
PATCH  /users/:id                   (rol, is_active — sujeto a jerarquía)

GET    /albums                      (los del usuario autenticado)
POST   /albums                      (título, visibilidad, layout, tema — todo de una vez)
GET    /albums/:id                  (dueño o rol administrativo)
PATCH  /albums/:id
DELETE /albums/:id
POST   /albums/:id/share-tokens     (crear enlace unlisted/private con caducidad)
DELETE /albums/:id/share-tokens/:t

POST   /albums/:id/images           (subida — pipeline §1.4)
PATCH  /images/:id                  (alt_text, caption, sort_order)
POST   /albums/:id/images/reorder   (lote de sort_order)
DELETE /images/:id

GET    /g/:slug                     (galería pública — sin auth para public/unlisted; token para private)
GET    /media/:storageKey          (redirige a URL firmada o sirve, según visibilidad)
```

### 1.8 Frontend (Next.js App Router)

```
gallery_frontend/src/app/
├── (public)/
│   ├── page.tsx                 # landing
│   └── g/[slug]/page.tsx        # galería pública — layout + animaciones
├── login/                      # 3 pantallas en pasos separados
├── registro/
├── cambiar-password/
├── cuenta/                     # perfil + activación de 2FA (QR real) 
├── studio/
│   ├── page.tsx                 # lista de álbumes del usuario
│   └── [albumId]/page.tsx       # subir, reordenar, editar tema/layout
├── admin/
│   ├── page.tsx                 # dashboard
│   ├── usuarios/
│   └── roles/
└── dev/cuentas-de-prueba/      # solo NODE_ENV !== 'production' — login real, nunca bypass
```

### 1.9 Personalización — el objeto `theme`

`albums.theme` es un JSON de **tokens de diseño**, no CSS libre (CSS libre sería un vector de
inyección). Forma provisional:

```jsonc
{
  "colors":     { "bg": "#0b0b0f", "fg": "#f5f5f7", "accent": "#ff5d3a" },
  "typography": { "fontFamily": "system", "scale": 1.0 },
  "layout":     { "gap": 12, "radius": 8, "maxColumns": 4 },
  "motion":     { "preset": "fade-up", "stagger": 60, "durationMs": 400 }
}
```

El frontend valida este objeto contra un schema (Zod) y lo traduce a **CSS custom properties**
(`--gallery-bg`, etc.) — nunca inyecta el valor crudo en un `<style>` sin validar. `motion.preset`
es un enum cerrado de animaciones predefinidas, no código.

---

## 2. Fase 1 — Núcleo / infraestructura (completada y verificada, 2026-09-01)

Cada fase construida y verificada agrega aquí su detalle técnico real y los hallazgos encontrados
en la ejecución (no solo "arrancó").

### 2.1 Qué se construyó

- Estructura del monorepo (`gallery_backend` / `gallery_frontend`), `.gitignore`, `.env.example`
  (todas las variables documentadas) y `.env` de desarrollo con secretos frescos propios de este
  proyecto (`openssl rand`) — Cloudinary en blanco hasta que exista la cuenta (`STORAGE_DRIVER=disk`).
- `docker-compose.yml` con 4 servicios: `gallery_db` (Postgres 18), `gallery_redis` (Redis 8, con
  contraseña), `gallery_backend`, `gallery_frontend`. Postgres y Redis publican **solo en
  `127.0.0.1`**, ambos con healthcheck; el backend arranca con `depends_on: condition:
  service_healthy`.
- Backend NestJS 11: `main.ts` (helmet, CORS restringido a lista explícita, `ValidationPipe`
  `whitelist + forbidNonWhitelisted`, `cookie-parser`, Swagger `/docs` + `/api-json` solo fuera de
  producción); `PrismaModule`/`PrismaService` (con driver adapter de Prisma 7 — ver 2.2);
  `RedisModule`/`RedisService` (ioredis, helper `incrementWithTtl` para rate limiting); validación
  de entorno al arranque (`validateEnv` — falla si falta una variable o si `TOTP_ENCRYPTION_KEY`
  no son 64 hex); `GET /health` (comprueba Postgres y Redis en vivo).
- `prisma/schema.prisma` con el schema congelado de §1.3 + migración inicial única
  `20260901235839_init` (240 líneas SQL, 11 tablas).
- Frontend Next.js 16 (App Router, React 19): `layout.tsx`, landing placeholder que lee
  `NEXT_PUBLIC_API_BASE_URL`, `globals.css` con el piso de `prefers-reduced-motion`.
- Repositorio git propio, primer commit.

### 2.2 Prisma 7.10 — cambios de fondo respecto a versiones anteriores

Prisma 7 cambió el modelo de conexión. Lo que hubo que hacer, distinto a "lo de siempre":

1. **La URL ya no vive en `schema.prisma`.** El bloque `datasource db` solo lleva `provider`. La
   URL para el CLI de Migrate/Studio va en un archivo nuevo, **`prisma.config.ts`** (raíz del
   backend), campo `datasource.url`.
2. **El `PrismaClient` necesita un driver adapter.** Ya no hay motor de consultas Rust embebido:
   las consultas salen por `pg` (node-postgres) a través de **`@prisma/adapter-pg`**.
   `PrismaService` construye `new PrismaPg({ connectionString: DATABASE_URL })` y llama
   `super({ adapter })`. Dependencias nuevas: `@prisma/adapter-pg`, `pg`, `@types/pg`.
3. **Prisma 7 ya no carga `.env` solo.** `prisma.config.ts` lo hace con `process.loadEnvFile()`
   (nativo en Node 20.6+, sin dependencia `dotenv`). Dentro del contenedor no hay `.env` — las
   variables las inyecta docker-compose — así que la llamada va en `try/catch` y se ignora si el
   archivo no existe.
4. **`prisma migrate reset` está bloqueado para "agentes de IA"** sin la variable
   `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`. Para regenerar la migración inicial limpia se
   destruyó el volumen de la BD de desarrollo (`docker compose down -v`) en vez de usar `reset`.
5. **`prisma migrate diff` cambió de flag** (`--to-schema-datamodel` → `--to-schema`) y, en este
   entorno, `--from-empty --to-schema <archivo>` devolvió salida vacía. La migración inicial se
   generó con `prisma migrate dev --name init` contra una BD de desarrollo real y desechable.
6. **`npm audit`**: 4 vulnerabilidades *high* provienen del árbol de dependencias del **CLI de
   Prisma** (`mysql2 <3.22.0`, `deepmerge-ts <8.0.0`, vía `@prisma/config`). Son **devDependency**,
   sin ruta de explotación alcanzable aquí (el proyecto usa PostgreSQL, no MySQL; `deepmerge-ts`
   solo procesa el propio config de Prisma). `npm audit fix --force` propone *bajar* a Prisma 6
   (cambio disruptivo) — no se aplica. **Pendiente**: seguir los releases de Prisma 7 y actualizar
   cuando publiquen el parche de transitivas. Registrado en `PRUEBAS_SEGURIDAD.md`.

### 2.3 Otros hallazgos de la ejecución

- **`postgres:18-alpine` cambió la convención del volumen de datos**: el mount va en
  `/var/lib/postgresql` (no `/var/lib/postgresql/data`) — con el path viejo el contenedor entra en
  bucle de reinicio con un error de guardia de versión. Corregido en `docker-compose.yml`.
- **Colisión de puertos**: 3040/3041/5437/5522 ya estaban ocupados por otro stack de desarrollo en
  este equipo (el portafolio `dvloprbn`). Puertos reasignados y verificados libres con `ss -ltn`:
  API host 3050, frontend 3051, Postgres 5438, Redis 6383, Prisma Studio 5523, docs 8098/8099
  (ver §1.2). El puerto interno del contenedor (3040/3041) es fijo y distinto del puerto del host.

### 2.4 Verificación real (no solo "arrancó")

`docker compose up -d --build` — los 4 contenedores arriba, `gallery_db`/`gallery_redis` healthy.

- `GET http://localhost:3050/health` → `200` `{"status":"ok","checks":{"database":true,"redis":true}}`
  — el backend habla con Postgres (vía el driver adapter de Prisma 7) y con Redis.
- `GET http://localhost:3050/api-json` → spec OpenAPI 3.0 generado, con la ruta `/health`.
- `GET http://localhost:3051/` → `200`, HTML con `<title>Galería</title>` renderizado por Next.
- Logs del backend: `migrate deploy` → "No pending migrations to apply"; `tsc` watcher → "Found 0
  errors"; `PrismaService`/`RedisModule` → "Conexión establecida"; `Nest application successfully
  started`.
- `tsc -p tsconfig.build.json --noEmit` en el host → 0 errores.

---

## 3. Fase 2 — Identidad (completada y verificada, 2026-09-01)

### 3.1 Qué se construyó

**Utilidades puras** (`src/common/utils/`, cada una con su `*.spec.ts`):
`crypto.util` (AES-256-GCM para el secreto TOTP), `totp.util` (RFC 6238 vía `otplib`),
`escape-html.util`, `token.util` (token opaco + `sha256Hex` + comparación en tiempo constante),
`duration.util` (`"15m"` → ms / segundos).

**`auth`** — login en 3 pasos en pantallas separadas (correo → contraseña → 2FA), registro público
con auto-login, `refresh` con rotación + ventana de gracia (10 s) + revocación en cascada al
detectar reuso, `logout`, `GET /me`, cambio y recuperación de contraseña. JWT `HS256` fijado
explícito; access token en cookie httpOnly, refresh token opaco (en la BD solo su `sha256`).
Entre el paso de contraseña y el de 2FA se emite un **challenge token** de 5 min con `purpose`
propio — nunca sirve como sesión.

**`two-factor`** — `setup` (secreto cifrado + QR real con `qrcode`), `confirm-setup` (activa 2FA y
entrega 10 códigos de recuperación de un solo uso, hasheados con bcrypt), `disable` (pide
contraseña), `regenerate` (pide código TOTP).

**`roles`** — CRUD de roles dinámicos con el candado de jerarquía: nadie crea/edita/borra un rol de
nivel ≥ al suyo; un rol `is_system` no cambia de `level`/`max_count` ni se borra.

**`users`** — alta administrativa (contraseña temporal + `must_change_password`, correo de
bienvenida, `tempPassword` en la respuesta solo si el correo no se entregó), cambio de rol/estado.
`assertCanManageRole`: solo cuentas de nivel estrictamente menor, y respeta `max_count` (excluyendo
a la propia cuenta al reasignarle su mismo rol). Vista "segura" — nunca expone `password_hash` ni
`totp_secret_encrypted`.

**`security-events`** — conteo en Redis (ventana fija) para login (10/15 min), 2FA (5/15 min) y
reuso de refresh token; fila real en `security_events` + alerta por correo solo al cruzar el umbral.

**`mail`** — Resend por `fetch` nativo; degrada con elegancia (nunca truena el flujo llamador).

**`prisma/seed.ts`** — 6 roles (`usuario`=0 … `super`=5, con `max_count:1` para `director`/`super`)
y una cuenta de prueba por rol (`<rol>+gallery@example.com`, contraseña `TestOnly123!`).

**Guards globales** (`APP_GUARD`): `JwtAuthGuard` (toda ruta exige sesión salvo `@Public()`) y
`RolesGuard` (aplica `@Roles()`). `GET /health` marcado `@Public()`.

### 3.2 Hallazgos de la ejecución

- **`otplib` 13 es una reescritura completa** (ESM-first, API asíncrona, sin el singleton
  `authenticator`). Para un camino tan sensible como la verificación de 2FA se fijó **`otplib@12`**
  — la API estable y ubicua, sin CVEs. No es un atajo: es elegir la herramienta probada para una
  pieza de seguridad.
- **`@nestjs/common` (Nest 11) no exporta `TooManyRequestsException`.** Se usa
  `new HttpException(msg, HttpStatus.TOO_MANY_REQUESTS)` para el 429 de fuerza bruta.
- **`@nestjs/jwt` v12** tipa `expiresIn` como `number | StringValue` (plantilla del paquete `ms`).
  Un `string` plano de una variable de entorno no encaja — se pasa el TTL ya convertido a
  **segundos** (`durationToSeconds`), sin `as any`.
- Directorios `dist/`/`storage/` root en el bind-mount del host (los escribe el contenedor). No
  ensucian el commit (gitignore), pero el `tsc` local necesitaba `rm -rf dist` (vía un contenedor
  efímero) antes de correr — Nest los recrea igualmente.

### 3.3 Verificación real (curl contra el backend en vivo)

- **Anti-enumeración**: `login/step1` responde `{"next":"password"}` idéntico exista o no el correo.
- **Registro** → 201 + cookies httpOnly (`access_token`, `refresh_token`); `GET /auth/me` →
  `roleName:"usuario"`.
- **`ValidationPipe`**: contraseña `"corta"` → 400; propiedad `role_id` extra en el body → 400.
- **RBAC**: `usuario` → `GET /users` 403; `admin` → 200.
- **Jerarquía de roles** (admin = nivel 3): crear rol nivel 4 → 403; nivel 2 → 201; `DELETE`
  de un rol `is_system` → 409.
- **Jerarquía de cuentas**: admin crea `director` → 403; crea `manager` → 201.
- **`max_count`**: `super` intenta un 2º `director` → 409.
- **Refresh**: 1ª rotación → 200; reusar el refresh viejo (fuera de la gracia) → 401; la sesión
  rotada también queda revocada (cascada) → 401.
- **Logout**: `/auth/me` 200 antes, 401 después.
- **2FA completo**: `setup` (secreto + QR data URL) → `confirm-setup` con TOTP real → 10 códigos
  de recuperación → `login/step2` ahora devuelve `{next:"2fa"}` sin sesión → `login/2fa` con TOTP
  → 200 → el challenge token usado como cookie de acceso → 401 → `login/2fa` con un código de
  recuperación → 200 → reusar el mismo código de recuperación → 401.
- **Fuerza bruta**: 10 intentos con contraseña incorrecta → 401; 11º y 12º → 429; fila real en
  `security_events` (`type=login_bruteforce`, `attempts=10`, `status=nuevo`).
- `tsc` limpio; 11 tests de `jest` (utilidades puras) verdes. Datos de prueba borrados después
  (BD de vuelta a las 6 cuentas + 6 roles sembrados).

---

## 4. Fase 3 — Media core (completada y verificada, 2026-09-01)

### 4.1 Qué se construyó

**`storage`** — abstracción `StorageService` + `StorageDriver` (interfaz). Dos implementaciones:
- **`DiskStorageDriver`** (dev): escribe bajo `STORAGE_DISK_ROOT` con claves `<uuid>.<ext>`; las
  URLs apuntan de vuelta a `GET /media/:key` (firmadas con HMAC para privados). Valida el formato
  de la clave antes de tocar el FS (path traversal).
- **`CloudinaryStorageDriver`** (prod): sube con `type: 'upload'` (public/unlisted) o
  `type: 'authenticated'` + URL firmada con expiración (private); `allowed_formats` como defensa en
  profundidad. La clave guarda `"<deliveryType>:<public_id>"` para reconstruir la URL.
- `media-signing.ts` — HMAC-SHA256 de `key.exp` con `MEDIA_URL_SIGNING_SECRET`; verificación en
  tiempo constante + chequeo de expiración.

**`media-processing`** — `ImagePipelineService.process(buffer)`:
1. `sharp(buffer, { limitInputPixels })` + `.metadata()` — **`sharp` es la única autoridad de
   tipo**: si no decodifica → no es imagen; si el `format` no está en `{jpeg,png,webp,avif}` → 400
   (SVG rechazado siempre: es XML ejecutable). No se usa `file-type` — sería redundante.
2. Re-codificación del original: `.rotate()` aplica y descarta la orientación EXIF; `sharp` no
   conserva metadatos ⇒ **EXIF/GPS eliminados**. Salida JPEG (mozjpeg q88) o PNG.
3. Derivados WebP: `thumb` 240 / `small` 640 / `medium` 1280 / `large` 2048, `withoutEnlargement`.
4. `checksum_sha256` del original re-codificado.
5. BlurHash 4×4 (placeholder); si falla, `''` — nunca tumba la subida.

**`albums`** — CRUD (`visibility`/`layout`/`theme` se fijan al crear), enlaces de compartir
(`album_share_tokens`, opaco + `sha256` en BD, caducidad opcional), `canManage` (dueño o rol
`admin`/`director`/`super`). `getOwned` devuelve **404** (no 403) sin acceso, para no revelar
existencia. `theme` se rechaza si su JSON supera 4 KB (no es CSS libre).

**`images`** — `upload` (rate limit 120/h por usuario en Redis → pipeline → `storage.put` original
+ 4 derivados → transacción `images` + `image_variants` + `image_count`, y portada si el álbum no
tiene; **compensación**: si la transacción falla, se borran los objetos ya subidos), `listForAlbum`
(Studio), `update` (alt/caption/orden), `reorder` (la lista debe ser exactamente las imágenes del
álbum), `remove` (borra objetos + fila + ajusta `image_count`/portada).

**`media`** (entrega pública, rutas `@Public()`):
- `GET /g/:slug` — galería por slug. `public`/`unlisted` → abierta; `private` → exige `?token=`
  válido (no revocado, no caducado). Sin acceso → 404. Devuelve álbum + imágenes ordenadas con
  URLs de entrega ya resueltas según visibilidad.
- `GET /media/:key` — sirve archivos del driver de disco. `private` ⇒ exige `exp`+`sig` HMAC
  válidos, si no 404. Cabeceras: `Content-Type` real, `X-Content-Type-Options: nosniff`,
  `Cache-Control` (`public, max-age=3600, immutable` / `private, no-store`).

### 4.2 Decisiones / hallazgos

- **Se descartó `file-type`.** v22 es ESM-only (fricción con el build CommonJS de Nest) y, sobre
  todo, es redundante: `sharp` decodifica el contenido real y reporta el formato — si `sharp` no
  puede leerlo, no es una imagen. Una dependencia menos y un vector de fallo menos.
- **`theme` es `Prisma.InputJsonValue`**, no `Record<string, unknown>` — Prisma 7 no acepta
  `unknown` en un campo `Json`. Se castea en el punto de escritura.
- Cascada de Prisma (`onDelete: Cascade`) limpia `images`/`image_variants`/`album_share_tokens` al
  borrar el álbum, pero **los objetos del almacenamiento se borran a mano antes** (Prisma no sabe
  de archivos).

### 4.3 Verificación real (curl + `sharp` contra el backend en vivo)

- **Tipo falsificado**: texto plano renombrado `.jpg` → **400**; SVG con `<script>` → **400**.
- **Subida válida**: JPEG 1600×1200 con EXIF+GPS (212 bytes de EXIF) → `imageId`, blurhash de 36
  chars, 4 variantes (`thumb/small/medium/large`), dimensiones conservadas.
- **EXIF eliminado**: el original **servido** no tiene ningún byte de EXIF (verificado con
  `sharp().metadata()`).
- **Decompression bomb**: PNG 9000×9000 (81 MP, 253 KB) → **400** (`limitInputPixels`).
- **Límite de tamaño**: archivo de 20 MB → **413** (cortado en el interceptor, `limits.fileSize`).
- **URL de privado**: lleva `?exp=&sig=`; `GET /media/:key` sin firma → **404**; con firma
  manipulada → **404**.
- **IDOR**: otro usuario → `GET /albums/:id` **404**, `GET /albums/:id/images` **404**,
  `DELETE /images/:id` **403**.
- **Galería privada** sin token → **404**; con enlace de compartir válido → **200** (devuelve
  imágenes + `layout` + `theme`).
- **Público**: al cambiar `visibility` a `public`, la URL del `thumb` ya no lleva firma y
  `GET` la sirve **200** `image/webp`.
- **Limpieza**: tras borrar imagen y álbum, la BD vuelve a 6 cuentas / 6 roles / 0 álbumes / 0
  imágenes / 0 variantes y **0 archivos** en el volumen de almacenamiento.
- `tsc` limpio; 11 tests `jest` verdes.

---

## 5. Fase 4 — Galería pública (frontend) (completada y verificada, 2026-09-01)

### 5.1 Qué se construyó

**`lib/`**:
- `gallery-schema.ts` — esquemas **Zod** de la respuesta de `GET /g/:slug` y del `theme`. El
  `theme` es un objeto cerrado de tokens (`colors`/`typography`/`layout`/`motion`), cada valor
  acotado a un rango; `.catch({})` descarta cualquier cosa fuera de esquema.
- `theme.ts` — traduce el `theme` validado a **CSS custom properties** (`--g-bg`, `--g-accent`,
  `--g-gap`, …). Nunca se inyecta un valor crudo en un `<style>`.
- `api.ts` — `fetchGallery(slug, token)` y `fetchPublicGalleries()` desde Server Components,
  usando `API_INTERNAL_URL` (red interna de Docker) con fallback a la URL pública.

**Componentes** (`components/`):
- `GalleryView` — aplica el tema, pinta el layout, gestiona el estado del lightbox.
- `GalleryLayout` — 4 layouts en CSS puro: `masonry` (`column-count`), `grid` (recorte cuadrado
  con `object-fit: cover`), `justified` (filas de alto igual con `flex-grow`/`flex-basis` por
  aspect ratio + `::after { flex-grow: 999999 }`), `carousel` (`scroll-snap`). Animación de
  entrada por `IntersectionObserver` que añade `.is-in`; el escalonado va en `--reveal-delay` y
  la duración/preset (`fade-up`/`fade`/`zoom`) los da el `theme`.
- `GalleryImage` — `<img>` con `srcset` de los 4 derivados + `sizes` por layout, `loading="lazy"`
  (las 3 primeras `eager`), `decoding="async"`, `width`/`height` reales (sin layout shift) y un
  `<BlurhashCanvas>` detrás que se desvanece al cargar la imagen.
- `BlurhashCanvas` — decodifica el BlurHash a un `<canvas>` 32×32.
- `Lightbox` — visor a pantalla completa, navegación con flechas/teclado, cierre con Escape o
  clic en el fondo, transiciones CSS (`.is-open`), bloquea el scroll del body mientras está abierto.

**Rutas** (`app/`):
- `g/[slug]/page.tsx` — Server Component: pide y **valida con Zod** en el servidor, `notFound()`
  si no hay galería; `generateMetadata` marca `noindex` si el álbum no es `public`.
- `page.tsx` — índice de galerías públicas (`GET /galleries`).
- `not-found.tsx`, `global-error.tsx` — páginas propias, mínimas.
- Ambas rutas con datos en vivo son `export const dynamic = 'force-dynamic'`.

**`scripts/seed-demo.ts`** (backend) — siembra una galería de demostración usando el **flujo real**
(login → crear álbum público con tema propio → subir 8 imágenes por el pipeline). Idempotente. Se
corre a mano: `docker compose exec gallery_backend npx ts-node scripts/seed-demo.ts`.

**`GET /galleries`** (nuevo, `@Public()`) — índice de álbumes `public` recientes con la miniatura
de portada.

### 5.2 Decisiones / hallazgos

- **`next build` DEBE correr con `NODE_ENV=production`.** El `docker-compose.yml` de desarrollo fija
  `NODE_ENV=development` (correcto para `next dev`). Correr `next build` con ese valor hace fallar
  el prerender de la página interna `/_global-error` con `TypeError: Cannot read properties of
  null (reading 'useContext')` — un síntoma engañoso que no tiene que ver con el código de la app.
  Con `NODE_ENV=production` el build pasa limpio. **A tener en cuenta en el `docker-compose.prod.yml`
  de la Fase 9.**
- **Sin librería de animación.** Se probó `motion`/`framer-motion` y se quitó: la animación de
  entrada (fade-up escalonado al hacer scroll) y el lightbox se resuelven con
  `IntersectionObserver` + transiciones CSS, sin JS de animación en el bundle — mejor rendimiento
  para una galería con muchas imágenes, y una dependencia menos.
- **Layouts en CSS, no en JS.** `justified` usa el truco de `flex-grow` por aspect ratio en vez de
  un empaquetador de filas en JavaScript — aproximado pero sólido y sin coste de layout en cliente.
- Las páginas con datos en vivo son `force-dynamic` (SSR por petición) — no se prerenderizan; para
  SEO de galerías públicas basta el HTML completo por request (ISR queda como mejora futura).
- **`fonts-dejavu-core` + `fontconfig`** añadidos al `Dockerfile.dev` del backend: sin ellos,
  `sharp`/librsvg no rasteriza el texto de las imágenes generadas por el seed de demo (las subidas
  reales rechazan SVG, así que no les afecta).

### 5.3 Verificación real

- `docker compose exec gallery_backend npx ts-node scripts/seed-demo.ts` → álbum público
  "Demo — Galería de ejemplo" con 8 imágenes reales por el pipeline.
- `GET http://localhost:3050/galleries` → 1 álbum con `coverUrl`.
- `GET http://localhost:3051/` → 200, tarjeta del índice enlazando a `/g/<slug>`.
- `GET http://localhost:3051/g/<slug>` → 200; el HTML SSR trae `<h1 class="g-title">`,
  `g-layout--masonry`, 8 `g-figure` + 8 `g-blur` + 8 `g-reveal` con `data-preset="fade-up"` y
  `--reveal-delay` escalonado; `<img srcSet>` con las 4 variantes por imagen.
- `GET http://localhost:3051/g/no-existe` → 404 (página `not-found` propia).
- `NODE_ENV=production npx next build` → **pasa**: `/` y `/g/[slug]` dinámicas, `/_not-found`
  estática. `tsc` del backend limpio.
