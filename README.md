# Galería

Galería de imágenes con personalización y animaciones de grado profesional. **Demo de vitrina** que
vivirá dentro del portafolio DvloprBn — no un producto independiente. Estándar de producción: sin
atajos simulados, seguridad como prioridad #1, documentado al grado de poder leerse completo.

> **Estado: Fases 1–5 + 9 completadas** (infraestructura · identidad · media core · galería
> pública · Studio y paneles · **artefactos de despliegue**). Falta la documentación autogenerada
> (Fase 8) y el despliegue real (VPS + DNS). Vivirá en `galeria.dvloprbn.dev`.
> Ver `ESTADO_PROYECTO.md`.

## Qué va a tener

- **Galería pública** con layouts configurables (masonry / justificado / grid / carrusel),
  imágenes responsivas y perezosas, lightbox y animaciones con presupuesto de rendimiento.
- **Studio** para el dueño de cada galería: crear álbumes, subir y reordenar imágenes, elegir
  tema y layout — todo configurable al crear, no "crear y luego editar".
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
- **Entrega pública**: `GET /galleries` (índice) · `GET /g/:slug` (galería) · `GET /media/:key`
  (archivos, driver de disco)

Referencia completa en Swagger (`/docs`, solo dev).

## Ver la demo

```bash
docker compose exec gallery_backend npx ts-node scripts/seed-demo.ts
```

Siembra una galería pública de ejemplo (8 imágenes por el pipeline real) y muestra su URL.
Ábrela en http://localhost:3051 — el índice enlaza a `/g/<slug>`.

Para operarla desde el navegador, entra en http://localhost:3051/login con una cuenta de prueba
(p. ej. `admin+gallery@example.com` / `TestOnly123!`) y usa **Studio** (crear/gestionar álbumes,
subir imágenes, editar tema) y **Administración** (usuarios y roles).

## Pruebas

```bash
docker compose exec gallery_backend npm test   # 11 tests jest (utilidades puras)
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

