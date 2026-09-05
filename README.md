# Galería

El portafolio real de un fotógrafo: no solo enseña su obra, también la **protege** (marca de agua,
derechos embebidos, el original nunca gratis en público) y permite **venderla** (licenciamiento de
punta a punta) sin regalarla ni depender de otra plataforma. **Demo de vitrina** que vivirá dentro
del portafolio DvloprBn — no un producto independiente. Estándar de producción: sin atajos
simulados, seguridad como prioridad #1, documentado al grado de poder leerse completo.

> **Estado: todas las fases planificadas completas** (infra · identidad · media · galería pública ·
> Studio · seguridad transversal · documentación autogenerada · artefactos de despliegue ·
> reencuadre como portafolio de fotografía · protección de la obra · licenciamiento y venta). Queda
> el despliegue real (VPS + DNS de `galeria.dvloprbn.dev`), enlazarla desde el portafolio, y la Fase
> 13 (pago con Stripe en modo test, diferida a ≈2026-09-17). Ver `ESTADO_PROYECTO.md`.

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
- **Protección de la obra**: marca de agua estampada por el servidor en todo lo público, el
  original de alta resolución nunca se sirve fuera de un álbum privado, registro de derechos por
  imagen embebido en IPTC/XMP con `exiftool` real.
- **Licenciamiento y venta**: botón "Solicitar licencia" en la propia foto del lightbox → el
  gestor cotiza → al aceptar se emite la licencia y se entrega el archivo limpio por una **URL de
  un solo uso** (se consume en la primera descarga, con los datos del licenciatario embebidos).
  Sin pago en el sitio todavía (Fase 13, en espera).

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
- **Contenido** (`media` — foto hoy, video en la Fase 14): `POST /albums/:id/media` (subida) ·
  `GET /albums/:id/media` · `POST /albums/:id/media/reorder` ·
  `POST /albums/:id/media/status` (curación en bloque) ·
  `PATCH /media/:id` (incluye `status` y `rights`) · `DELETE /media/:id`
- **Entrega pública**: `GET /galleries` (índice; `?featured=true` para las de portada) ·
  `GET /g/:slug` (galería, solo contenido publicado) · `GET /media/:key` (archivos, driver de disco)
- **Sitio**: `GET /site` (identidad pública, incluye marca de agua y derechos) ·
  `PATCH /site` (`admin`+) · `POST/DELETE /site/watermark` (logo, `admin`+) ·
  `POST/GET /site/watermark/regenerate` (regenerar en segundo plano, `admin`+) ·
  `POST /contact` (público, honeypot) · `GET|PATCH|DELETE /contact/messages` (`admin`+)
- **Licenciamiento** (Fase 12a): `POST /license-requests` (público, honeypot, solo fotos
  publicadas) · `GET /license-requests` (bandeja, `admin`+) ·
  `PATCH /license-requests/:id` (cotizar, `admin`+) ·
  `POST /license-requests/:id/accept` (emite la licencia, `admin`+) ·
  `GET /deliveries/:token` (público, entrega el archivo — un solo uso)

Referencia completa en Swagger (`http://localhost:3050/docs`, solo dev), en el portal de
documentación (`http://localhost:8098`) y en Compodoc (`http://localhost:8099`).

## Ver la demo

El portafolio poblado ("Mara Solís" + **6 colecciones**) se siembra **desde el host** (necesita la
carpeta de fotos y el backend publicado en `:3050`):

```bash
npx ts-node gallery_backend/scripts/seed-portfolio.ts
```

**Sube** todo el contenido de la carpeta de origen (244 fotos: una carpeta por colección + los
sueltos de la raíz → "Cuaderno") y **publica una selección curada** de ~81 (el resto queda
`archived` — "mostrar menos de lo que se tiene"). Es **convergente**: borra y rehace cada colección
en cada corrida. Necesita `UPLOAD_MAX_UPLOADS_PER_HOUR` alto (el `.env` de dev ya lo trae en 5000;
en producción se deja 120). Variables opcionales: `SEED_PORTFOLIO_API` (`http://localhost:3050`),
`SEED_PORTFOLIO_IMAGES` (carpeta raíz de fotos). Luego abre http://localhost:3051.

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

101 tests, 15 suites: utilidades puras (AES-256-GCM, TOTP, escape HTML, slug, firma HMAC de URLs),
pipeline de imagen (procesa JPEG, elimina EXIF, rechaza no-imagen/SVG/decompression bomb), dos
suites de integración contra el Postgres de desarrollo (jerarquía de roles y de cuentas), las
unitarias de `SiteService` / `ContactService` / `ImagesService` / `LicensingService` (validación del hero publicado,
honeypot, escape del correo, cambio de estado en bloque acotado al álbum, regeneración en segundo
plano) y las de la Fase 11 — `rights.util.spec.ts`, `watermark.service.spec.ts` (incluye el
test de regresión del mosaico que rompía el `thumb`) y `rights-metadata.service.spec.ts`
(integración con el `exiftool` real).

Pruebas de seguridad replicables de la Fase 10 (RBAC de `/site` y `/contact`, honeypot, XSS
almacenado, throttle, fuga de IP):

```bash
node gallery_backend/scripts/probe-fase10.mjs   # 24 checks contra el backend en :3050
```

## Producción (galeria.dvloprbn.dev)

```bash
cp .env.prod.example .env.prod   # rellena secretos + Cloudinary/Resend; SITE_DOMAIN=galeria.dvloprbn.dev
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

- Un solo origen tras Caddy: frontend en `/`, API en `/api/*`. TLS automático con un dominio real.
- Postgres y Redis no publican puertos — solo Caddy expone 80/443.
- El backend aplica migraciones y siembra roles/cuentas al arrancar.
- Para probar el stack de producción en local: `SITE_DOMAIN=http://localhost` en `.env.prod`.

