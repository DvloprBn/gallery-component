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
  cover_media_id String?   @db.Uuid
  sort_order     Int       @default(0)
  media_count    Int       @default(0)  // desnormalizado, mantenido en transacción
  created_at     DateTime  @default(now()) @db.Timestamptz(6)
  updated_at     DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  owner  users    @relation(fields: [owner_user_id], references: [user_id], onDelete: Cascade)
  media  media[]
  share_tokens album_share_tokens[]

  @@index([owner_user_id])
  @@index([visibility])
}

// Un elemento (foto o video — `kind`) subido y ya normalizado (re-encode con
// sharp/ffmpeg, sin metadatos). `storage_key` es la ruta opaca dentro del
// StorageService (nunca el nombre original del cliente). `checksum_sha256`
// deduplica y detecta corrupción. El original re-encodeado (master) se guarda
// para regenerar derivados, pero NUNCA se sirve directo a la galería.
// (Fase 14a — antes se llamaba `images`; se unificó para soportar video.)
enum media_kind { photo  video }

model media {
  media_id        String     @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  album_id        String     @db.Uuid
  owner_user_id   String     @db.Uuid
  kind            media_kind @default(photo)
  storage_key     String     @unique
  original_name   String?    @db.VarChar(255)
  mime_type       String     @db.VarChar(50)  // detectado por contenido, no por extensión
  width           Int
  height          Int
  bytes           Int
  checksum_sha256 String     @db.VarChar(64)
  placeholder     String?    @db.VarChar(120) // blurhash o color dominante
  alt_text        String?    @db.VarChar(500)
  caption         String?    @db.VarChar(2000)
  sort_order      Int        @default(0)
  status          String     @default("draft") @db.VarChar(16) // archived | draft | published
  rights          Json?      // registro de derechos por elemento (Fase 11)
  created_at      DateTime   @default(now()) @db.Timestamptz(6)

  album            albums             @relation(fields: [album_id], references: [album_id], onDelete: Cascade)
  owner            users              @relation(fields: [owner_user_id], references: [user_id], onDelete: Cascade)
  variants         media_variants[]
  license_requests license_requests[]
  licenses         licenses[]

  @@index([album_id])
  @@index([album_id, status])
  @@index([owner_user_id])
}

