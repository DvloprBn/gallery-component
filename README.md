# Galería

Portafolio de fotografía con personalización de galería y animaciones de grado profesional.
**Demo de vitrina** que vivirá dentro del portafolio DvloprBn — no un producto independiente.
Estándar de producción: sin atajos simulados, seguridad como prioridad #1, documentado al grado de
poder leerse completo.

> **Estado: todas las fases planificadas completas** (infra · identidad · media · galería pública ·
> Studio · seguridad transversal · documentación autogenerada · artefactos de despliegue ·
> reencuadre como portafolio de fotografía). Queda el despliegue real (VPS + DNS de
> `galeria.dvloprbn.dev`) y enlazarla desde el portafolio. Ver `ESTADO_PROYECTO.md`.

## Qué tiene

- **Sitio público** con aspecto de portafolio: portada con hero, `/trabajo` (colecciones),
  `/sobre`, `/contacto` (formulario con honeypot). La identidad —nombre, declaración, texto de
  «Sobre», hero— la fija `site_settings` y se edita desde el gestor.
- **Galería pública** con layouts configurables (masonry / justificado / grid / carrusel),
  imágenes responsivas y perezosas, lightbox y animaciones con presupuesto de rendimiento.
- **Gestor del sitio** para el dueño: crear colecciones, subir y reordenar imágenes, elegir
  tema/layout, marcar "destacada" — todo configurable al crear, no "crear y luego editar" —,
  además de ajustes de identidad y bandeja de contacto (roles `admin`+).
- **Identidad real**: login en 3 pasos (correo → contraseña → 2FA si aplica), JWT en cookie
  httpOnly + refresh con rotación, roles dinámicos con jerarquía de autoridad, 2FA TOTP.
- **Seguridad de archivos real**: validación por contenido (magic bytes), re-encode obligatorio,
  tiro de metadatos EXIF/GPS, límites contra decompression bombs y DoS de subida, imágenes
  privadas solo por URL firmada.

## Stack

NestJS 11 + Prisma 7 + PostgreSQL 18 (backend) · Next.js 16 + React 19 (frontend) · Redis ·
`sharp` (procesamiento de imagen) · almacenamiento S3-compatible · Docker Compose.

## Documentación

| Archivo | Para qué |
|---|---|
| `CLAUDE.md` | Rol, forma de trabajo, dónde está todo |
| `PLAN_DESARROLLO.md` | Estrategia, alcance y **decisiones abiertas** |
| `DOCUMENTO_VIVO_ARQUITECTURA.md` | Diseño técnico y el *por qué* de cada pieza |
| `ESTADO_PROYECTO.md` | Estado día a día |
| `APRENDIZAJE.md` | Bitácora de aprendizaje — el propósito central del proyecto |
| `PRUEBAS_SEGURIDAD.md` | Pruebas de seguridad replicables paso a paso |
| `BIBLIOGRAFIA.md` | Fuentes primarias (RFCs, OWASP, docs oficiales) |

## Arrancar en local

```bash
cp .env.example .env      # rellena los secretos (openssl rand); Cloudinary puede quedar en blanco
docker compose up -d --build
```

| Servicio | URL |
|---|---|
| Frontend | http://localhost:3051 |
| API | http://localhost:3050 |
| Salud de la API | http://localhost:3050/health |
| Swagger (solo dev) | http://localhost:3050/docs |

Al arrancar, el backend corre `prisma migrate deploy` + el seed (idempotente) — no hace falta
ningún paso manual. Postgres (5438) y Redis (6383) se publican solo en `127.0.0.1`.

Parar: `docker compose down` (agrega `-v` para borrar también los datos).

## Cuentas de prueba (seed)

Una por rol, contraseña `TestOnly123!`:

`usuario+gallery@example.com` · `staff+gallery@example.com` · `manager+gallery@example.com` ·
`admin+gallery@example.com` · `director+gallery@example.com` · `super+gallery@example.com`

Jerarquía de autoridad: `usuario`(0) → `staff`(1) → `manager`(2) → `admin`(3) →
`director`(4, máx. 1) → `super`(5, máx. 1). Nadie puede crear ni gestionar un rol o una cuenta de
nivel igual o superior al suyo.

## API (resumen)

- **Identidad**: `POST /auth/register` · `/auth/login/step1|step2|2fa` · `/auth/refresh` ·
  `/auth/logout` · `GET /auth/me` · `PATCH /auth/me/password` · `/auth/forgot-password` ·
  `/auth/reset-password` · `/two-factor/setup|confirm-setup|disable|recovery-codes/regenerate`
- **Administración** (`admin`/`director`/`super`): `/roles` (CRUD) · `/users` (listar, alta, editar)
- **Álbumes** (dueño o admin): `/albums` (CRUD) · `/albums/:id/share-tokens` (crear/revocar)
- **Imágenes**: `POST /albums/:id/images` (subida) · `GET /albums/:id/images` ·
  `POST /albums/:id/images/reorder` · `PATCH /images/:id` · `DELETE /images/:id`
- **Entrega pública**: `GET /galleries` (índice; `?featured=true` para las de portada) ·
  `GET /g/:slug` (galería) · `GET /media/:key` (archivos, driver de disco)
- **Sitio**: `GET /site` (identidad pública) · `PATCH /site` (`admin`+) ·
  `POST /contact` (público, honeypot) · `GET|PATCH|DELETE /contact/messages` (`admin`+)

Referencia completa en Swagger (`http://localhost:3050/docs`, solo dev), en el portal de
documentación (`http://localhost:8098`) y en Compodoc (`http://localhost:8099`).

## Ver la demo

El portafolio poblado ("Mara Solís" + 5 colecciones con fotos de uso libre) se siembra **desde el
host** (necesita la carpeta de fotos y el backend publicado en `:3050`):

```bash
npx ts-node gallery_backend/scripts/seed-portfolio.ts
```

Es idempotente por título. Variables opcionales: `SEED_PORTFOLIO_API` (por defecto
`http://localhost:3050`), `SEED_PORTFOLIO_IMAGES` (carpeta raíz de fotos). Luego abre
http://localhost:3051.

> `scripts/seed-demo.ts` (dentro del contenedor) sigue disponible para una única galería de
> degradados generados con `sharp`, sin archivos externos.

Para operarla desde el navegador, entra en http://localhost:3051/login con una cuenta de prueba
(p. ej. `admin+gallery@example.com` / `TestOnly123!`) y usa **Gestor del sitio** (colecciones,
subir imágenes, tema, ajustes de identidad, bandeja de contacto) y **Administración**
(usuarios y roles).

## Pruebas

```bash
docker compose exec gallery_backend npm test
```

36 tests, 8 suites: utilidades puras (AES-256-GCM, TOTP, escape HTML, slug, firma HMAC de URLs),
pipeline de imagen (procesa JPEG, elimina EXIF, rechaza no-imagen/SVG/decompression bomb) y dos
suites de integración contra el Postgres de desarrollo (jerarquía de roles y de cuentas).

## Producción (galeria.dvloprbn.dev)

```bash
cp .env.prod.example .env.prod   # rellena secretos + Cloudinary/Resend; SITE_DOMAIN=galeria.dvloprbn.dev
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

- Un solo origen tras Caddy: frontend en `/`, API en `/api/*`. TLS automático con un dominio real.
- Postgres y Redis no publican puertos — solo Caddy expone 80/443.
- El backend aplica migraciones y siembra roles/cuentas al arrancar.
- Para probar el stack de producción en local: `SITE_DOMAIN=http://localhost` en `.env.prod`.

