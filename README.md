# Galería

Galería de imágenes con personalización y animaciones de grado profesional. Proyecto de estudio
(sin negocio real detrás), construido con estándar de producción: sin atajos simulados, seguridad
como prioridad #1, y documentado al grado de poder leerse y entenderse completo.

> **Estado actual: modo diseño.** Existe la documentación, todavía no el código de aplicación.
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

La migración inicial ya está versionada — el backend corre `prisma migrate deploy` solo al
arrancar, no hace falta ningún paso manual. Postgres (5438) y Redis (6383) se publican solo en
`127.0.0.1`.

Parar: `docker compose down` (agrega `-v` para borrar también los datos).