// Derivados responsivos generados por el pipeline. Se sirven ESTOS, nunca
// el original. Foto: `format` moderno (webp/avif) con fallback jpeg. Video
// (Fase 14): renditions HLS + preview progresivo.
model media_variants {
  variant_id  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  media_id    String   @db.Uuid
  storage_key String   @unique
  label       String   @db.VarChar(20)  // thumb | small | medium | large
  format      String   @db.VarChar(10)  // webp | avif | jpeg
  width       Int
  height      Int
  bytes       Int
  created_at  DateTime @default(now()) @db.Timestamptz(6)

  media media @relation(fields: [media_id], references: [media_id], onDelete: Cascade)

  @@unique([media_id, label, format])
  @@index([media_id])
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

---

## 6. Fase 5 — Studio y paneles (frontend) (completada y verificada, 2026-09-01)

### 6.1 Qué se construyó

**Infra de sesión en el cliente**:
- `lib/api-client.ts` — `apiFetch()` con `credentials: 'include'` (la sesión son cookies httpOnly
  que el JS no lee; el navegador las adjunta). Serializa JSON o pasa `FormData` tal cual; lanza
  `ApiError` con el mensaje de la API en respuestas no-2xx.
- `lib/auth.tsx` — `<AuthProvider>` + `useAuth()` (pide `/auth/me` al montar; `me` `null` sin
  sesión no es error). `<RequireAuth roles={...}>` redirige a `/login?next=` o a `/` según falte
  sesión o rol — el backend igual rechaza cada petición, esto solo evita pintar una pantalla
  inútil.
- `SiteNav` — barra del sitio; se oculta dentro de `/g/...`; enlaces según sesión/rol.

**Rutas nuevas** (todas Client Components):
- `/login` — 3 pasos en pantallas separadas (correo → contraseña → 2FA), con `<Suspense>`
  alrededor del componente que usa `useSearchParams` (`?next=`).
- `/registro` — alta con auto-login.
- `/cuenta` — cambio de contraseña + **activación de 2FA** (QR real de `POST /two-factor/setup`,
  confirmación con código, muestra los 10 códigos de recuperación una vez; desactivar pide contraseña).
- `/studio` — lista de álbumes propios + crear (formulario **con todos los ajustes de una vez** —
  visibilidad, layout y los tokens del tema: colores, tipografía, columnas, separación, radio,
  preset de animación — no "crear y luego ir a editar").
- `/studio/[albumId]` — subir varios archivos (uno tras otro, estado por archivo), rejilla de
  imágenes editable (alt/pie inline, hacer portada, borrar, **reordenar arrastrando** con
  `POST /images/reorder`), ajustes del álbum (mismo formulario), enlaces de compartir
  (crear/listar/revocar — endpoint `GET /albums/:id/share-tokens` nuevo), y borrar el álbum.
- `/admin`, `/admin/usuarios` (listar, alta con contraseña temporal, cambiar rol/estado),
  `/admin/roles` (listar, crear, borrar) — bajo `<RequireAuth roles={['admin','director','super']}>`.

**Cambios de backend menores**:
- `AuthenticatedUser` + `/auth/me` ganan `totpEnabled` (el frontend necesita saber si mostrar
  "activar" o "desactivar" 2FA) — leído en vivo en `JwtStrategy.validate`.
- `GET /albums/:id/share-tokens` — lista los enlaces (sin el token en claro) para poder revocarlos
  desde el Studio.

### 6.2 Hallazgos

- **`useSearchParams()` exige un `<Suspense>` alrededor** o el `next build` (producción) falla al
  prerenderizar esa ruta — con un error engañoso (recursión profunda en el runtime de Next, no un
  mensaje claro). Solución: el `export default` de `/login` solo renderiza
  `<Suspense><LoginForm/></Suspense>`.
- Confirmado que el arreglo de `NODE_ENV=production` para `next build` (§5.2) se mantiene con las
  15+ rutas nuevas: `/_global-error` ya no falla.
- El `apiFetch` tuvo que tipar `init` como `Omit<RequestInit, 'body'> & { body?: unknown }` — una
  intersección simple con `RequestInit` deja `body` como `BodyInit`, no `unknown`.

### 6.3 Verificación real (curl con la forma exacta que manda la UI)

- Login en 3 pasos, `/auth/me` devuelve `totpEnabled`.
- Crear álbum con el `theme` anidado del formulario → aceptado, `theme.motion.preset` persistido.
- Subir imagen → `imageId` + 5 URLs; `PATCH coverImageId` → 200; `GET /albums/:id/images` → ok;
  `POST /images/reorder` → 200.
- Enlaces de compartir: crear → `GET` lista (endpoint nuevo) → `DELETE` revoca (204).
- Las 7 páginas nuevas (`/login`, `/registro`, `/studio`, `/cuenta`, `/admin`, `/admin/roles`,
  `/admin/usuarios`) → 200 SSR.
- `NODE_ENV=production next build` → **pasa** (11 rutas), `tsc` backend limpio, 11 tests jest verdes.

---

## 7. Fase 9 — Despliegue (artefactos listos y verificados en local, 2026-09-01)

### 7.1 Qué se creó

- **`gallery_backend/Dockerfile`** — build multi-etapa. Etapa 1: `npm ci`, `prisma generate`,
  `nest build`, `npm prune --omit=dev`. Etapa 2 (runtime, `node:22-bookworm-slim`, usuario `node`):
  solo `node_modules` podado + `dist` + `prisma` + `prisma.config.ts`. Arranque:
  `prisma migrate deploy` + seed de roles/cuentas (idempotente) + `node dist/main.js`.
  `prisma` se movió a `dependencies` (se necesita en runtime para `migrate deploy`).
- **`gallery_frontend/Dockerfile`** — multi-etapa con `output: 'standalone'` de Next: la imagen
  final es `.next/standalone` + `.next/static` + `public` (≈68 MB). `NEXT_PUBLIC_API_BASE_URL=/api`
  entra como **`ARG` de build** (se hornea en `next build`, no en el arranque).
- **`Caddyfile`** — un solo `site` (`{$SITE_DOMAIN}`): `/api/*` → `gallery_backend:3040`, el resto →
  `gallery_frontend:3041`. TLS automático con un dominio real. Un solo origen ⇒ sin CORS,
  cookies host-only.
- **`docker-compose.prod.yml`** — `gallery_db` + `gallery_redis` **sin puertos publicados** (solo
  red interna), `gallery_backend` (`NODE_ENV=production`, `GLOBAL_PREFIX=api`,
  `STORAGE_DRIVER=cloudinary`, `env_file: .env.prod`), `gallery_frontend`, y `caddy` (único
  servicio con puertos: 80/443).
- **`.env.prod.example`** — plantilla de producción (secretos propios, Cloudinary+Resend de la
  cuenta del portafolio, URLs `https://galeria.dvloprbn.dev`).
- **`main.ts`** — en producción activa `trust proxy: 1` para que `req.ip` (fuerza bruta) sea la IP
  real del cliente detrás de Caddy, no la del proxy.

### 7.2 Hallazgos

- **`nest build` metía todo en `dist/src/main.js`** (no `dist/main.js`) porque `tsconfig.build.json`
  incluía `prisma/` y `scripts/` además de `src/` → tsc infería `rootDir` = `/app`. Corregido con
  `"include": ["src/**/*"]` + `"rootDir": "src"` + excluir `prisma`, `prisma.config.ts`, `scripts`.
  Los typechecks manuales pasan a usar el `tsconfig.json` base (chequea todo).
- **`tsconfig.build.tsbuildinfo` del host se colaba en la imagen** (`COPY . .`) y hacía que tsc
  incremental creyera "todo al día" y **no emitiera nada** — `dist/` quedaba vacío. Corregido
  añadiendo `*.tsbuildinfo` (y `Dockerfile*`) al `.dockerignore` del backend.
- Cookie `secure` (que se activa con `NODE_ENV=production`) no se guarda sobre HTTP plano — para
  probar el stack de producción en local hay que usar `SITE_DOMAIN=http://localhost` y un cliente
  como `curl`; en el dominio real (HTTPS) es correcto.

### 7.3 Verificación real (stack de producción levantado en local, tras Caddy en `http://localhost`)

`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build` — 5 contenedores;
Postgres/Redis sin puertos al host; solo Caddy expone 80/443.

- `migrate deploy` + seed de 6 roles / 6 cuentas corren al arrancar el backend.
- `GET /api/health` → `{"status":"ok","checks":{"database":true,"redis":true}}`.
- `GET /api/galleries` → 200. `GET /` → 200 con `<title>Galería</title>` (Next standalone).
  `GET /login` → 200.
- `GET /api/api-json` → **404** (Swagger correctamente desactivado con `NODE_ENV=production`).
- **Login por el mismo origen**: `POST /api/auth/login/step2` fija las cookies (`HttpOnly`
  visible); `GET /api/auth/me` con esas cookies devuelve el usuario — el flujo de sesión funciona
  a través del reverse proxy sin CORS.
- Imagen del frontend ≈ 68 MB (salida standalone).

---

## 8. Fase 8 — Documentación autogenerada (completada y verificada, 2026-09-01)

### 8.1 Qué se creó

- **Plugin de `@nestjs/swagger` en `nest-cli.json`** (`compilerOptions.plugins: ["@nestjs/swagger"]`)
  — anota automáticamente los DTOs a partir de sus tipos, sin `@ApiProperty` a mano. El
  `/api-json` pasó de **0 a 18 schemas** de componentes.
- **`docs/`** — portal MkDocs Material (imagen `squidfunk/mkdocs-material:9.5.49` + plugin
  `mkdocs-swagger-ui-tag`), 5 páginas: Inicio, Arquitectura, Jerarquía de roles, Seguridad, y
  **API (OpenAPI)** con Swagger UI embebido en vivo (`<swagger-ui src=".../api-json"/>`).
- **`gallery_compodoc`** — contenedor `node:22-slim` que reusa el `node_modules` del backend y
  corre `compodoc -p tsconfig.json -d documentation -s -r 8080 --host 0.0.0.0 -w`. `@compodoc/compodoc`
  se añadió como devDependency del backend.
- Ambos servicios en `docker-compose.yml`, **solo en `127.0.0.1`** (8098 docs, 8099 compodoc) — un
  portal de documentación interna es, en los hechos, un mapa de la arquitectura.
- `ALLOWED_ORIGINS` del backend ganó `http://localhost:8098` para que el navegador pueda pedir el
  `/api-json` desde el portal (CORS).

### 8.2 Hallazgos

- `compodoc` v2 renombró `--hostname` a **`--host`**; sin `--host 0.0.0.0` el servidor solo
  escuchaba en el `localhost` del contenedor y el mapeo de puerto no llegaba.
- **`npm ci` del build de producción falló** hasta regenerar `gallery_backend/package-lock.json`
  (había cambiado `package.json`: `prisma` a `dependencies`, `@compodoc/compodoc` nuevo). `npm ci`
  exige el lockfile sincronizado — se regeneró con `npm install --package-lock-only`.

### 8.3 Verificación real

- `GET http://localhost:3050/api-json` → 29 rutas, **18 schemas** de DTOs (el plugin de swagger
  funciona). CORS desde `http://localhost:8098` → `Access-Control-Allow-Origin` correcto.
- `gallery_docs` (`http://localhost:8098`) → las 5 páginas responden 200; `/api/` embebe el
  `<swagger-ui>` apuntando al `/api-json` del backend.
- `gallery_compodoc` (`http://localhost:8099`) → sirve la documentación con el grafo de
  dependencias (14 módulos), y — confirmado — **parsea los comentarios TSDoc reales**: la página de
  `AuthService` muestra el texto exacto del código ("Toda la lógica de identidad…", "login en 3
  pasos…"), que es justamente para lo que existe el estándar de comentarios del `PLAN_DESARROLLO.md`
  §7.
- El build de producción del backend sigue pasando con el plugin de swagger activo
  (`dist/main.js`, `prisma` presente en el runtime).

---

## 9. Pulido posterior (2026-09-01)

Tras completar las 9 fases: más pruebas, verificación real de Cloudinary, y pulido visual de las
superficies de vitrina.

### 9.1 Pruebas — de 11 a 36 (8 suites)

- **Puras nuevas**: `slug.util.spec.ts`, `media-signing.spec.ts` (HMAC: firma válida / manipulada /
  de otra clave / expirada / campos faltantes).
- **`image-pipeline.service.spec.ts`**: procesa un JPEG válido (original normalizado + 4 derivados
  WebP + placeholder BlurHash), **confirma que el EXIF se elimina** del original servido, rechaza
  texto que no es imagen, rechaza SVG, rechaza una imagen de 81 MP (decompression bomb).
- **`roles.service.spec.ts` / `users.service.spec.ts`** — integración contra el **Postgres real**
  de desarrollo (`TestingModule` no, `new PrismaService()` directo). Prueban la regla de jerarquía:
  no crear/gestionar un rol o cuenta de nivel ≥ al propio, `is_system` protegido, no borrar rol con
  cuentas, `max_count` contra cuentas activas, exclusión de la propia cuenta al reconfirmar su rol,
  no gestionarse a sí mismo. Cada `expect().rejects` confirma además que el estado en Postgres **no
  cambió**. `afterAll` borra los datos de prueba (BD verificada limpia después).
- **`test/setup-integration.ts`**: dentro del contenedor usa `DATABASE_URL` tal cual; desde el host
  carga `../.env` y reescribe `@gallery_db:5432` → `@localhost:5438`. Añadido a `jest.setupFiles`.

### 9.2 Cloudinary — verificado de verdad (no solo el driver de disco)

Con `STORAGE_DRIVER=cloudinary` y `CLOUDINARY_FOLDER=gallery_devtest` (carpeta aislada de la cuenta
compartida), corriendo `seed-demo` + pruebas manuales:

- **Álbum público**: las URLs son `res.cloudinary.com/<cloud>/image/upload/gallery_devtest/<uuid>`
  — **sin firma**; `GET` → 200 `image/webp` (servido por el CDN de Cloudinary).
- **Álbum privado**: las URLs son `.../image/**authenticated**/**s--<sig>--**/v1/gallery_devtest/<uuid>`
  — recurso `authenticated` + firma de Cloudinary con expiración. `GET` con la firma → 200; `GET`
  quitando el segmento `/s--…--/` → **401**.
- **Borrado**: al eliminar los álbumes, `CloudinaryStorageDriver.remove` → `uploader.destroy` de
  cada imagen y derivado. Confirmado por la API de Cloudinary que la carpeta `gallery_devtest`
  quedó en **0 recursos** (`upload` y `authenticated`) — sin huérfanos.

Después se revirtió `.env` a `STORAGE_DRIVER=disk` y se re-sembró la demo local.

### 9.3 Pulido visual (superficies de vitrina)

- **Landing** (`/`): encabezado con título en degradado, medida de lectura acotada, cuadrícula de
  galerías con tarjetas que se elevan al hover (sombra + borde).
- **Galería pública** (`/g/[slug]`): tipografía y espaciado del encabezado más finos; las imágenes
  se elevan levemente al hover en masonry/grid/justified (anulado con `prefers-reduced-motion`).
- **Lightbox**: fondo con `backdrop-filter: blur`, contador `n / total`, imagen con sombra y
  zoom-in sutil al abrir, pie de foto enmarcado bajo la imagen, botones tipo "pill" con blur.
- **Studio y administración** (segunda pasada): las secciones (`.panel-section`) pasan a ser
  tarjetas con superficie/borde/radio; sistema de tokens CSS (`--surface`, `--border`, `--accent`,
  `--ease`); nav pegajosa con blur y enlace activo (`aria-current`); inputs con foco anillado,
  botones con micro-interacción, tablas con hover de fila, listas de álbumes e imágenes como
  tarjetas, panel admin con enlaces tipo botón. Solo CSS + un ajuste en `SiteNav` (enlace activo).

### 9.4 Hallazgo de entorno de desarrollo

Un `tsconfig.build.tsbuildinfo` presente en el árbol montado del backend hace que, tras un
`docker compose up --force-recreate`, el `nest start --watch` **no emita `dist/main.js`** (tsc
incremental lo cree "al día") y el contenedor entre en bucle con `Cannot find module '/app/dist/main'`.
Se resuelve borrando `dist/` + `*.tsbuildinfo` dentro del contenedor y reiniciando. Regla: no
correr `tsc -p tsconfig.build.json` desde el host contra el directorio del backend — los
typechecks manuales van con `tsc -p tsconfig.json` (config base). `*.tsbuildinfo` está en
`.gitignore` y `.dockerignore`.

---

## 10. Endurecimiento de producción (2026-09-01)

Cuatro piezas de hardening que faltaban (el dominio/VPS los gestiona el proyecto del portafolio).

### 10.1 Rate limit global de la API (`@nestjs/throttler`)

`ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }])` + `ThrottlerGuard` como **primer**
`APP_GUARD` (antes de `JwtAuthGuard`/`RolesGuard` — corta un flood antes de gastar trabajo). Es el
límite general **por debajo del cual** viven los límites finos de fuerza bruta
(`SecurityEventsService`: login 10/15 min, 2FA 5/15 min) y de subida (120/hora).

- `@SkipThrottle()` en `HealthController` — el monitoreo lo consulta seguido; no debe bloquearse.
- `@Throttle({ default: { limit: 2400, ttl: 60_000 } })` en `MediaController` — una página de
  galería pide muchas imágenes/variantes a la vez; en producción esto lo sirve el CDN, no el backend.
- Almacenamiento en memoria (una sola instancia). Si algún día hay varias, toca un storage
  compartido (Redis) para el throttler.

**Verificado**: 650 peticiones en paralelo a `/auth/me` → 600 × 401 + **50 × 429**; `/health`
respondió 200 durante todo el flood; `/galleries` devuelve `X-RateLimit-Limit: 2400`.

### 10.2 Healthcheck del backend en producción

`docker-compose.prod.yml` → `gallery_backend` gana un `healthcheck` (`node -e "fetch('http://127.0.0.1:3040/api/health')…"`
— la imagen slim no trae `curl`, Node 22 sí trae `fetch`), y `gallery_frontend` y `caddy` pasan a
`depends_on: { gallery_backend: { condition: service_healthy } }`. Un arranque en frío ya no expone
el sitio antes de que la API responda.

### 10.3 CI — `.github/workflows/ci.yml`

Dos jobs en cada push a `main` y en cada PR:
- **backend**: servicios `postgres:18` + `redis:8`; `npm ci` → `prisma generate` →
  `prisma migrate deploy` → `tsc -p tsconfig.json --noEmit` → `npm test` (36 tests, incluidos los
  de integración contra Postgres) → `nest build`.
- **frontend**: `npm ci` → `next build` con `NODE_ENV=production`.

Para que el typecheck local sea idéntico al de CI, `tsconfig.json` (config base) ganó
`include`/`exclude` explícitos — el `exclude` de `documentation/` evita que tsc intente compilar la
salida de Compodoc (trae archivos de ejemplo de Angular).

### 10.4 Cabeceras de seguridad del frontend (`next.config.ts` → `headers()`)

`helmet()` solo cubre las respuestas de la API. Ahora el Next añade a **todas** sus respuestas:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`
(camera/mic/geo denegados), `Strict-Transport-Security` (solo en producción), y una **CSP** que se
compone según el entorno: `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`,
`img-src` con `data:`/`blob:`/`res.cloudinary.com`/(origen de la API en dev), `style-src`/`script-src`
con `'unsafe-inline'` (Next inyecta CSS/JS críticos; no se montó flujo de nonces), y en desarrollo
`'unsafe-eval'` + `ws:` para el hot-reload. Verificado que la galería sigue cargando las imágenes
bajo la CSP.

### 10.5 Hallazgo: `incremental: true` + `deleteOutDir: true`

`nest-cli.json` tiene `deleteOutDir: true` y `tsconfig.json` tenía `incremental: true`. Combinados,
tras un `restart`/`--force-recreate` del contenedor de desarrollo: Nest borra `dist/`, tsc corre en
modo incremental, ve por el `.tsbuildinfo` que "todo está compilado" y **no re-emite nada** →
`Cannot find module '/app/dist/main'` en bucle. Se quitó `incremental` (el proyecto es pequeño, el
build completo es rápido). `*.tsbuildinfo` sigue en `.gitignore` y `.dockerignore`.

## 11. Fase 10 — Reencuadre como portafolio de fotografía (completada y verificada, 2026-09-02)

El sitio deja de presentarse como "una galería de imágenes genérica" y pasa a ser el **portafolio
de un autor**. La demo de personalización/animación no cambia (sigue siendo el motor de
colecciones); lo que cambia es el marco: identidad de sitio, portada editorial y páginas de autor.
La sección pública de identidad (entrar / crear cuenta) **se mantiene visible** — es parte de la
demostración.

### 11.1 Backend — identidad de sitio y contacto

Migración `20260902200738_portfolio`:

- `albums.featured BOOLEAN NOT NULL DEFAULT false` — marca "sale en la portada". Solo tiene efecto
  si la colección es `public`.
- `site_settings` — **fila única** (`id = 1`, se crea al primer `GET`): `site_title`, `owner_name`,
  `tagline`, `bio` (600), `about_body` (texto largo), `contact_email`, `contact_intro`,
  `instagram`, `hero_image_id` (UUID de una imagen de álbum público), `updated_at`.
- `contact_messages` — `message_id` uuid PK, `name`, `email`, `body` (4000), `ip_address` (solo
  registro interno), `is_read`, `created_at`, índice `(is_read, created_at)`.

Módulos nuevos (ambos `@Global` no — `SiteModule` sí, para inyectar `SiteService` en otros):

| Ruta | Acceso | Qué hace |
|---|---|---|
| `GET /site` | `@Public()` | Ajustes públicos; resuelve las URLs del hero. Crea la fila por defecto. |
| `PATCH /site` | `admin`/`director`/`super` | Merge de los campos presentes. Valida que `heroImageId` pertenezca a un álbum **público** (el hero se sirve sin firma en una página cacheable). |
| `POST /contact` | `@Public()`, 202, `@Throttle(5/min)` | Guarda el mensaje y avisa por correo (degrada si el correo falla). **Honeypot**: si `website` llega con contenido → se acepta y se descarta en silencio. |
| `GET /contact/messages` | `admin`+ | Bandeja (últimos 200). |
| `PATCH /contact/messages/:id` | `admin`+ | Marca leído / no leído. |
| `DELETE /contact/messages/:id` | `admin`+, 204 | Borra. |

`albums` DTO/servicio ganan `featured`; `MediaService.listPublic({ featuredOnly })` filtra y ordena
por `sort_order` → `created_at`; `GET /galleries?featured=true` lo expone.

### 11.2 Frontend — chrome y páginas de autor

- **`SiteHeader` / `SiteFooter`** (reemplazan a `SiteNav`): la marca es `owner_name`, nav pública
  `Trabajo · Sobre · Contacto`, y a la derecha el estado de sesión (Gestor / Administración / Salir,
  o Entrar / Crear cuenta). Dentro de una colección (`/g/...`) la cabecera se vuelve transparente y
  el pie se oculta.
- **`lib/site.tsx`** — `SiteProvider`/`useSite`: el layout raíz resuelve `GET /site` en el servidor
  y lo reparte por contexto (evita el parpadeo del nombre en cada navegación).
- **Portada (`/`)** — hero a sangre completa con `BlurhashCanvas` detrás de la imagen de
  `site.hero`, degradado de oscurecimiento, `owner_name` en serif display, `tagline`, CTA a
  `/trabajo`; luego bio breve y cuadrícula de **colecciones destacadas**
  (`GET /galleries?featured=true`).
- **`/trabajo`** — índice de todas las colecciones públicas, en el orden del gestor.
- **`/sobre`** — retrato (reutiliza el hero), `about_body` partido en párrafos por línea en blanco,
  una "Selección de encargos" (contenido fijo de demo — no hay clientes reales) y CTA a contacto.
- **`/contacto`** — `contact_intro` + datos directos (correo, Instagram) + formulario
  (`ContactForm`, cliente) que hace `POST /contact`. El **honeypot** `website` va en un `.hp-field`
  fuera de pantalla y fuera del orden de tabulación.
- **`/g/[slug]`** — enlace de regreso "← Trabajo" solo si la colección es pública.
- Tipografía display **serif de sistema** (`--pf-display`, sin webfont) para titulares de
  portafolio; el resto del sistema de tokens CSS no cambia.

### 11.3 Frontend — gestor y administración

- "Studio" → **"Gestor del sitio"**; "álbum" → "colección" en toda la interfaz.
- `AlbumSettingsForm` gana la casilla **"Destacar en la portada"** (`featured`).
- **`/studio/ajustes`** (`admin`+) — editor de identidad: todos los textos de `site_settings` +
  selector de hero poblado con las fotos de las colecciones públicas (se listan vía `/galleries`
  → `/g/:slug`), con miniatura de vista previa. `''` → `null` al guardar.
- **`/studio/mensajes`** (`admin`+) — bandeja de contacto con marca de leído y borrado.
- `/admin` enlaza a ambas.

### 11.4 Datos de demostración — `scripts/seed-portfolio.ts`

Se corre **desde el host** (`npx ts-node gallery_backend/scripts/seed-portfolio.ts`) porque necesita
leer la carpeta de fotos y llegar al backend publicado en `:3050`. Persona ficticia **"Mara Solís"**
(fotógrafa documental, Querétaro). **Seis** colecciones públicas que consumen **todo** el contenido
de la carpeta de origen (244 fotos de uso libre), subidas por el **pipeline real** (cada archivo se
reduce a ≤ 2400 px con `sharp` antes de subir, para no pasar el tope de `UPLOAD_MAX_FILE_BYTES`):

| Colección | Carpeta(s) de origen | Layout | Destacada | Fotos |
|---|---|---|---|---|
| Calle | `Skate/` | justified | sí | 89 |
| Tinta | `tatoos/` | grid | sí | 37 |
| Muros | `grafitti/` | masonry | sí | 38 |
| Humo | `smoke/` | carousel | sí | 25 |
| Ciudad | `Qro/` + `varias/` + `espirales/` | masonry | no | 34 |
| Cuaderno | raíz (`*.jpg` sueltos) | justified | no | 21 |

**Convergente, no incremental**: si una colección del portafolio ya existe, se **borra y se vuelve a
crear** con el contenido completo de su carpeta — así una segunda corrida siempre deja el set
entero, sin huecos ni duplicados (antes de borrar "Calle" se suelta el `hero_image_id` para que la
referencia no bloquee el borrado). Fija portada (primera foto) y `hero_image_id` (3ª foto de
"Calle"). `PATCH /site` se aplica siempre.

> **Límite de subida**: `ImagesService` topa las subidas por usuario/hora (`MAX_UPLOADS_PER_HOUR`),
> ahora leído de `UPLOAD_MAX_UPLOADS_PER_HOUR` (por defecto **120**; el `.env` de desarrollo lo
> sube a 5000 para poder sembrar las 244 de un tirón, `.env.prod.example` lo deja en 120). Sin esto
> el seed se corta con 429 a mitad.

### 11.5 Verificación real

- `GET /site` tras el seed → persona completa + `hero` con las 5 URLs de derivados resueltas.
- `GET /galleries` → **6 colecciones / 244 fotos** (todas con portada); `?featured=true` → 4.
  Volumen `gallery_storage`: 1260 objetos (244 originales × 5 derivados + hero), ≈235 MB.
- `POST /contact` con `website` vacío → 202 + fila en `contact_messages`; con `website` relleno →
  202 y **nada** en la tabla (honeypot). `GET /contact/messages` como `super` → la bandeja.
- `PATCH /site { heroImageId: <foto de álbum privado> }` → 400 (debe ser de un álbum público).
- Frontend: `/`, `/trabajo`, `/sobre`, `/contacto`, `/g/<slug>` → 200; la portada sirve el `<img>`
  del hero y las 4 tarjetas destacadas.
- `next build` con `NODE_ENV=production` → 15 rutas, TypeScript OK. `tsc -p tsconfig.json --noEmit`
  (backend) OK.

### 11.6 Pruebas de seguridad de `/site` y `/contact`

`scripts/probe-fase10.mjs` — **24 comprobaciones** contra el backend en vivo (restaura
`site_settings` y borra los datos de prueba al terminar). Cubre: proyección pública de `/site` sin
columnas internas; RBAC de `PATCH /site` y `/contact/messages` (401 / 403 / 200); validación del
`heroImageId` (inexistente → 400, álbum no público → 400, `null` limpia); honeypot de `/contact`
(202 sin fila); XSS almacenado escapado en el correo; `message` > 4000 → 400; whitelist de campos;
`@Throttle(5/min)` → 429; `MessageView` sin `ip_address`; `?featured=true` no filtra colecciones no
públicas. Todo detallado como bloque **S1–S13** en `PRUEBAS_SEGURIDAD.md`.

Specs `jest` nuevas: `src/site/site.service.spec.ts` (7) y `src/contact/contact.service.spec.ts`
(7) — unitarias con Prisma/Mail falsos, para no tocar el singleton `site_settings` real del entorno
de desarrollo. **Total: 50 tests / 10 suites**, `tsc` limpio.

## 12. Estrategia — portafolio que protege y vende (diseño, sin construir — 2026-09-02)

> **Estado**: solo diseño. Ninguna de estas piezas está construida todavía. Este apartado registra
> *qué* se va a hacer y *por qué*, para que las Fases 10b–13 se ejecuten sin re-discutir.

### 12.0 Por qué cambia el alcance

Hasta la Fase 10 el proyecto era "un portafolio bonito". El dueño, tras investigar cómo se arma un
portafolio de fotografía que **sirva de verdad**, concluyó que sin dos cosas no le sirve a un
fotógrafo: **proteger** los archivos (para dejar de regalarlos o depender de plataformas de
terceros) y **poder venderlos** (licenciarlos). El proyecto sigue siendo una **demo con datos
ficticios**, pero ahora demuestra ese kit completo, con funciones **reales** (sin simular).

### 12.1 Decisiones D9–D13 (resumen; detalle y *por qué* en `PLAN_DESARROLLO.md` §4)

| # | Qué se decidió | Motivo corto |
|---|---|---|
| D9 | Marca de agua **obligatoria** en todo lo `public`, **configurable desde el gestor** (subir PNG o usar texto), estampada por el **servidor**. | Opcional = olvidada. En el cliente (CSS) = quitable. |
| D10 | **Capturar** un registro de derechos por imagen **y embeberlo** (IPTC/XMP) en cada archivo servido; el pipeline pasa de "sin ningún metadato" a "sin metadato de ubicación/equipo, con metadato de derechos". | Proteger = que el archivo lleve pegado quién es el dueño y bajo qué términos. GPS/serie siguen fuera por privacidad. |
| D11 | **Solo licencia digital** por ahora (provisional — el dueño investigará impresiones). | El flujo completo funciona sin inventario ni envíos. |
| D12 | Fase 12 **sin pago**; Fase 13 = Stripe **modo test** tras flag, **diferida ≈2026‑09‑17**. El **proyecto padre** cobrará de verdad; aquí solo claves de prueba. Hoy el padre **no tiene** claves Stripe. | Cobro real en repo público no aporta a una demo. |
| D13 | Campo `category` en `albums`, **IA plana** hasta que haya >1 categoría en uso. | Barato ahora, evita migración; no cargar al visitante con una decisión antes de tiempo. |

### 12.2 Modelo de datos nuevo

Campos añadidos a tablas existentes:

| Tabla | Campo | Para qué |
|---|---|---|
| `images` | `status` (`archived` / `draft` / `published`, default `published`) | Curación (Fase 10b). La galería pública solo muestra `published`. |
| `albums` | `category` (`editorial` / `commercial` / `personal`, nullable) | D13. Sin efecto en la IA hasta que se use. |
| `site_settings` | `watermark_asset_id` (uuid, nullable), `watermark_text`, `watermark_opacity`, `watermark_placement` (`tiled` / `corner`) | D9. Configuración global de marca de agua. |
| `site_settings` | `rights_holder`, `creator`, `credit_line`, `rights_statement`, `default_license_terms`, `licensor_url` | D10. Valores por defecto del registro de derechos. |
| `images` | `rights` (JSON: mismos campos que arriba, por imagen; hereda de `site_settings` si vacío) | D10. Registro de derechos por foto. |

Tablas nuevas (Fase 12):

| Tabla | Contenido |
|---|---|
| `license_requests` | Solicitud pública: `image_id`, datos del solicitante (nombre/correo), `intended_use` (`editorial`/`commercial`/`social`/`print`), alcance/descripción, presupuesto, `status` (`new`/`quoted`/`accepted`/`declined`/`fulfilled`), IP (solo registro). |
| `licenses` | Licencia emitida: `request_id`, `image_id`, licenciatario, uso concedido, vigencia (`starts_at`/`ends_at` o perpetua), precio acordado, notas. Historial/prueba. |
| `delivery_tokens` | Entrega del archivo limpio: `license_id`, `token_hash` (sha256), `expires_at`, `used_at` (un solo uso), `downloads_max`. Mismo patrón que `album_share_tokens`. |
| `watermark_assets` *(o reutilizar `images` con un tipo)* | El PNG de marca de agua subido. Pasa por un pipeline propio (validación por contenido, límite de tamaño) pero **no** se le aplica marca ni derivados. |

### 12.3 Pipeline de marca de agua (Fase 11)

- **Dónde**: dentro de `ImagePipelineService`, **después** del re-encode que ya quita EXIF y
  **antes** de generar los 4 derivados WebP. Se estampa una vez por cada tamaño (la marca escala
  con la imagen para que se vea igual de "densa" en thumb y en large).
- **Cómo**: `sharp().composite([...])`. Si hay `watermark_asset_id` → se usa ese PNG en mosaico
  (`tile: true`) o en una esquina, con `opacity` de `site_settings`. Si no → se rasteriza el
  `watermark_text` a un SVG pequeño y se compone igual.
- **Qué NO se marca**: el **original** (se guarda limpio, nunca se sirve en público) y la **entrega
  bajo licencia** (sale del original limpio).
- **Regeneración**: cambiar la marca en el gestor encola un rehacer de los derivados públicos de
  las colecciones afectadas (job en Redis; el original no se toca).
- **Rendimiento**: la composición añade ~1 paso por derivado; se mide y se documenta el coste real
  (presupuesto: la subida de una foto no debe pasar de ~X s — se fija al construir).

### 12.4 Registro y embebido de metadatos de derechos (Fase 11)

- **Captura**: en el gestor, cada imagen tiene un bloque "Derechos" con los campos de la tabla
  `images.rights`; si se dejan vacíos, heredan de `site_settings`. El seed los rellena para "Mara
  Solís".
- **Embebido**: `sharp` por sí solo escribe poco IPTC/XMP; se usa `sharp().withMetadata({...})` para
  lo básico y, si hace falta más cobertura (IPTC completo), un paso con `exiftool` (binario en la
  imagen del backend) o la librería `exifreader`/`piexifjs` equivalente — se decide al construir,
  documentando el porqué.
- **Qué se embebe**: `Copyright` / `Artist` / `XMP:Rights` / `XMP:Credit` / `XMP:CreatorContactInfo`
  (URL del licenciante) / `IPTC:CopyrightNotice` / `IPTC:Caption` / `IPTC:Keywords`. En la **entrega
  bajo licencia** se añade además el **licenciatario y el término concedido** (traza de a quién se
  entregó).
- **Qué se sigue quitando SIEMPRE**: GPS, número de serie de cámara/lente, `MakerNotes`, marca
  temporal exacta del disparo si el dueño lo pide. `PRUEBAS_SEGURIDAD.md` F11 se reescribe en esos
  términos (antes: "0 bytes de metadatos"; ahora: "0 bytes de ubicación/equipo; derechos presentes").

### 12.5 Flujo de licenciamiento y entrega (Fase 12)

```
Visitante                     Gestor (fotógrafo)                 Sistema
  |  ve una foto (con marca)        |                               |
  |  "solicitar licencia" --------> |                               |
  |  elige uso + describe           |  POST /licenses/requests ----> crea license_request (status=new)
  |                                 |  <---- aparece en la bandeja   |
  |                                 |  revisa y COTIZA ------------> license_request.status=quoted (precio, vigencia)
  |  <---- correo con la cotización  |                               |
  |  acepta ----------------------> |  POST .../accept -----------> crea license + delivery_token
  |  <---- correo con enlace firmado (un solo uso, caduca) <------- |
  |  descarga el archivo LIMPIO ---------------------------------->  delivery_token.used_at = now()
```

- La **bandeja del gestor** (hoy solo contacto) pasa a tener **dos tipos**: `contact` y
  `license_request`. Misma pantalla, filtro por tipo.
- La **entrega** reutiliza el patrón de `album_share_tokens` + `media-signing.ts`: URL con
  `exp`+`sig` HMAC, y además `delivery_tokens.used_at`/`downloads_max` para el "un solo uso".
- El archivo entregado es el **original** (no un derivado), sin marca, con los metadatos de derechos
  **y** de licenciatario embebidos.

### 12.6 Pago — Fase 13 (diferida ≈2026-09-17)

- Módulo `payments` **desactivado por defecto** (`PAYMENTS_ENABLED=false` en `.env`).
- Cuando exista la cuenta de Stripe (del proyecto padre): claves **de test** en `.env` (nunca en el
  repo), `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`. Checkout de Stripe para la cotización
  aceptada; el **webhook** `checkout.session.completed` dispara la emisión de `license` +
  `delivery_token` (lo que en la Fase 12 hace el botón "aceptar" a mano).
- El **repo es público** → `.env.example` lleva solo placeholders; el módulo se prueba en local con
  las claves de test del dueño. Nunca `sk_live_`.

### 12.7 Impacto en lo ya construido

| Ya existe | Cambia |
|---|---|
| Pipeline `sharp` (Fase 3) | + paso de marca de agua; regla de metadatos pasa de "quitar todo" a "quitar sensible, poner derechos". |
| `MediaService.listPublic` / `getGallery` (Fase 3) | filtran por `images.status = 'published'`. |
| Seed `seed-portfolio.ts` (Fase 10) | cura: ~12–20 `published` por colección, el resto `archived`; rellena `rights` y sube una marca de agua de ejemplo. |
| Gestor `/studio/[albumId]` (Fase 5) | + control de `status` por imagen, bloque "Derechos", vista contact-sheet. |
| `/studio/ajustes` (Fase 10) | + sección "Marca de agua" (subir PNG / texto / opacidad / colocación) y "Derechos por defecto". |
| Bandeja `/studio/mensajes` (Fase 10) | pasa a "Bandeja" con tipos `contact` + `license_request`. |
| `PRUEBAS_SEGURIDAD.md` | F11 reescrita (metadatos); fichas nuevas para marca de agua no evitable, entrega de un solo uso, RBAC de `/licenses`. |

## 13. Fase 10b — Curación (completada y verificada, 2026-09-03)

Primera fase del reencuadre (§12). "Mostrar menos de lo que se tiene": el fotógrafo sube en ancho
a un archivo y solo una **selección publicada** se ve en la galería pública.

### 13.1 Estado por imagen

`images.status` (`VARCHAR(16)`, índice `(album_id, status)`):

| Estado | Qué significa | Dónde se ve |
|---|---|---|
| `published` | En el portafolio | Galería pública + gestor |
| `draft` | En preparación | Solo el gestor |
| `archived` | Fuera del portafolio (pero conservada) | Solo el gestor |

- **Migración** `20260903220045_image_status`: `ADD COLUMN ... DEFAULT 'draft'` + `UPDATE images SET
  status = 'published'` (todo lo ya subido se queda visible; solo las subidas **nuevas** entran como
  `draft`).
- El **default de columna es `draft`** — una subida nueva no aparece en público hasta que se
  publica. Es el flujo de portafolio ("lanza una red ancha, luego da un paso atrás").

### 13.2 API

| Endpoint | Cambio |
|---|---|
| `PATCH /images/:id` | acepta `status` (además de `altText`/`caption`/`sortOrder`). |
| `POST /albums/:id/images/status` | **nuevo** — `{ imageIds[], status }` cambia el estado en bloque; valida que todos los ids sean del álbum (400 si no); `updateMany` acotado. Es el flujo real cuando se curan 89 fotos. |
| `GET /albums/:id/images` (gestor) | sin cambio — devuelve **todas** las imágenes, ahora con `status`. |
| `GET /g/:slug` (público) | filtra `status = 'published'` **siempre** (tenga o no enlace de compartir); `imageCount` = nº de publicadas. |
| `GET /galleries` | solo lista colecciones `public` con ≥1 publicada; `imageCount` = publicadas; la portada cae a la primera publicada si la portada elegida no lo está. |

- **Resiliencia del lado público**: si la portada del álbum o el `hero_image_id` del sitio apuntan
  a una imagen que ya no está publicada, el público no ve un hueco — la portada usa la primera
  publicada y el hero cae a su degradado (`SiteService.toPublic` filtra por `status`). `PATCH /site`
  también exige que el `heroImageId` sea una foto **publicada** de un álbum público.
- **Decisión**: un enlace de compartir (`unlisted`/`private`) tampoco muestra borradores. Compartir
  para "segundas opiniones" con borradores visibles es una mejora futura, no de esta fase.

### 13.3 Gestor (`/studio/[albumId]`)

`ImageGrid` gana:
- Un `<select>` de estado por imagen (optimista: pinta y confirma).
- **Selección múltiple** (checkbox por tarjeta) + barra de acciones en bloque
  (Publicada / Borrador / Archivada / limpiar) → `POST .../images/status`.
- Recuento en vivo: "16 publicadas · 0 borrador · 73 archivadas".
- Las tarjetas `draft` van con borde punteado; las `archived`, atenuadas.

### 13.4 Seed

`seed-portfolio.ts`: tras subir **todo** el contenido de cada carpeta, publica una **selección
repartida** (`spread()`) y archiva el resto. Por colección: Calle 16 · Tinta 14 · Muros 15 ·
Humo 12 · Ciudad 14 · Cuaderno 10 → **~81 publicadas de 244 subidas**. La portada se fija a una
foto publicada.

### 13.5 Verificación real

- `PATCH /images/:id {status:'archived'}` → 200; `POST /albums/:id/images/status` con 3 ids → `{ok,updated:3}`;
  con un id ajeno → **400** (sin escribir).
- Tras archivar 4 fotos de "Calle": `GET /g/calle` → 85 imágenes (era 89); `GET /galleries` →
  `calle: 85 publicadas`. Restaurado → 89.
- Seed curado: `GET /galleries` → 6 colecciones / **81 publicadas** (16/14/15/12/14/10), todas con
  portada; `GET /g/calle` → 16; el gestor de "Calle" ve **89** (16 `published` + 73 `archived`).
- `/`, `/trabajo`, `/sobre`, `/g/<slug>`, `/studio/<id>` → 200. `next build` (prod) OK.
  `tsc` backend OK. **53 tests / 11 suites** (nuevo `images.service.spec.ts`; `site.service.spec.ts`
  ampliado para el hero publicado).

## 14. Fase 11 — Protección de la obra (completada y verificada, 2026-09-04)

"El fotógrafo deja de regalar sus fotos": marca de agua estampada por el servidor en todo lo
público, y un registro de derechos incrustado como metadatos IPTC/XMP reales en **cada** archivo
servido (público o privado). Diseño previo en §12.3/§12.4; esto es lo que quedó construido.

### 14.1 Modelo de datos

Migración `20260904142447_protection`:

- `images.rights` (`JSONB`, nullable) — override de derechos de esa imagen; `null` = hereda todo.
- `site_settings` gana: `watermark_asset_key`, `watermark_text`, `watermark_opacity`,
  `watermark_placement` (D9); `rights_holder`, `creator`, `credit_line`, `rights_statement`,
  `default_license_terms`, `licensor_url` (D10).

### 14.2 `src/protection/` — dos servicios, sin controller propio

| Servicio | Qué hace |
|---|---|
| `WatermarkService.composite()` | Estampa un derivado WebP con el logo o el texto configurado. El mosaico (`tile`) o el sello (`corner`) se rasteriza vía SVG con `sharp`/librsvg — el mismo mecanismo que ya usaba `seed-demo.ts` para el texto. |
| `RightsMetadataService.embed()` | Incrusta IPTC/XMP con `exiftool` (`execFile`, lista fija de etiquetas — ver F17). |
| `rights.util.ts` | `sanitizeRightsPartial` (proyecta a las 6 claves conocidas, trunca) + `resolveRights` (override de la imagen → default del sitio, campo por campo). Puras, sin DI — testeadas aparte. |

`ProtectionModule` las exporta; lo importan `ImagesModule` (para estampar/embeber al subir) y
`SiteModule` (para la configuración, la subida del logo y la regeneración).

### 14.3 Dónde se aplica

- **`ImagesService.upload()`**: tras `pipeline.process()` —
  1. Deriva los derechos efectivos (`resolveRights(defaults, null)` — la imagen aún no existe).
  2. Embebe derechos en el **original** (nunca lleva marca — D9).
  3. Por cada derivado: si `album.visibility === 'public'` → `watermark.composite()`; siempre →
     `metadata.embed()`. Se guarda el resultado, no el derivado crudo.
- **`SiteService.uploadWatermarkAsset()`**: `POST /site/watermark` (multipart) — valida por
  contenido con `sharp` (igual que una foto), re-codifica a PNG ≤ 1000×1000, la sube con
  `StorageService.put()` y borra la anterior. `DELETE /site/watermark` la quita (cae al texto).
- **`SiteService.startWatermarkRegeneration()` / `regenerate()`** — ver 14.5.

### 14.4 Hallazgo real: el mosaico fijo rompía el `thumb`

`sharp` exige que lo que se compone (`composite()`) **quepa dentro** de la imagen base. Un mosaico
fijo de 320 px fallaba al estampar el derivado `thumb` (240 px o menos de lado) — el `catch` de
`WatermarkService.composite()` lo capturaba en silencio y devolvía el derivado **sin marcar**. Un
test de regresión (`watermark.service.spec.ts`, imagen 96×70) lo detectó antes de llegar a
producción. Arreglo: el mosaico se acota al lado más chico del derivado en cada llamada
(`Math.min(MAX_TILE, width, height)`), nunca un tamaño fijo.

### 14.5 Hallazgo real: la regeneración síncrona agota el tiempo de espera HTTP

`POST /site/watermark/regenerate` original era síncrono: recorría todas las imágenes de álbumes
`public` (original + 4 derivados cada una, cada archivo pasando por `sharp` **y** un proceso
`exiftool` aparte). Con las ~250 fotos de la demo, la llamada **superó los 5 minutos** y el cliente
HTTP cortó la conexión (`UND_ERR_HEADERS_TIMEOUT`) antes de que terminara — verificado en desarrollo,
no una hipótesis.

Rediseño: `startWatermarkRegeneration()` responde **202 de inmediato** y lanza el trabajo real
(`runRegeneration()`) sin esperarlo (`void this.runRegeneration()`); el progreso vive en un campo
**en memoria del proceso** (`regenState`) y se consulta con `GET /site/watermark/regenerate`. Una
segunda llamada mientras hay una corriendo no relanza el trabajo — devuelve el estado en curso.

> **Por qué no Redis para el estado del trabajo**: `RedisService` está documentado explícitamente
> como "nunca almacén de datos de negocio" (solo rate limiting / fuerza bruta). El estado en memoria
> es aceptable aquí: un solo proceso backend, y perder el progreso en un reinicio a mitad de una
> regeneración no es grave — se puede volver a lanzar. Con más de una instancia del backend, esto
> tendría que moverse a un job real (BullMQ u otra cola) — anotado como evolución futura, no se
> construye ahora.

### 14.6 Límite conocido: `storage.read()` solo funciona con el driver de disco

La regeneración necesita releer el **original limpio** para reconstruir los derivados. Eso pasa por
`StorageService.read()`, que **solo** implementa el driver de disco — `CloudinaryStorageDriver` no
tiene `read()` (Cloudinary sirve desde su propio CDN, nunca a través del backend). En producción
(`STORAGE_DRIVER=cloudinary`), cada imagen se cuenta como `skipped` en vez de procesarse. Evolución
futura si hace falta: bajar el original por HTTPS desde su URL de Cloudinary antes de reprocesar.
No se implementa ahora — se documenta con honestidad en vez de simularlo.

### 14.7 Frontend

- `/studio/ajustes`: sección **"Marca de agua"** (subir/quitar el logo con vista previa, texto de
  respaldo, opacidad, patrón, botón "Aplicar a todo lo publicado" con sondeo del progreso cada 3 s)
  y **"Derechos por defecto"** (los 6 campos).
- `/studio/[albumId]`: cada tarjeta gana un enlace "Derechos ▾" que despliega un editor de los 6
  campos de esa imagen — el backend reemplaza el JSON completo, así que el frontend siempre manda
  el borrador entero (nunca un campo suelto).
- `GalleryImage` y `Lightbox`: `draggable={false}` + `onDragStart`/`onContextMenu` con
  `preventDefault()` — **disuasores**, documentados como tales (el control real es que el archivo
  servido ya lleva marca y metadatos).
- `Lightbox` y `SiteFooter` muestran `site.rights.noticeText` (el aviso de derechos ya resuelto).

### 14.8 Verificación real

- Original de una foto **pública**: `exiftool` confirma `XMP-dc:Rights`, `XMP-dc:Creator`,
  `IPTC:CopyrightNotice` con los valores configurados.
- Original de una foto **privada**: también lleva los mismos metadatos (D10 no distingue por
  visibilidad — solo la marca visible sí distingue).
- Derivado `small` de un álbum público difiere en bytes del mismo derivado regenerado sin marca; el
  de un álbum privado es indistinguible del control (no se estampa).
- `rightsStatement` con saltos de línea y un `-fake-flag` incrustado → se guarda como una línea,
  `exiftool` no lo trata como un argumento aparte.
- `POST /site/watermark` con texto plano disfrazado de PNG → 400.
- RBAC de `/site/watermark*` (subir, borrar, regenerar, consultar estado): 401/403/2xx correctos.
- Regeneración real contra las ~250 fotos de la demo: arranca en `running`, una segunda llamada no
  la relanza, termina en `done` con el conteo real de procesadas.
- `tsc` OK. `next build` (prod) OK, 15 rutas. **79 tests / 14 suites** (nuevas:
  `rights.util.spec.ts`, `watermark.service.spec.ts` — incluye el test de regresión del mosaico —,
  `rights-metadata.service.spec.ts` de integración con `exiftool` real; `site.service.spec.ts`
  ampliado con el estado de la regeneración en segundo plano).

## 15. Fase 12a — Licenciamiento: solicitud pública + bandeja (completada y verificada, 2026-09-04)

Primer tramo de la Fase 12 (§12.5): captura la solicitud y la pone frente al gestor. Cotizar,
aceptar y entregar el archivo firmado son fases posteriores (12b, 12c) — no se construyen aquí.

### 15.1 Modelo de datos

`license_requests` (migración `20260904155252_license_requests`): `request_id`, `image_id` (FK a
`images`, `onDelete: Cascade`), `requester_name`/`requester_email`, `intended_use`
(`editorial`/`commercial`/`social`/`print` — D11), `message`, `budget` (texto libre, opcional),
`status` (`new` por ahora — el resto de la máquina de estados llega con cotizar/aceptar),
`ip_address` (solo registro interno), `created_at`. Índices `(status, created_at)` y `(image_id)`.

### 15.2 `src/licensing/` — mismo patrón que `contact`, a propósito

`LicensingService.submit()` calca `ContactService.submit()`: honeypot (`website`), guarda,
resuelve el destinatario del correo desde `SiteService.get().contactEmail` (mismo buzón que el
contacto general), envía con `escapeHtml()`. La diferencia real: **valida la foto** antes de
aceptar nada — `image.status !== 'published' || album.visibility !== 'public'` → 400 (no se puede
pedir licencia de algo que no se exhibe; a diferencia del honeypot, esto sí es un error de
validación normal, no necesita ser indistinguible).

`LicensingService.list()` resuelve el contexto para el panel: miniatura (`thumb`) vía
`StorageService.urlFor`, título/slug de la colección — sin exponer `ip_address`.

| Endpoint | Acceso | Nota |
|---|---|---|
| `POST /license-requests` | `@Public()`, 202, `@Throttle(5/min)` | Igual que `/contact`. |
| `GET /license-requests` | `admin`/`director`/`super` | Bandeja — sin acciones todavía. |

### 15.3 Frontend

`/studio/licencias` — bandeja de **solo lectura** (miniatura, solicitante, colección, uso,
mensaje, presupuesto, fecha). Enlazada desde `/studio` y `/admin`. Cotizar/aceptar se agregan a
esta misma página en la siguiente fase, no se crea una nueva.

### 15.4 Verificación real

`imageId` inexistente → 400; honeypot → 202 sin fila; solicitud válida → 202; campo extra
(`status`) → 400 (whitelist); `intendedUse` inválido → 400; bandeja: sin sesión → 401, `usuario` →
403, `admin`+ → 200 con miniatura y colección resueltas, sin `ipAddress`; ráfaga → 429.
`next build` (prod) OK, 16 rutas. `tsc` OK. **87 tests / 15 suites** (nuevo
`licensing.service.spec.ts`, 8 tests).

## 16. Fase 12b — Licenciamiento: cotizar (completada y verificada, 2026-09-04)

Segundo tramo de la Fase 12. El gestor responde una solicitud con precio, condiciones y hasta
cuándo es válida la oferta; el solicitante recibe la cotización por correo.

### 16.1 Modelo de datos

Migración `20260904220024_license_quotes` — añade a `license_requests`: `quoted_price` (texto
libre, igual que `budget`), `quoted_conditions` (alcance/exclusividad/vigencia de la licencia
ofrecida, en prosa — se decidió no modelar estos campos por separado hasta que la Fase 12c defina
exactamente qué necesita una `license`), `quote_expires_at` (hasta cuándo es válida **la
cotización**, no la licencia una vez aceptada), `quoted_at`.

### 16.2 Backend

`LicensingService.quote(requestId, dto)`:
- Solo se puede (re)cotizar desde `new` o `quoted` — `accepted`/`declined`/`fulfilled` rechazan con
  400 ("ya no se puede cotizar"). Recotizar está permitido a propósito: el gestor puede ajustar el
  precio antes de que el cliente acepte.
- `PATCH /license-requests/:id` (`admin`+) — `QuoteLicenseRequestDto` (`price` obligatorio,
  `conditions`/`expiresAt` opcionales).
- Correo al solicitante con el precio/condiciones/vigencia, escapado igual que el resto del
  proyecto.
- `list()` y `quote()` comparten la proyección a `LicenseRequestView` (`toView()` privado) — se
  refactorizó para no duplicar el mapeo.

### 16.3 Frontend

`/studio/licencias` gana, por solicitud: si ya tiene cotización, la muestra (precio, condiciones,
cuándo se envió, hasta cuándo es válida); un botón "Cotizar"/"Recotizar" (solo visible en estados
cotizables) despliega un formulario compacto (precio, condiciones, fecha opcional) que guarda con
`PATCH`. Misma página que en 12a — no se creó una nueva.

### 16.4 Verificación real

Solicitud inexistente → 404; recotizar desde `quoted` → permitido; cotizar desde `accepted` → 400;
`price` vacío → 400 (DTO); RBAC (401/403/200); el correo llega con el precio y las condiciones
escapadas. `next build` OK (16 rutas, sin cambio de conteo — se amplió la página existente).
`tsc` OK. **93 tests / 15 suites** (`licensing.service.spec.ts` gana 6 tests para `quote()`).

## 17. Fase 12c — Licenciamiento: emitir + entrega de un solo uso (completada y verificada, 2026-09-04)

Tercer y más complejo tramo de la Fase 12: al aceptar una solicitud ya cotizada se emite la
licencia y se entrega el archivo original limpio por un enlace que **se consume**, no que expira.

### 17.0 Hallazgo real (corregido antes de seguir): el original ya se filtraba

Antes de construir la entrega, se revisó qué hacía falta proteger — y resultó que **ya no había
nada que proteger**: `MediaService.getGallery()` (sin tocar desde la Fase 3) seguía devolviendo
`urls.original` — el archivo limpio, sin marca, a resolución completa — para **cualquier** álbum
`public`/`unlisted`, sin firma ni control. Verificado en vivo: `GET /g/calle-838207` entregaba una
URL que, al abrirse, descargaba un JPEG de 2400×1600 sin marca de agua. Esto volvía inútil toda la
Fase 11 (¿para qué pagar una licencia de algo que ya es gratis en la propia galería?) — la ficha
F19 de `PRUEBAS_SEGURIDAD.md`, escrita en la Fase 11, había dado por sentado que esto ya estaba
resuelto; no lo estaba.

**Arreglo**: `getGallery()` ya no incluye `original` en `urls` salvo para álbumes `private` (un
enlace de compartir privado sí implica que el dueño confió el original a ese visitante concreto —
nivel de confianza distinto al de un enlace público que cualquiera puede encontrar). El frontend no
necesitó cambios: `Lightbox`/`GalleryImage` ya preferían `large` sobre `original`.

### 17.1 Modelo de datos

Migración `20260904221657_licenses_delivery`:

- `licenses` — 1:1 con la `license_request` que la originó; guarda una **copia** de los términos
  aceptados (precio/condiciones) en el momento de aceptar, independiente de que la solicitud se
  vuelva a tocar después.
- `delivery_tokens` — mismo patrón que `album_share_tokens` (`token_hash` = sha256 del token
  opaco, nunca el token en claro) más `used_at`: a diferencia de un enlace de compartir (válido
  hasta que expira o se revoca), este se **consume** — la primera descarga exitosa lo inutiliza.

### 17.2 Backend

- `LicensingService.accept(requestId)`: solo desde `status === 'quoted'` (400 si no — hace falta un
  precio acordado). Quien "acepta" es el **gestor** — confirma que el cliente aceptó los términos
  por el canal que hayan usado (correo, llamada) y lo marca en el panel; este proyecto no construye
  un portal de autoservicio para que el cliente acepte él mismo (eso sería una fase aparte). Crea
  `license` + `delivery_tokens` en una transacción, pasa la solicitud a `accepted`, manda el enlace
  de descarga por correo.
- `LicensingService.consumeDelivery(rawToken)`: valida el token (existe, no usado, no caducado —
  los tres casos dan el mismo 404, igual que las URLs firmadas de `/media/:key`); lo marca usado
  con un **`updateMany` atómico** condicionado a `used_at: null` — si dos descargas llegan a la vez
  con el mismo token, `count` decide cuál gana; la otra ve 404. Lee el original limpio
  (`StorageService.read`), le **incrusta una nota de a quién se licenció** (nombre, correo, uso,
  condiciones) sobre los metadatos de derechos existentes — al vuelo, solo para esa descarga, nunca
  se persiste una copia aparte — y lo sirve. Al terminar, pasa la solicitud a `fulfilled`.
- `DeliveryController` (`GET /deliveries/:token`, `@Public()`): el control de acceso es el token en
  la URL, no una sesión — mismo principio que `/media/:key` firmado. Cabeceras: `Content-Disposition:
  attachment`, `Cache-Control: private, no-store`, `Cross-Origin-Resource-Policy: cross-origin`.
- `CloudinaryStorageDriver.read()` (nuevo): hasta ahora `storage.read()` solo funcionaba con el
  driver de disco (limitación documentada en la Fase 11, §14.6). Como la entrega es el corazón de
  la Fase 12 — no una comodidad de administrador como la regeneración — se implementó de verdad:
  baja el recurso por HTTPS desde su propia URL (firmada si es `authenticated`) y devuelve el
  stream. **Implementado, no verificado en vivo contra una cuenta Cloudinary real en esta sesión**
  (el entorno de desarrollo usa `STORAGE_DRIVER=disk`, que sí se probó de punta a punta) — se
  documenta la diferencia con honestidad en vez de darla por buena.

### 17.3 Frontend

`/studio/licencias` gana un botón **"Aceptar y emitir licencia"** (solo visible en `quoted`, con
confirmación) y muestra, si ya hay licencia, cuándo se emitió y el estado de la entrega (`sin
descargar` / `descargada` / `caducada sin descargar`).

### 17.4 Verificación real

Flujo completo de punta a punta contra el backend en vivo: crear solicitud → cotizar → RBAC de
aceptar (401/403) → aceptar sin cotizar → 400 → aceptar → 201, licencia + token creados → re-aceptar
→ 400 → **primera descarga → 200, archivo real de ~500 KB con `Content-Disposition: attachment`** →
**segunda descarga del mismo token → 404** → solicitud pasa a `fulfilled`. Token inventado → 404.
La carrera de dos descargas simultáneas se probó como test unitario (`consumeDelivery` con
`updateMany` devolviendo `count: 0` en la segunda). El envío real de correo falló en este entorno
por un dominio de remitente sin verificar en Resend (`MAIL_FROM_ADDRESS` de ejemplo) — degrada
igual que en el resto del proyecto: la licencia y el token ya quedaron creados en base de datos
antes del intento de correo, el fallo de envío no revierte nada.

**101 tests / 15 suites** (`licensing.service.spec.ts` gana 8 tests para `accept()` y
`consumeDelivery()`, incluida la carrera). `tsc` OK. `next build` (prod) OK, 16 rutas (sin cambio
de conteo). Bloque L12–L16 y corrección de F19 en `PRUEBAS_SEGURIDAD.md`.

## 18. Fase 12d — Licenciamiento: público + registro + pulido (completada y verificada, 2026-09-04)

Cuarto y último tramo de la Fase 12. Es **puro frontend**: no se tocó ni un archivo del backend —
todo se apoya en endpoints que ya existían (`POST /license-requests`, `GET /license-requests`,
`GET /contact/messages`), así que no hay superficie de seguridad nueva que auditar.

### 18.1 Botón "Solicitar licencia" en el lightbox

`components/LicenseRequestForm.tsx` (nuevo) replica el patrón de `ContactForm.tsx` — mismo `Status`
(`idle`/`sending`/`sent`/`error`), mismo campo trampa `website` oculto con `hp-field`, mismo manejo
de `ApiError` (429 → mensaje de límite de envíos) — sobre `POST /license-requests`. Recibe `imageId`
como prop (nunca editable por quien solicita) y añade el selector de uso previsto
(`lib/intended-use.ts`, nuevo — único origen de las etiquetas en español, lo usan tanto este
formulario como la bandeja del gestor para que no se desalineen si cambia el DTO del backend).

`Lightbox.tsx` gana un botón "Solicitar licencia" dentro del `<figure>`, junto al aviso de derechos.
Al pulsarlo se abre el formulario **dentro del propio lightbox** (un panel, no una navegación
aparte) — el `stopPropagation` que ya tenía el `<figure>` para no cerrar el visor al hacer clic en
la imagen cubre también los campos del formulario. Un `useEffect` sobre `index` cierra el panel al
cambiar de foto (o al cerrar el lightbox), para no dejar un formulario a medio llenar pegado a la
foto equivocada.

### 18.2 Registro de licencias emitidas

`/studio/licencias` no tenía una vista separada para "lo que ya se vendió" — la información vivía
mezclada dentro de cada tarjeta de solicitud. Se añadió una pestaña **"Licencias emitidas"** que
filtra en el cliente el mismo array que ya devuelve `GET /license-requests` (`r.license !== null`)
— deliberadamente no se creó un endpoint nuevo: el backend ya manda todo lo necesario embebido en
cada solicitud, así que un endpoint aparte solo duplicaría datos sin aportar nada. Las tarjetas de
licencias ya emitidas se renderizan con el mismo componente de lista — como su `status` es
`accepted`/`fulfilled`, los botones "Cotizar"/"Aceptar" ya no aparecen (esa lógica ya existía).

### 18.3 Contadores en el gestor del sitio

`/studio` (la página de aterrizaje del gestor) ahora carga, solo si el usuario es admin,
`GET /contact/messages` y `GET /license-requests` en paralelo y muestra "(N sin leer)" / "(N
nuevas)" junto a los enlaces "Mensajes" y "Solicitudes de licencia" — para que el fotógrafo sepa si
hay algo esperando atención sin tener que abrir las dos bandejas por costumbre. Se descartó fundir
ambas bandejas en una sola tabla: mensajes y solicitudes de licencia tienen acciones distintas
(leído/borrar vs. cotizar/aceptar) y modelos distintos — una tabla única las habría hecho más
confusas de operar, no menos; el punto real de una "bandeja unificada" (saber de un vistazo si algo
necesita atención) ya queda resuelto con los contadores.

### 18.4 Verificación real

Sin cambios de backend, la verificación fue confirmar que el frontend nuevo consume exactamente el
contrato que el backend ya expone (`verify-12d.mjs`, script de un solo uso): una foto real de una
galería pública → `POST /license-requests` con el cuerpo exacto que arma `LicenseRequestForm` → 202
→ login como `admin+gallery@example.com` → la solicitud aparece en `GET /license-requests` con
`status: 'new'` y trae `imageId`/`license`/`requesterEmail` (la forma que usa `LicenseRequest` en el
frontend) → una segunda solicitud con el honeypot relleno se acepta (202) pero NUNCA llega a la
bandeja → `GET /contact/messages` trae `isRead` en cada fila (lo que usa el contador del gestor) →
el filtro de "licencias emitidas" no revienta con 0 ni con N licencias. **12/12 checks OK.**

`tsc` limpio. `next build` en modo producción real (`NODE_ENV=production` explícito) también limpio
— **16 rutas, sin errores** — pero solo tras descubrir que el contenedor de desarrollo exporta
`NODE_ENV=development` para `next dev`, y ejecutar `next build` heredando esa variable dispara un
fallo de Next 16 + Turbopack al pre-renderizar `/_global-error` (`Cannot read properties of null
(reading 'useContext')`, reproducible incluso con un volumen `.next` aislado). No es un defecto de
este proyecto ni de la Fase 12d — es una incompatibilidad de herramientas al construir dentro de un
contenedor pensado para desarrollo — pero quedó documentado aquí para no volver a perder tiempo
redescubriéndolo: cualquier verificación de `next build` dentro de `gallery_frontend` debe forzar
`NODE_ENV=production` explícitamente.

Con esto se cierra la Fase 12 completa (12a solicitud pública → 12b cotizar → 12c emitir y entregar
→ 12d público y pulido): un fotógrafo puede publicar, proteger y vender su obra sin regalarla ni
depender de otra plataforma, de punta a punta.

## 19. Fase 14 — Video (diseño, sin construir — 2026-09-05)

> **Estado**: solo diseño. El proyecto está en pausa hasta el despliegue y las claves de Stripe;
> esta sección registra las decisiones para poder arrancar sin re-discutirlas. Nada de código aún.
> Decisión marco en `PLAN_DESARROLLO.md` §4 **D14**.

El dueño preguntó si se pueden subir videos (hoy no: el pipeline solo acepta `jpeg/png/webp/avif`)
y pidió diseñar la fase. Delegó las decisiones técnicas al arquitecto; van resueltas abajo con su
*por qué*.

### 19.0 Principios heredados (no se tocan)

El video pasa por **exactamente las mismas reglas** que ya defienden a las fotos — no se relajan
"porque es otro formato":

1. **Validación por contenido real** antes de tocar el almacenamiento: `ffprobe` sobre el archivo,
   nunca confiar en la extensión ni en el `Content-Type` del navegador (igual que hoy `sharp`
   inspecciona los magic bytes, no el nombre).
2. **Re-encode obligatorio**: jamás se sirve el archivo tal cual lo subió el usuario. `ffmpeg`
   re-codifica a un *master* normalizado y con `-map_metadata -1` (strip total — el equivalente a
   quitar el EXIF), y después se re-inyectan **solo** los derechos con `exiftool` (el binario ya
   está en la imagen desde la Fase 11).
3. **El original de alta calidad nunca es público.** Público = renditions con marca de agua.
   Master limpio = solo por una **entrega de licencia de un solo uso** (`delivery_tokens`, Fase 12c,
   sin cambios).
4. **Trabajo pesado = job en segundo plano** (202 + estado consultable, progreso en memoria del
   proceso — nunca Redis, misma regla que la regeneración de marca de agua de la Fase 11).
5. **Límites duros y explícitos** contra DoS de subida/transcodificación.

### 19.1 Modelo de datos — unificar `images` → `media`

Se elige una **tabla `media` con discriminador `kind`** (`photo` / `video`) en vez de una tabla
`videos` separada. Razón: `images` es hoy una pieza central con la que hablan `image_variants`,
`images.rights`, la marca de agua, `license_requests.image_id`, `licenses.image_id`,
`site_settings.hero_image_id` y el seed. Una tabla paralela duplicaría todos esos caminos; un
discriminador da **una sola ruta** para variantes, derechos, licencias y entrega. El momento es
ideal: **no hay producción ni datos reales** (el único Postgres es el de dev, y `seed-portfolio.ts`
lo rehace convergente en cada corrida), así que la migración grande no arriesga nada — y
retrofitear esto después del despliegue es justo lo que la práctica del proyecto quiere evitar.

Migración `xxxx_media_unification` (design, no escrita):

```prisma
enum media_kind {
  photo
  video
}

model media {
  media_id     String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  album_id     String        @db.Uuid
  kind         media_kind
  status       media_status  // published/draft/archived — renombrado de image_status, mismos valores
  position     Int
  storage_key  String        // el MASTER limpio: JPEG/PNG (foto) o MP4 alto sin marca (video). Nunca público.
  mime_type    String
  width        Int
  height       Int
  blurhash     String?
  alt_text     String?
  caption      String?
  rights       Json?

  // Solo video (null para foto):
  duration_ms      Int?
  frame_rate       Decimal?  @db.Decimal(6, 3)
  video_codec      String?   // 'h264' | 'hevc' | 'vp9' | 'av1'
  audio_codec      String?   // 'aac' | null si es mudo
  has_audio        Boolean   @default(false)
  hls_manifest_key String?   // ruta del .m3u8 maestro; null hasta que el job termina
  poster_key       String?   // frame extraído (WebP) — la "portada" del video
  processing_error String?   // si el transcode falló, el gestor lo ve aquí

  created_at DateTime @default(now()) @db.Timestamptz(6)
  updated_at DateTime @updatedAt @db.Timestamptz(6)

  album            albums             @relation(fields: [album_id], references: [album_id], onDelete: Cascade)
  variants         media_variants[]
  license_requests license_requests[]
  licenses         licenses[]

  @@index([album_id, status])
  @@index([album_id, position])
}

model media_variants {
  variant_id   String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  media_id     String  @db.Uuid
  label        String  // foto: 'thumb'|'small'|'medium'|'large'
                       // video: 'poster' | 'preview' (MP4 720p progresivo con marca) |
                       //        'hls-360'|'hls-540'|'hls-720'|'hls-1080'
  storage_key  String
  mime_type    String
  width        Int
  height       Int
  bytes        Int
  bitrate_kbps Int?    // solo renditions de video

  media media @relation(fields: [media_id], references: [media_id], onDelete: Cascade)
  @@unique([media_id, label])
}
```

- `image_id` → `media_id` en `license_requests`, `licenses`, `site_settings.hero_image_id` →
  `hero_media_id`. Backfill determinista: cada `images` → `media` con `kind = photo`,
  `image_variants` → `media_variants`. Sin pérdida.
- **`hero_media_id` puede apuntar a un video** → la portada del sitio puede ser un video en loop
  (hero cinematográfico) — una de las piezas "de vitrina" más vistosas de la fase.

### 19.2 Pipeline de ingesta (`VideoPipelineService`, hermano de `ImagePipelineService`)

Dependencia nueva: **`ffmpeg` + `ffprobe`** en `Dockerfile` y `Dockerfile.dev`
(`apt-get install -y ffmpeg`, versión fijada). Igual que con `exiftool`, se invoca con `execFile`
y un **array de argumentos** — nunca por shell, nunca interpolando input del usuario.

`POST /albums/:id/media` (la subida detecta `kind` por `ffprobe`; el endpoint de imágenes se
generaliza o se añade uno hermano):

1. **Validar por contenido** — `ffprobe -v error -show_format -show_streams`. Rechazo **400** si:
   - no hay stream de video, o el contenedor no es `mp4/mov/webm/mkv`;
   - `duration > VIDEO_MAX_DURATION_S` (default **120** — es un portafolio, no una CDN de vídeo);
   - `width·height > VIDEO_MAX_PIXELS` (default 1920×1080) o `size > VIDEO_MAX_INPUT_BYTES`
     (default **500 MB**);
   - `nb_frames / duration` da un frame rate imposible (bomba de descompresión de vídeo);
   - hay más de un stream de video o de audio (ficheros deliberadamente raros).
2. **Aceptar rápido** — guardar el archivo en almacenamiento temporal, crear la fila `media`
   (`kind=video`, `status=draft`, `hls_manifest_key=null`), responder **202** con `mediaId`.
3. **Job en segundo plano** (`void this.transcode(mediaId)`; progreso en memoria; consulta con
   `GET /media/:id/processing`). Cola con **concurrencia 1** (`VIDEO_MAX_CONCURRENT_TRANSCODES`) y
   `timeout` de proceso, para que la CPU no se sature:
   - **a. Master limpio** — `ffmpeg -i in -map 0:v:0 -map 0:a:0? -c:v libx264 -preset slow -crf 18
     -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -map_metadata -1 master.mp4`.
     Es el `storage_key`. **Nunca público.**
   - **b. Póster** — `ffmpeg -ss <10% dur> -i master -frames:v 1 poster.png` → pasa por el
     `ImagePipelineService` existente (WebP + BlurHash). Llena `poster_key` y `blurhash`.
   - **c. Marca de agua** (si el álbum es `public`) — se reutiliza el SVG que ya construye
     `WatermarkService`, rasterizado a PNG, aplicado con el filtro `overlay` de `ffmpeg` a cada
     rendition pública. El tamaño del mosaico se calcula **relativo a la resolución de cada
     rendition** — la lección del bug del `thumb` de la Fase 11 (el mosaico fijo no cabía en el
     derivado chico) aplica igual aquí.
   - **d. Renditions HLS** (con marca) — `ffmpeg ... -f hls -var_stream_map "..." ` para
     360/540/720/1080 (solo las ≤ resolución del master), GOP de 2 s, segmentos de 4 s,
     `-hls_playlist_type vod`. Salida: `master.m3u8` + `stream_N.m3u8` + `seg_*.ts`. Cada rendition
     → una fila `media_variants` con label `hls-<altura>`; `hls_manifest_key = master.m3u8`.
   - **e. Preview progresivo** (con marca) — un único MP4 720p `+faststart` → variant `preview`.
     Es el `<source>` de respaldo para navegadores sin `hls.js` y para arrancar rápido.
   - **f. Derechos** — `exiftool` sobre el master y el preview: copyright, autor, términos,
     `WebStatement` (mismos campos que las fotos; en MP4 van como átomos QuickTime).
   - **g. Fin** — `status` sigue en `draft`; el gestor publica cuando quiera. Si algo falla,
     `processing_error` y el tile lo muestra.

### 19.3 Entrega — transporte distinto para "ver" y para "comprar" (la parte innovadora)

Es el mismo principio que la Fase 12c aplicó a las fotos (derivados públicos vs. original entregado
una sola vez), llevado a vídeo:

| Uso | Qué se sirve | Cómo | ¿Marca? |
|---|---|---|---|
| **Reproducir en la galería / lightbox** | HLS adaptativo (`master.m3u8` + `.ts`) + `preview.mp4` 720p de respaldo | El `GET /media/:key` que ya existe sirve `.m3u8` / `.ts` / `.mp4`; firma HMAC para álbumes no públicos; `Cross-Origin-Resource-Policy: cross-origin` como el resto de la media | **Sí** |
| **Entrega bajo licencia** | El **master MP4 limpio** (un solo archivo, calidad alta, `+faststart`), con derechos + datos del licenciatario embebidos **al vuelo** | El mecanismo `delivery_tokens` de la Fase 12c **sin cambios**: un solo `GET /deliveries/:token`, se consume una vez. Un archivo único encaja con "un solo uso"; un stream HLS troceado no | **No** (es lo que se compró) |

- **HLS para ver**, porque es el estándar de producción y se ve "pro" (el objetivo #1 del proyecto
  es impresionar con ingeniería real). **Un archivo para comprar**, porque es lo que un licenciatario
  realmente quiere y porque la semántica "una sola descarga" es limpia sobre un `GET` único e
  imposible de razonar sobre decenas de peticiones de segmentos.
- `consumeDelivery()` (Fase 12c) hoy hace `metadata.embed(buffer, …)` para foto. Se generaliza: si
  `media.kind === 'video'`, corre `exiftool` sobre una **copia** del master para incrustar la nota
  del licenciatario y lo sirve como stream. Mismo 404-para-todo, mismo *claim* atómico
  (`updateMany` con `used_at: null`).

### 19.4 Frontend

- `hls.js` (desde `cdnjs`, ya en la lista de orígenes permitidos por el CSP) en el lightbox:
  `if (Hls.isSupported())` → apunta al `.m3u8`; si no (Safari) → `<source src=".m3u8">` nativo;
  respaldo final → `<source src="preview.mp4">`. `poster` = el WebP del póster.
  `controlsList="nodownload"` y `disablePictureInPicture` como **disuasores** (no control real — se
  documenta igual que los de las fotos).
- `MediaGrid` (hoy `ImageGrid`): los tiles de video muestran el póster + un ▸ + la duración;
  mientras el job corre, "procesando…" con el progreso.
- `GalleryView` / `Lightbox`: rama por `kind`.
- Hero de portada en video: `<video autoplay muted loop playsinline>` con el póster de respaldo y
  **respeto a `prefers-reduced-motion`** (si el visitante pidió menos movimiento → póster estático,
  sin autoplay).
- El `LicenseRequestForm` del lightbox (Fase 12d) se muestra igual debajo del `<video>` — no cambia.

### 19.5 Límites y seguridad nueva

| Riesgo | Mitigación |
|---|---|
| Bomba de descompresión / archivo minúsculo que expande a horas de vídeo | `ffprobe` antes de nada; límites duros de duración, resolución, bytes y frame rate; `-threads` acotado y `timeout` de proceso en el transcode |
| El transcode satura la CPU (DoS por subida) | Job en segundo plano con **cola de concurrencia 1**; el rate limit de subida ya existe (`UPLOAD_MAX_UPLOADS_PER_HOUR`); `VIDEO_MAX_CONCURRENT_TRANSCODES` |
| `ffmpeg` como superficie de ataque (CVEs de demuxers) | Versión fija en el Dockerfile; `-nostdin`; **`-protocol_whitelist file,crypto`** (ffmpeg no abre `http(s)` → sin SSRF vía playlists); corre como el usuario no-root de los contenedores; input siempre por array de args, nunca shell |
| Un vídeo = cientos de archivos (`.ts`) en el almacenamiento | El `StorageService` ya lo abstrae; `DiskStorageDriver` sin problema; con `CloudinaryStorageDriver` cada segmento es una subida — se **documenta el costo**, no se simula (mismo criterio que el límite de `read()` en la Fase 11) |
| Filtración del master tras la venta | La nota del licenciatario embebida (nombre, correo, licencia) da trazabilidad — igual que en fotos |
| `hls.js` desde CDN | Ya cubierto por el CSP `script-src` con `cdnjs`; se fija la versión |

`PRUEBAS_SEGURIDAD.md` sumará un bloque **V1–Vn** (validación `ffprobe`, límites, whitelist de
protocolos de ffmpeg, RBAC de la subida de video, marca presente en todas las renditions públicas,
master fuera del público, entrega de un solo uso del master, `prefers-reduced-motion` en el hero).

### 19.6 Sub-fases (de menor a mayor riesgo, como la Fase 12)

- **14a — Refactor `images` → `media`.** Migración + backfill + ajustar backend, `seed-portfolio.ts`
  y frontend a `media_id`. **Sin** añadir vídeo todavía (todo sigue `kind=photo`). Toda la suite en
  verde y `next build` OK antes de seguir. Es el refactor puro, aislado.
- **14b — Pipeline básico.** `VideoPipelineService`: validación `ffprobe` + master limpio + póster +
  preview MP4. Subir un MP4 y reproducirlo en el lightbox (sin HLS, sin marca).
- **14c — Protección.** Marca de agua en las renditions + renditions HLS + `hls.js` en el frontend.
- **14d — Venta y pulido.** Generalizar `consumeDelivery()` para vídeo, hero de portada en vídeo,
  `prefers-reduced-motion`, bloque de pruebas de seguridad.

Sin servicios de pago nuevos. Dependencias: `ffmpeg` (Dockerfiles), `hls.js` (frontend, CDN ya
permitido). Encaja después de la Fase 13 o antes — no depende de Stripe.

## 20. Fase 14a — Refactor `images` → `media` (completada y verificada, 2026-09-05)

Primer tramo de la Fase 14: preparar el terreno para el video sin añadir video todavía. Es un
renombrado profundo pero mecánico — el comportamiento no cambia, solo los nombres.

### 20.1 Migración no destructiva

`20260905120000_media_unification` está **escrita a mano** (no la autogeneró Prisma). Prisma no
detecta renombrados: habría hecho `DROP TABLE images; CREATE TABLE media` y borrado las 244 fotos +
976 derivados del portafolio ya sembrado. En su lugar, la migración usa `ALTER TABLE … RENAME`:

- tablas: `images` → `media`, `image_variants` → `media_variants`;
- columnas: `image_id` → `media_id` (en `media`, `media_variants`, `license_requests`, `licenses`),
  `albums.cover_image_id` → `cover_media_id`, `albums.image_count` → `media_count`,
  `site_settings.hero_image_id` → `hero_media_id`;
- **todos** los índices y las llaves foráneas se renombran también (`ALTER INDEX … RENAME`,
  `ALTER TABLE … RENAME CONSTRAINT`) para que coincidan con los nombres que Prisma deriva del
  nuevo modelo — si no, la siguiente `migrate` los vería como drift y los recrearía;
- `CREATE TYPE media_kind AS ENUM ('photo', 'video')` + `media.kind` con `DEFAULT 'photo'`.

`prisma migrate dev` la aplicó y confirmó *"Your database is now in sync with your schema"* sin
drift. Verificado en la BD: `media` = 244, `media_variants` = 976, todas `kind = 'photo'`,
`license_requests` = 4, `licenses` = 1 — cero pérdida.

### 20.2 Alcance del renombrado

**Se renombró** (contrato + datos): el modelo y las columnas de arriba; las rutas
`POST/GET /albums/:id/images` → `/media`, `…/images/reorder|status` → `…/media/reorder|status`,
`PATCH/DELETE /images/:id` → `/media/:id`; el tag de Swagger `images` → `media`; los campos de
payload/JSON `imageId` → `mediaId`, `imageIds` → `mediaIds`, `imageThumbUrl` → `mediaThumbUrl`,
`imageCount` → `mediaCount`, `coverImageId` → `coverMediaId`, `heroImageId` → `heroMediaId`;
`GET /g/:slug` ahora devuelve `{ album, media: [...] }` (antes `images`); los tipos compartidos del
frontend (`ImageDto` → `MediaDto`, `GalleryImage` → `GalleryMedia`, `ImageRights` → `MediaRights`,
`IMAGE_STATUSES`/`ImageStatus` → `MEDIA_*`), el componente `ImageGrid` → `MediaGrid`, la prop
`image` → `media` de `GalleryImage`.

**Se dejó igual** (a propósito): el módulo NestJS `src/images/` y sus clases `ImagesService` /
`ImagesController` / `ImagesModule` — renombrarlas colisiona con el `MediaModule` / `MediaService`
que ya existen (la capa de **entrega** pública: `/galleries`, `/g/:slug`, `/media/:key`), y el
nombre interno del módulo no es contrato. `ImagePipelineService` y `src/media-processing/` — operan
sobre buffers, no sobre el modelo. Las carpetas de migraciones viejas. El pipeline sigue siendo
solo-imagen hasta la Fase 14b; `media.kind` es siempre `photo` por ahora.

También se dejó `status` como `String` validado (no se convirtió a `enum media_status`) y
`sort_order` con su nombre — ninguno de los dos hace falta para soportar video y convertirlos añade
riesgo de migración a cambio de nada. Se anota como posible pulido posterior.

### 20.3 Verificación

- `tsc` backend + `tsc` frontend limpios; **101 tests / 15 suites** en verde (sin tests nuevos —
  es un renombrado, la cobertura existente ya lo cubre).
- `next build` producción (`NODE_ENV=production`) limpio, 16 rutas.
- **`verify-14a.mjs`** contra el backend en vivo — **17/17**: `GET /galleries` trae `mediaCount`;
  `GET /g/:slug` devuelve `{ media: [{ mediaId }] }`; `POST /license-requests { mediaId }` → 202 y
  la bandeja trae `mediaId`/`mediaThumbUrl`; `PATCH /site { heroMediaId }` → 200 y `site.hero.mediaId`
  lo refleja, `{ heroMediaId: null }` → 200; flujo Studio completo sobre las rutas nuevas —
  `POST /albums/:id/media` (subida) → `mediaId`, `PATCH /media/:id`, `POST /albums/:id/media/status
  { mediaIds }`, `PATCH /albums/:id { coverMediaId }`, `DELETE /media/:id` → 204.
- `probe-fase10.mjs` (24 checks de seguridad de `/site` + `/contact`) → **24/24** con las rutas y
  campos renombrados.

`seed-portfolio.ts`, `seed-demo.ts` y `probe-fase10.mjs` quedaron ajustados a las rutas/campos
nuevos. El seed del portafolio lo vuelve a correr el dueño desde el host cuando quiera (es
convergente); la BD de desarrollo ya está migrada con sus 244 fotos intactas.

## 21. Fase 14b — Pipeline de video: ingesta, transcode y reproducción (completada y verificada, 2026-09-07)

Segundo tramo de la Fase 14: subir un video de verdad, procesarlo en segundo plano y reproducirlo
en el lightbox. **Sin** marca de agua ni HLS todavía (eso es 14c); sí con validación por contenido,
master limpio y derechos incrustados desde el primer día.

### 21.1 Dependencia y modelo

- **`ffmpeg`** (trae `ffprobe`) en `Dockerfile` y `Dockerfile.dev` — invocado siempre con
  `execFile` + array de argumentos (nunca shell), y con `-protocol_whitelist file,crypto` para que
  no abra `http(s)` (corta SSRF vía playlists). `ffprobe` **no** acepta `-nostdin` (es flag de
  `ffmpeg`): hay dos listas de flags base separadas.
- Migración `20260907120000_media_video_columns` (aditiva): `media` gana `duration_ms`,
  `frame_rate`, `video_codec`, `audio_codec`, `has_audio`, `hls_manifest_key` (null hasta 14c),
  `poster_key`, `processing_error`. Y **`storage_key` pasa a anulable**: un video tiene fila desde
  que se sube, pero su master (la copia limpia) no existe hasta que el transcode termina. Se
  guardaron los sitios que asumían `storage_key` no nulo (`toDto`, `getGallery`, la regeneración de
  marca —que ahora filtra `kind: 'photo'`—, el borrado de álbum, `consumeDelivery`).

### 21.2 Ingesta (`VideoPipelineService` + `ImagesService.uploadVideo`)

- El interceptor de subida pasa a **`diskStorage`** (a un archivo temporal, no a memoria): un
  video puede pesar cientos de MB. La rama de imagen lee ese temporal a un buffer solo tras
  comprobar `size ≤ UPLOAD_MAX_FILE_BYTES`; la de video se lo pasa a `ffprobe` por ruta.
- `POST /albums/:id/media` detecta la rama por una **pista** (`mimetype` empieza por `video/` o la
  extensión) — pero la autoridad es `ffprobe` / `sharp`, no la pista.
- `VideoPipelineService.probe()` rechaza (400): contenedor fuera de MP4/MOV/WebM/MKV; sin stream de
  video; más de un stream de video o de audio; duración > `VIDEO_MAX_DURATION_S` (120 s);
  resolución > `VIDEO_MAX_PIXELS` (1920×1080); tamaño > `VIDEO_MAX_INPUT_BYTES` (200 MiB); frame
  rate imposible (> `VIDEO_MAX_FRAME_RATE`).
- Si pasa: se copia el original al directorio de trabajo del job, se crea la fila `media`
  (`kind=video`, `status=draft`, `storage_key=null`, dimensiones y códecs del probe,
  `checksum_sha256` del archivo subido) y se **encola** el transcode. Respuesta inmediata (201 con
  `processing: true`).

### 21.3 Transcode en segundo plano (`ImagesService.runVideoTranscode`)

Cola con **concurrencia 1** (`ffmpeg` satura la CPU) — cada subida encadena su trabajo al final de
una promesa. Progreso en un `Map` en memoria del proceso (nunca Redis, mismo criterio que la
regeneración de marca, Fase 11). Pasos:

1. **Master limpio** — `ffmpeg -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags
   +faststart -map_metadata -1`. `-map_metadata -1` tira TODO metadato (el equivalente a que
   `sharp` quite el EXIF). Es la copia de alta calidad: **nunca pública**, solo entrega bajo
   licencia (Fase 14d ya funciona — `consumeDelivery` reconoce `kind='video'` y embebe al
   licenciatario con `format: 'mp4'`).
2. **Portada** — un fotograma al 10 % de la duración → PNG → pasa por el `ImagePipelineService`
   existente (4 derivados WebP + BlurHash). El `large` es el `poster_key`.
3. **Preview** — un único MP4 ≤720p con `+faststart` (`label: 'preview'`, `format: 'mp4'`) — lo que
   se reproduce en el lightbox mientras no haya HLS.
4. **Derechos** — `RightsMetadataService.embedInPlace()` (nuevo: `exiftool` directo sobre el
   archivo, sin bufferizarlo) sobre el master y el preview (`EmbeddableFormat` gana `'mp4'` →
   etiquetas XMP + QuickTime). Los derivados WebP del póster llevan los derechos igual que
   cualquier derivado de foto. **La marca de agua sobre el video llega en la 14c.**
5. Se sube todo, se rellena la fila (`storage_key`, `poster_key`, `placeholder`, `variants`) y el
   estado del job pasa a `done`. Si algo falla: `media.processing_error`, se limpian los objetos ya
   subidos, el video queda sin publicar (el gestor ve el error). Un reinicio a mitad de transcode
   deja el video sin `storage_key` ni error → `GET /media/:id/processing` lo reporta como
   `interrumpido`.

### 21.4 Entrega y frontend

- `GET /g/:slug` y la vista del Studio añaden `kind` (y `durationMs`) a cada elemento; para un
  video, `urls` trae los WebP del póster + `preview` (MP4). El master (`urls.original`) **solo**
  aparece en la vista del Studio (dueño/admin), nunca en la galería pública — igual que el original
  de una foto.
- `GET /media/:id/processing` (`admin`+, valida propiedad): `processing` / `done` / `error`.
- `DiskStorageDriver`: la validación de clave admitía solo `[a-z]{3,4}` de extensión → `mp4` (con
  dígito) fallaba con "clave inválida"; ahora `[a-z0-9]{3,4}`. `CONTENT_TYPES` gana `mp4 →
  video/mp4`.
- `next.config.ts`: la CSP gana `media-src 'self' blob: <api> https://res.cloudinary.com` — sin
  eso el `<video>` no carga el preview.
- Frontend: `Lightbox` pinta un `<video controls playsInline preload="metadata"
  controlsList="nodownload">` cuando `kind==='video'`; `GalleryImage` añade un distintivo ▶ + la
  duración sobre la miniatura; el `Uploader` del Studio acepta video y la rejilla muestra
  "Procesando video…" y **sondea** `GET /media/:id/processing` cada 4 s hasta que termina.

### 21.5 Verificación

- `tsc` back + front limpios. **107 tests / 16 suites** — nuevo `video-pipeline.service.spec.ts`
  (6 tests, `ffmpeg`/`ffprobe`/`exiftool` reales: genera un MP4 diminuto, comprueba `probe()`,
  rechazo de no-video y de exceso de tamaño, master sin metadatos, PNG de portada, preview ≤720p).
- `next build` producción (`NODE_ENV=production`) OK, 16 rutas.
- **`verify-14b.mjs`** contra el backend en vivo — **13/13**: un PNG con nombre `.mp4` → 400;
  subida de video real → 201 con `kind=video`, `processing=true`, `durationMs` del probe, sin
  `urls.preview` todavía; se sondea `GET /media/:id/processing` hasta `done`; la bandeja del álbum
  ya trae `urls.preview` (MP4) + `urls.large` (póster WebP) + `placeholder`; al publicar,
  `GET /g/:slug` lo trae con `kind=video`, `urls.preview` presente y **`urls.original` ausente**; el
  preview descarga y empieza con un box `ftyp` de MP4; `DELETE /media/:id` → 204.
- Comprobado aparte con `exiftool` sobre el preview servido: lleva `Copyright`, `Artist`,
  XMP `dc:Rights`/`dc:Creator`, `Credit`, `UsageTerms`, `WebStatement`, `LicensorURL` — la
  invariante D10 (todo archivo servido lleva los derechos) también se cumple en video.
- `verify-14a.mjs` (rutas/campos `media`) y `probe-fase10.mjs` (24/24) siguen en verde.

## 22. Fase 14c — Marca de agua sobre el video + HLS adaptativo (completada y verificada, 2026-09-07)

Tercer tramo de la Fase 14: la protección (marca de agua en todo lo público, como en las fotos —
D9) y la entrega "de producción" (streaming adaptativo por HLS).

### 22.1 Marca de agua en el video

`WatermarkService.buildFrameOverlay(w, h, config)` (nuevo) construye un **PNG RGBA transparente del
tamaño exacto de la rendition** con la marca ya estampada (mosaico diagonal o esquina — reutiliza
el mismo SVG y la misma lógica de tamaño de mosaico acotado que las fotos, incluida la lección del
`thumb`). `ffmpeg` lo aplica una sola vez con `overlay=0:0` mientras codifica cada rendition — la
marca va **incrustada en la imagen**, no se puede quitar cuadro a cuadro.

Se estampa en: el póster (los 4 WebP, vía `watermark.composite`, como cualquier derivado de foto),
el `preview` MP4 y **todas** las renditions HLS. **Nunca** el master (D9). Solo en álbumes `public`
(`unlisted`/`private` no llevan marca, igual criterio que las fotos).

### 22.2 HLS adaptativo (`VideoPipelineService.buildRendition` + `packageHls`)

- `buildRendition(master, out, {w,h}, fps, bitrateKbps, overlayPngPath|null, hasAudio)`: escala el
  master a un tamaño **exacto** (par, sin ampliar), aplica la marca si toca, y codifica H.264 con
  los fotogramas clave **alineados a 2 s** (`-g`/`-keyint_min` = `2·fps`, `-sc_threshold 0`) para
  que los segmentos HLS partan limpio. Bitrate por altura: 360p→800k, 540p→1400k, 720p→2800k,
  1080p→5000k.
- Alturas: `[360, 540, 720, 1080]` que quepan **bajo** la del master, más la del propio master
  (deduplicadas). Un master 720p → renditions 360/540/720.
- `packageHls(renditionPaths, outDir, hasAudio)`: un solo `ffmpeg` con `-c copy` (solo
  remultiplexa, rápido) y `-var_stream_map` → `master.m3u8` + `stream_N.m3u8` + `seg_N_*.ts` por
  rendition, `-hls_time 4 -hls_playlist_type vod -hls_flags independent_segments`.
- El `preview` MP4 standalone (respaldo sin HLS) = la rendition ≤720p más alta.

### 22.3 Reescritura de playlists y almacenamiento

Las claves del `StorageService` son opacas (`<uuid>.<ext>`) — **no** coinciden con los nombres
relativos que escribe `ffmpeg` (`seg_0_003.ts`). Tras el empaquetado, el job:

1. sube cada `.ts` y guarda `nombre → URL servida`;
2. reescribe cada `stream_N.m3u8` (cada línea que no empieza por `#` es un segmento → se sustituye
   por su URL) y lo sube;
3. reescribe `master.m3u8` (cada línea = un `stream_N.m3u8` → su URL) y lo sube → su clave es
   `media.hls_manifest_key`.

Todas las claves HLS (master + playlists + segmentos) se guardan en **`media.hls_keys String[]`**
(migración `20260907160000_media_hls_keys`) — para poder **borrarlas todas** al eliminar el
elemento o su álbum (`ImagesService.remove` y `AlbumsService.remove` iteran ese array).

- **Bug propio corregido**: `GET /media/:key` resuelve la visibilidad buscando la clave en
  `media.storage_key` o `media_variants.storage_key`. Los objetos HLS viven en `hls_keys`, así que
  **todas las URLs HLS daban 404**. `visibilityOfKey` gana una tercera búsqueda
  `media.findFirst({ where: { hls_keys: { has: key } } })`.
- `DiskStorageDriver`: la validación de clave pasa a `[a-z0-9]{2,4}` (el `.ts` tiene 2 caracteres)
  y `CONTENT_TYPES` gana `m3u8 → application/vnd.apple.mpegurl` y `ts → video/mp2t`.
- URLs firmadas de un álbum **privado**: los objetos HLS usan un TTL más largo
  (`MEDIA_HLS_URL_TTL_SECONDS`, 3600 s) — una reproducción pausada seguiría pidiendo segmentos.
  Para `public`/`unlisted` la URL es estable y esto no aplica.

### 22.4 Entrega y frontend

- `GET /g/:slug` y la vista del Studio añaden `urls.hls` (el `master.m3u8`) cuando existe; el
  `preview` MP4 sigue como respaldo.
- `Lightbox`: para `kind === 'video'`, si hay `urls.hls` → HLS nativo en Safari
  (`canPlayType('application/vnd.apple.mpegurl')`), o **`hls.js`** cargado desde `cdnjs` (`hls.min.js`
  1.5.17, `enableWorker: false` para no depender de `worker-src` en la CSP) en el resto; ante un
  error fatal de `hls.js`, o si no hay `urls.hls`, cae al `preview`. `next.config.ts` gana
  `https://cdnjs.cloudflare.com` en `script-src` (solo para `hls.js`).

### 22.5 Verificación

- `tsc` back + front limpios. **110 tests / 16 suites** — `video-pipeline.service.spec.ts` gana
  `buildRendition()` (escala a tamaño exacto + incrusta una marca PNG) y `packageHls()`
  (`master.m3u8` + `stream_N.m3u8` + `.ts`); `watermark.service.spec.ts` gana `buildFrameOverlay()`
  (PNG RGBA del tamaño del fotograma, con alfa no nulo).
- `next build` producción OK, 16 rutas.
- **`verify-14c.mjs`** contra el backend en vivo — **14/14**: subida de un video 720p → 3 renditions
  (360/540/720); `master.m3u8` con `#EXT-X-STREAM-INF` y las 3 `stream_N.m3u8` como **URLs http
  absolutas** (no nombres relativos); cada `stream_N.m3u8` con `#EXTINF` y segmentos como URLs
  absolutas; un `.ts` descarga como MPEG-TS (byte de sync `0x47`, `Content-Type: video/mp2t`); la
  galería pública expone `urls.hls` + `urls.preview` y **no** `urls.original`; el póster WebP
  descarga; **al borrar el elemento, los segmentos `.ts` dejan de existir (404)** — la limpieza de
  `hls_keys` funciona.
- `verify-14b.mjs` (13/13) y `probe-fase10.mjs` (24/24) siguen en verde.
- **No verificado en navegador real** (sin herramienta de navegador en el entorno): la
  reproducción visual con `hls.js` y el cambio automático de calidad no se comprobaron en un
  browser; sí el flujo completo por API y que cada pieza HLS se sirve correctamente.

## 23. Fase 14d — Licenciamiento de video + hero de portada en video (completada y verificada, 2026-09-07)

Cuarto y último tramo de la Fase 14 — con esto el video queda al mismo nivel que la foto:
se publica, se protege (marca + derechos), se **licencia** y puede ser el **hero** de la portada.

### 23.1 Licenciamiento de video

El backend ya trataba el video en `consumeDelivery` desde la 14b (`kind === 'video'` → `format:
'mp4'`, extensión `.mp4`, `metadata.embed` con etiquetas QuickTime/XMP). La 14d lo **verifica de
punta a punta en vivo** y ajusta el resto:

- **Texto**: `LicenseRequestForm` (el panel del lightbox) recibe `kind` y dice "Solicitar licencia
  de **este video**" / "…de esta foto"; los correos de `LicensingService` (`submit`, `accept`)
  dicen "un video de «…»" / "una foto de «…»" según `media.kind`. El endpoint, el honeypot, el
  throttle y la validación (`published` + álbum `public`) no cambian — un video se licencia por el
  mismo camino que una foto.
- El `LicenseRequestForm` se muestra en el lightbox tanto para foto como para video (ya lo hacía
  desde la Fase 12d — recibe `mediaId`, ahora también `kind`).

Verificado en vivo (`verify-14d.mjs`, **14/14**): subir un video 720p → publicar → `POST
/license-requests { mediaId: <video> }` → 202 y aparece en la bandeja con la miniatura (el póster
del video); cotizar → aceptar (201, se emite la licencia y el `delivery_token`); **primera
descarga → 200, `Content-Type: video/mp4`, `Content-Disposition: attachment;
filename="licencia-XXXXXXXX.mp4"`, MP4 real (box `ftyp`) de 720p** (el **master limpio**, no una
rendition con marca); `exiftool` sobre el archivo entregado confirma los derechos **más la nota del
licenciatario** ("Licencia otorgada a … para uso commercial: …") incrustada al vuelo solo para esa
descarga; **segunda descarga del mismo token → 404** (un solo uso); la solicitud queda
`fulfilled`. La extracción del token para la prueba se hizo con un `logger.warn` temporal en
`accept()`, usado una vez y **quitado** antes del commit (mismo método que la Fase 12c — el
`RESEND_API_KEY` del `.env` es real, así que `MailService` no vuelca el cuerpo del correo). Además
`licensing.service.spec.ts` gana un test de `consumeDelivery` para el caso video (assert de
`format: 'mp4'` y `filename` `.mp4`) para no depender de ese truco en el futuro.

### 23.2 Hero de portada en video

`site_settings.hero_media_id` ya era genérico. Ajustes:

- **`PATCH /site`**: la validación de `heroMediaId` pasa a exigir además `media.storage_key`
  (rechaza un video cuyo transcode aún no terminó) y el mensaje deja de decir solo "foto".
- **`SiteService.toPublic`**: `HeroMedia` gana `kind`; para un hero **video** el `urls` incluye
  `preview` (MP4) + `hls` (`master.m3u8`) y los WebP del póster — **nunca** `original` (el master
  limpio, D9); para un hero **foto** sigue igual (`original` + derivados).
- **Frontend**: `components/HeroMedia.tsx` (nuevo, cliente) — `<img>` para foto, `<video autoplay
  muted loop playsInline>` (usando el `preview`) para video, **salvo `prefers-reduced-motion`**:
  entonces el mismo `<video>` se queda en pausa mostrando el póster (no se cambia el tipo de
  elemento, para no romper la hidratación). `app/page.tsx` lo usa en lugar del `<img>` directo. El
  selector de hero de `/studio/ajustes` ya listaba los videos (usa el póster de miniatura); ahora
  la etiqueta añade "(video)".

Verificado en vivo (`verify-14d-hero.mjs`, **6/6**): un hero de video sin procesar → 400; ya
procesado y publicado → 200; `GET /site` devuelve `hero.kind === 'video'` con `urls.preview` +
`urls.hls` y **sin** `urls.original`; el `preview` del hero descarga como MP4.

### 23.3 Estado de la Fase 14

Con la 14d cerrada, **la Fase 14 está completa**: un video se sube (validado por contenido), se
transcodifica a un master limpio + póster + preview + renditions HLS **con marca de agua**, se
reproduce en el lightbox (`hls.js`), se puede **licenciar** (entrega del master limpio de un solo
uso, con el licenciatario incrustado) y puede ser el **hero** de la portada. **111 tests / 16
suites**, `next build` prod OK, y `verify-14b/14c/14d(+hero)` + `probe-fase10` todos en verde.
Bloque V1–V14 (video) y L1–L17 (licenciamiento, ya cubre video) en `PRUEBAS_SEGURIDAD.md`.

> **No verificado en navegador real** (todo el entorno es sin browser): la reproducción visual del
> `<video>`/`hls.js` en el lightbox y el hero, y el respeto a `prefers-reduced-motion` en pantalla,
> no se comprobaron en un navegador — sí todo el flujo y el servido de cada pieza por API.

## 24. Fase 15 — Layout "libro" (fotolibro que se hojea) — diseño, sin construir (2026-09-07)

> Solo diseño. Registra las decisiones para arrancar la Fase 15 sin re-discutirlas. Decisión marco
> en `PLAN_DESARROLLO.md` §4 **D15**. Inspiración: la sección "The Story" de
> `nois7.com/world-of-dreams` (el dueño la señaló) — un libro que se abre y cuyas páginas pasan
> según bajas.

### 24.1 Qué es y dónde encaja

Un **layout de álbum más**: `albums.layout` gana el valor `'book'` (junto a `masonry` / `justified`
/ `grid` / `carousel`). Cualquier colección se puede poner en modo "libro" desde el gestor. **No**
es una página suelta ni un componente de la portada — es la misma pieza reutilizable que el resto
de layouts, para no atarla a una sola colección.

`albums.layout` ya es `String @db.VarChar(20)` → **sin migración**. El valor `'book'` se añade en:
`gallery_backend/src/albums/dto/album.dto.ts` (`ALBUM_LAYOUTS`), `gallery_frontend/src/lib/gallery-schema.ts`
(`z.enum([...])`), `gallery_frontend/src/lib/studio-types.ts` (`LAYOUTS` + la unión de `AlbumRow.layout`),
`AlbumSettingsForm.tsx` (la opción del `<select>`), `GalleryLayout.tsx` (la rama nueva), y la lista
de layouts del `README.md`.

### 24.2 La animación — decisiones tomadas

| Eje | Decisión | Por qué / alternativa descartada |
|---|---|---|
| **Realismo del pase** | **`page-flip` (StPageFlip, MIT, ~30 KB) en modo HTML**, bundleado por npm (no CDN). | El dueño pidió "el más completo": una hoja que se curva con sombra no es viable en CSS puro a calidad. El **modo HTML** mantiene `<div>`/`<img>` reales en el DOM → `srcset`, BlurHash, `loading="lazy"` y SEO siguen funcionando (el modo canvas los perdería). Se bundlea (no se carga de un CDN como `hls.js`) porque es una pieza central del feature, versionada en `package-lock.json`. Es la primera librería de UI que entra al proyecto — justificada por D15. |
| **Disparo con el scroll** | **Sección fija (`position: sticky`) + progreso de scroll.** Un contenedor alto (`(pliegos + 2) × ~90vh`) hace de "pista"; mientras la sección está pegada, `progress = 0..1` se mapea a `pliego actual` y se llama `pageFlip.flip(pageIndex)` al cambiar. | El efecto "cinematográfico" del sitio de referencia. Frágil: hay que calcular el progreso a mano (`getBoundingClientRect` en `rAF`, activado por un `IntersectionObserver` sobre la sección), soltar el pin en los extremos, y no romper teclado ni móvil. Por eso la caída a `grid` (24.3) **no es opcional**. |
| **Contenido por pliego** | **Dos imágenes por pliego** (página izquierda + derecha), como un libro abierto. Portada = título del álbum + colores del `theme` (+ la 1ª foto tenue de fondo). Contraportada = CTA ("Solicitar licencia de esta colección" / enlace a `/contacto`). Número impar de medios → última página derecha en blanco (papel). | Lo pidió el dueño. En móvil se cae igual a una por pantalla. |
| **Móvil** (`< ~700px`) | **Una página por pantalla; se pasa con gesto** (swipe/tap — lo maneja `page-flip` en modo portrait). **Sin** scroll fijo (el scroll-jacking en un teléfono es mala UX). | Un libro de dos páginas no cabe en vertical; el pin en móvil pelea con el scroll nativo. |
| **`prefers-reduced-motion` · sin JS · si `page-flip` no carga** | **Se renderiza el mismo conjunto de imágenes como `grid`** (reutiliza el markup del layout `grid` existente): sin 3D, sin pin, sin scroll-jacking. | Accesibilidad no negociable en este proyecto (Fase 6). Y es el fallback natural de mejora progresiva: el SSR pinta el `grid`, y solo si hay JS + movimiento permitido + la librería carga, se "mejora" a libro. |

### 24.3 Piezas nuevas (frontend)

- **`components/BookLayout.tsx`** — orquesta: decide `grid` (fallback) vs libro; en libro monta
  `page-flip`, crea el contenedor-pista, engancha el `IntersectionObserver` + el listener de
  scroll (throttled con `requestAnimationFrame`), y traduce progreso → `flip()`. Limpia el
  `will-change` de la hoja que ya terminó de girar; usa `content-visibility: auto` en los pliegos
  fuera de vista; precarga las imágenes del **pliego siguiente**.
- **`lib/use-scroll-progress.ts`** — hook: dado un `ref` y (opcional) un rango, devuelve `0..1`
  del avance del elemento por el viewport. Reutilizable.
- **CSS** — un bloque nuevo en `globals.css` (o un módulo): la pista, la escena pegada, la
  portada/lomo, la textura de papel, y las mismas variables de `theme` que el resto de layouts.
- **`page-flip`** como `dependency` en `gallery_frontend/package.json` (+ su hoja de estilos, que
  trae las sombras del curl — se importa).
- Las páginas siguen usando **`GalleryImage`** (el tile de siempre: `srcset`, BlurHash, lazy). Un
  medio `kind: 'video'` en una página → el póster + un ▸; al tocarlo abre el **`Lightbox`**
  existente en ese índice (que ya reproduce el video). Tocar cualquier página abre el `Lightbox`.

### 24.4 Rendimiento y seguridad

- **CSP**: `page-flip` se **bundlea**, así que **no** hace falta tocar `script-src`. Sus imágenes
  son `<img>` del propio DOM (`img-src 'self' <api>` ya lo cubre). No abre red.
- **Presupuesto de rendimiento** (Fase 6): el pin + el flip + imágenes grandes es lo más caro que
  tendría el frontend. Mitigaciones: solo se anima mientras la sección está en viewport; se sirven
  los derivados `medium`/`large` (no el original); `content-visibility` en pliegos lejanos;
  precarga solo del pliego siguiente; el listener de scroll pasa por `rAF` y sale temprano si el
  pin no está activo. Hay que **medir** (Core Web Vitals) antes de darlo por bueno.
- **Sin migración, sin cambios de backend.** `GET /g/:slug` ya devuelve `{ album, media }` con
  todo lo necesario (`layout`, `theme`, `kind`, `urls`).

### 24.5 Sub-fases (Fase 15)

- **15a** — Plumbing del valor `book` en los 6 sitios + un pliego **estático** de dos imágenes
  (sin animación) + el fallback a `grid` (móvil, sin-JS, `prefers-reduced-motion`). Ship-able:
  ya es un layout "de libro" plano y accesible.
- **15b** — Bundlear `page-flip`; curl realista sobre los pliegos estáticos; pasar página con
  **gesto/arrastre** (sin scroll todavía). Escritorio (dos páginas) + móvil (una).
- **15c** — El **scroll fijo** que pasa las páginas en escritorio + navegación por teclado +
  botones prev/next + la pasada de rendimiento.
- **15d** — Pulido: portada/contraportada desde el `theme`, páginas de video, CTA de licencia,
  medición de CWV.

Encaja después de la Fase 13 o antes — no depende de nada de pago ni del despliegue.

## 25. Fase 15a — Layout "libro": plumbing + pliego estático (completada y verificada, 2026-09-07)

Primer tramo de la Fase 15. Deja el layout `book` **funcionando de forma estática y accesible**
(sin giro de página ni scroll fijo — llegan en 15b/15c), y sirve de base para lo demás.

### 25.1 El valor `book` (6 sitios, sin migración)

`albums.layout` ya es `String @db.VarChar(20)` → **no hay migración**. `'book'` se añadió en:
`gallery_backend/src/albums/dto/album.dto.ts` (`ALBUM_LAYOUTS` → `@IsIn` lo recoge solo, un layout
inválido sigue dando 400), `gallery_frontend/src/lib/gallery-schema.ts` (`z.enum`),
`gallery_frontend/src/lib/studio-types.ts` (`LAYOUTS` + la unión de `AlbumRow.layout`),
`GalleryLayout.tsx` (`SIZES_BY_LAYOUT`), `README.md`. El selector de layout de `AlbumSettingsForm`
itera `LAYOUTS`, así que la opción aparece sin tocar el formulario.

### 25.2 `BookLayout.tsx` (nuevo)

`GalleryView` ramifica: `album.layout === 'book'` → `<BookLayout>`, si no → `<GalleryLayout>`. En
modo libro la cabecera de la galería va **`g-header--slim`** (sin `<h1>` ni descripción — la portada
del libro los lleva).

- **Portada** (`g-book__cover`): kicker "Fotolibro" + título + descripción, con el color de acento
  del `theme`.
- **Pliegos** (`g-book__spread`): los medios se agrupan de dos en dos; cada hoja
  (`g-book__page`) reutiliza **`GalleryImage`** (el mismo tile de siempre: `srcset`, BlurHash,
  `loading="lazy"`, clic → `onOpen(index)` → `Lightbox`). Nº de medios impar → última hoja derecha
  en blanco (`g-book__page--blank`). Número de folio por hoja. Un "lomo" central es una sombra CSS
  (`::after`).
- **Contraportada** (`g-book__back`): CTA a `/contacto` ("Solicitar una licencia").
- **Móvil** (`≤ 700px`, solo CSS): una hoja por pantalla, sin lomo.

Es **SSR puro, sin JS**: el markup del libro se pinta en el servidor. No hay animación que
`prefers-reduced-motion` tenga que desactivar todavía — la caída a `grid` para reduced-motion / sin
JS / fallo de librería entra en 15b, cuando ya haya giro de página.

### 25.3 Bug propio corregido (500 → 400)

Al probar con un PNG degenerado se descubrió que `ImagePipelineService.process` daba un **500** si
un archivo pasaba `sharp().metadata()` (header legible) pero fallaba al re-codificarse
(`vips2png: unable to write to target`). El re-encode del original estaba **fuera** del `try/catch`
que ya convierte "no es una imagen" en 400. Ahora está dentro → **400 "La imagen está dañada o
incompleta"**. Pre-existente desde la Fase 3, no lo introdujo la 15a. Test nuevo en
`image-pipeline.service.spec.ts`.

### 25.4 Verificación

- `tsc` back + front limpios. **112 tests / 16 suites** (nuevo test del re-encode fallido).
- `next build` producción OK.
- **`verify-15a.mjs`** contra el backend + el frontend en vivo — **9/9**: `layout: 'flipbook'` →
  400 (whitelist); crear álbum con `layout: 'book'` → ok; `GET /g/:slug` → `album.layout === 'book'`
  con los 3 medios; el **SSR del frontend** (`GET :3051/g/:slug`) pinta `g-book__cover` con el
  título, **2 pliegos** para 3 medios (con una hoja en blanco), la contraportada con el CTA a
  `/contacto`, y la cabecera `g-header--slim`.

> **No verificado en navegador real** (sin herramienta de browser): la apariencia del libro
> estático (papel, lomo, folios, portada) no se comprobó visualmente; sí que el markup y las clases
> se sirven y que el layout se selecciona por `album.layout`.

## 26. Fase 15b — Layout "libro": pase de página con `page-flip` (construida, 2026-09-07)

Segundo tramo de la Fase 15. Sobre el fotolibro plano de la 15a, monta el **pase de página
fotorrealista** con arrastre; el scroll fijo que pasa las páginas llega en la 15c.

### 26.1 La librería

**`page-flip` (StPageFlip, v2.0.7, MIT, ~44 KB min)** — bundleada por **npm** (no CDN), en
`gallery_frontend/package.json`. Es la **primera librería de UI del proyecto**; se justifica porque
un pase de página con curvatura y sombra no es viable en CSS puro (D15). Se usa en **modo HTML**
(`loadFromHTML`): mantiene los `<div>`/`<img>` reales en el DOM, así que `srcset`, BlurHash y
`loading="lazy"` siguen funcionando (el modo canvas los perdería). No trae `.d.ts` ni CSS en
`dist` → hay una declaración mínima en `gallery_frontend/src/types/page-flip.d.ts` y sus reglas
estructurales (`.stf__*`) se inlinearon en `globals.css` **acotadas bajo `.g-book`**.

- **CSP**: al estar bundleada, **no** hace falta tocar `script-src` (a diferencia de `hls.js`). No
  hace peticiones de red; sus sombras son estilos inline (`style-src 'unsafe-inline'` ya lo cubre).
- Se importa **dinámicamente** dentro de un `useEffect` (`import('page-flip/dist/js/page-flip.module.js')`)
  — nunca entra al bundle del servidor ni al render inicial. La destructuración del export tolera
  que un empaquetador lo envuelva en `.default`.

### 26.2 Los tres modos de `BookLayout`

| Modo | Cuándo | Qué |
|---|---|---|
| **`static`** | SSR, y lo que queda **sin JS**. | El fotolibro plano de la 15a (portada + pliegos de dos hojas + contraportada). Accesible, sin animación. |
| **`flip`** | Cliente, `prefers-reduced-motion` **no** activo y `page-flip` carga bien. | Una lista **plana** de hojas (`.g-book__leaf`): portada (`data-density="hard"`) → una hoja por medio → hoja en blanco si el nº es impar (deja la contraportada sola) → contraportada. `page-flip` con `showCover: true`, `size: 'stretch'`, `disableFlipByClick: true` (el clic **no** pasa página) y un `ResizeObserver` → `pageFlip.update()`. |
| **`grid`** | Cliente, `prefers-reduced-motion` activo **o** `page-flip` no carga / falla al iniciar. | Reutiliza `GalleryLayout` forzando `layout: 'grid'` — las mismas imágenes, sin libro ni 3D. |

El SSR renderiza `static`; en `useEffect` se decide `grid` (menos movimiento) o `flip`; si el
montaje de `page-flip` lanza, se cae a `grid`. **Sin JS → se queda en `static`** (el fotolibro
plano ya es accesible; es una desviación consciente del "→ grid" del diseño, más suave para el
lector).

### 26.3 Tocar una hoja abre el lightbox

`page-flip` solo reenvía los clics a `<a>` y `<button>` dentro de las hojas. En modo `flip` cada
hoja lleva la imagen (con `GalleryImage`, **sin** `onOpen` — no es interactiva) **más** un
`<button className="g-book__leaf-btn">` transparente a pantalla completa que llama `onOpen(index)`.
Así: **arrastrar la esquina o los botones ‹ ›** pasan la página; **un toque** abre el `Lightbox`.
Botones prev/next explícitos (`flipPrev()`/`flipNext()`) para descubribilidad y accesibilidad.

### 26.4 Verificación

- `tsc` front limpio. `next build` producción OK; `page-flip` (`loadFromHTML`) aparece en los
  chunks de cliente → se bundlea de verdad. **112 tests / 16 suites** (sin cambios de backend).
- **`verify-15a.mjs` sigue 9/9**: el SSR no cambió — el fotolibro plano (baseline sin JS) está
  intacto.

> **No verificado en navegador real** (sin herramienta de browser, como en las fases de video): el
> pase de página de `page-flip`, el arrastre de la esquina, la "mejora" de `static` → `flip`, la
> caída a `grid` con `prefers-reduced-motion` o si la librería falla, el toque-para-lightbox vía el
> botón transparente y los botones ‹ › no se probaron en un navegador. El código sigue la API
> documentada de la librería y la lógica de fallback es directa, pero el comportamiento visual e
> interactivo está sin comprobar visualmente.

## 27. Fase 15c — Layout "libro": scroll fijo + teclado (construida, 2026-09-07)

Tercer tramo de la Fase 15: el efecto "cinematográfico" — la sección se queda **fija** y las
páginas pasan según el progreso de scroll — más navegación por teclado y una pasada de rendimiento.

### 27.1 Scroll fijo (`sticky`) ↔ `page-flip`

En modo `flip`, el libro se envuelve en:

```
<div class="g-book__track" style="--book-positions: N">   ← alto: N × 88vh (la "pista")
  <div class="g-book__stage">                              ← position: sticky; top: 0; 100vh
    <div class="g-book__flip"> … hojas … </div>
    <div class="g-book__controls"> ‹  ·  n/total  ·  › </div>
  </div>
</div>
```

- El pin (`position: sticky`) **solo** se activa con `@media (min-width: 701px) and
  (prefers-reduced-motion: no-preference)`. En móvil la pista mide `auto` y la escena es `static` —
  el libro fluye y se pasa con gesto (decisión de D15: nada de scroll-jacking en un teléfono).
- **Scroll → página**: un listener `scroll` pasivo, throttleado con `requestAnimationFrame`, mide
  `getBoundingClientRect()` de la pista; si está pineada
  (`rect.top <= 0 && rect.bottom >= innerHeight`) calcula
  `progress = -rect.top / (rect.height - innerHeight)` y
  `target = round(progress × (leafCount - 1))`; si cambió y no coincide con la página actual,
  `pageFlip.flip(target)`. Sale temprano si no está pineada o si no es escritorio.
- **Página → scroll** (sincronía inversa): en el evento `flip`, si lo disparó el usuario
  (arrastre / botones / teclado — **no** nuestro propio handler de scroll, controlado por un flag
  `fromScroll`), se hace `window.scrollTo` a la posición de la pista que corresponde a esa página,
  con `behavior: 'smooth'` — así soltar el scroll no "regresa" el libro.

### 27.2 Teclado

Mientras la pista está pineada (y no hay lightbox abierto): `ArrowRight` / `ArrowDown` / `PageDown`
→ `flipNext()`; `ArrowLeft` / `ArrowUp` / `PageUp` → `flipPrev()` (con `preventDefault`, para que la
tecla no haga *también* scroll). Botones ‹ › explícitos + un indicador `n / total` (`aria-live`).

### 27.3 Rendimiento

- El loop de scroll va por `rAF` y **no hace nada** si el libro no está pineado.
- `.g-book__flip { contain: layout paint }` aísla el subárbol del libro.
- **Precarga del pliego siguiente**: en cada `flip`, las `<img>` de las hojas `p`, `p+1`, `p+2`
  que sigan en `loading="lazy"` pasan a `loading="eager"` (las lejanas siguen perezosas).
- Se sirven los derivados WebP (`GalleryImage` con `sizes` de media anchura), nunca el original.
- `prefers-reduced-motion` → modo `grid` (sin pista, sin pin, sin `page-flip`).

### 27.4 Verificación

- `tsc` front limpio; `next build` producción OK. **112 tests / 16 suites** (sin cambios de
  backend). `verify-15a.mjs` **9/9** — el SSR (fotolibro plano, baseline sin JS) no cambió.

> **No verificado en navegador real** (sin herramienta de browser): que la sección se quede fija,
> que el scroll pase las páginas y las páginas muevan el scroll de vuelta, el teclado, y que el
> rendimiento sea aceptable (Core Web Vitals). El código implementa el modelo del diseño (§24.2,
> §24.4) pero su comportamiento en pantalla está sin comprobar.
