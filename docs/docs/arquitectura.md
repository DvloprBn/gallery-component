# Arquitectura

> Resumen. El detalle completo, con el *por qué* de cada decisión y los hallazgos de cada fase,
> está en `DOCUMENTO_VIVO_ARQUITECTURA.md` (raíz del repo).

## Stack

| Capa | Tecnología |
|---|---|
| Backend | NestJS 11 · Prisma 7 (driver adapter `@prisma/adapter-pg`) · PostgreSQL 18 |
| Frontend | Next.js 16 · React 19 (App Router) |
| Cache / rate limiting | Redis |
| Procesamiento de imagen | `sharp` (libvips) |
| Almacenamiento | disco (dev) · Cloudinary (prod), tras `StorageService` abstracto |
| Infra | Docker Compose · Caddy (reverse proxy en producción) |
| Documentación | MkDocs Material + Swagger UI + Compodoc |

## Módulos del backend

```
auth              login en 3 pasos, refresh/rotación, logout, cambio y recuperación de contraseña
two-factor        TOTP: setup + QR, confirm (códigos de recuperación), disable, regenerate
roles             CRUD de roles dinámicos + candado de jerarquía
users             administración de cuentas + assertCanManageRole + max_count
security-events   fuerza bruta en Redis (login / 2FA / reuso de refresh) + alerta por correo
storage           StorageService abstracto: driver disco / driver Cloudinary; firma HMAC de URLs
media-processing  pipeline sharp: validación por contenido, re-encode sin EXIF, derivados, BlurHash
albums            CRUD de álbumes (visibilidad, layout, tema), enlaces de compartir
images            subida (rate limit + pipeline + transacción con compensación), reordenado, borrado
media             entrega pública: GET /g/:slug, GET /media/:key (servido con firma para privados)
prisma / redis / mail   infraestructura
```

## Guards globales

`JwtAuthGuard` (toda ruta exige sesión salvo `@Public()`) → `RolesGuard` (aplica `@Roles()`).
La regla **fina** (jerarquía de niveles, `max_count`, propiedad del recurso) vive en el service,
no en el guard.

## Despliegue

Un solo origen tras Caddy en `galeria.dvloprbn.dev`: el frontend en `/`, la API bajo `/api/*`
(el backend usa `GLOBAL_PREFIX=api`). Sin CORS, cookies de sesión host-only. Postgres y Redis no
publican puertos; el único puerto público es el de Caddy. Ver `docker-compose.prod.yml` y
`Caddyfile`.
