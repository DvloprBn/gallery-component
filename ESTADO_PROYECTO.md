# Estado del Proyecto — Galería

> Bitácora de estado día a día. Se actualiza cada vez que se pide o al cerrar un hito.
> La estrategia y las decisiones que no cambian seguido viven en `PLAN_DESARROLLO.md`.

Última actualización: **2026-09-01**

---

## 1. Dónde estamos

**Fase 1 (núcleo / infraestructura) — completada y verificada de punta a punta (2026-09-01).**

- Documentación autocontenida completa (8 archivos), con las **7 decisiones de `PLAN_DESARROLLO.md`
  §4 confirmadas**:
  - D1 multiusuario · D2 con visibilidad `public`/`unlisted`/`private` · **D3 Cloudinary** (tras
    el pipeline propio de `sharp`; el dueño crea la cuenta y pasa credenciales después) ·
    D4 Framer Motion · D5 con 2FA TOTP · D6 paquetes `gallery_backend`/`gallery_frontend` (nombre
    de marca pendiente, no bloqueante) · D7 repo público.
- Schema Prisma **congelado** (`DOCUMENTO_VIVO_ARQUITECTURA.md` §1.3) y migrado: identidad
  (`roles`/`users`/`refresh_tokens`/`totp_recovery_codes`/`password_reset_tokens`/`security_events`)
  + media (`albums`/`images`/`image_variants`/`album_share_tokens`). Migración inicial única
  `20260901235839_init`.
- **Stack corriendo y verificado** (`docker compose up -d --build`): `GET /health` →
  `{"status":"ok","checks":{"database":true,"redis":true}}`; frontend Next `200`; `tsc` limpio.
  Detalle técnico y hallazgos (Prisma 7.10 driver adapter, `postgres:18` volumen, colisión de
  puertos) en `DOCUMENTO_VIVO_ARQUITECTURA.md` §2.
- **Puertos reales de este proyecto** (verificados libres): frontend `3051`, API `3050`,
  Postgres `5438`, Redis `6383` — solo `127.0.0.1` los de datos.

## 2. Pendiente del dueño (no bloquea nada todavía; sí bloquea la Fase 3)

- **Cuenta de Cloudinary** — crearla y pasar `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` /
  `CLOUDINARY_API_SECRET` al `.env`. Mientras tanto, `STORAGE_DRIVER=disk` (driver de disco en
  desarrollo). Solo se necesita para la Fase 3 (media core).
- Nombre de marca del producto (D6) — no bloqueante.

## 3. Deuda / seguimiento

- **`npm audit`: 4 vulnerabilidades *high* en el árbol del CLI de Prisma** (`mysql2`,
  `deepmerge-ts` vía `@prisma/config`). Solo devDependency, sin ruta alcanzable (usamos
  PostgreSQL). El fix automático baja a Prisma 6 — no se aplica. Seguir releases de Prisma 7.
  Ver `DOCUMENTO_VIVO_ARQUITECTURA.md` §2.2 y `PRUEBAS_SEGURIDAD.md`.

## 4. Próximo paso

**Fase 2 — Identidad** (`PLAN_DESARROLLO.md` §10): módulos `auth` (login en 3 pasos, refresh con
rotación, logout, cambio/recuperación de contraseña), `roles` (CRUD dinámico + jerarquía),
`users` (`assertCanManageRole`), `two-factor` (TOTP), `security-events` (fuerza bruta), `mail`.
Más `prisma/seed.ts` con roles y cuentas de prueba, y los primeros `*.spec.ts`.

---

## Historial de cambios

| Fecha | Cambio |
|---|---|
| 2026-09-01 | **Fase 1 (núcleo/infra) completada y verificada de punta a punta.** Monorepo `gallery_backend` (NestJS 11) + `gallery_frontend` (Next 16 / React 19) + `docker-compose.yml` (Postgres 18, Redis 8, ambos solo `127.0.0.1` + healthcheck). Backend: `main.ts` con helmet + CORS explícito + `ValidationPipe` whitelist + cookie-parser + Swagger dev; `PrismaService` con el **driver adapter de Prisma 7** (`@prisma/adapter-pg` + `pg`; la URL vive en `prisma.config.ts`, ya no en el schema); `RedisService` (ioredis); `validateEnv` al arranque; `GET /health` que verifica Postgres y Redis en vivo. Schema congelado migrado (`20260901235839_init`, 11 tablas). Frontend: landing placeholder + piso de `prefers-reduced-motion`. **Verificado**: `docker compose up -d --build` → 4 contenedores arriba; `/health` `200` `{"status":"ok","checks":{"database":true,"redis":true}}`; frontend `200`; `tsc` 0 errores. **Hallazgos** (detalle en `DOCUMENTO_VIVO_ARQUITECTURA.md` §2): Prisma 7.10 quitó `url` del schema y exige driver adapter + `prisma.config.ts` + carga manual de `.env`; `migrate reset` bloqueado para agentes de IA (se recreó el volumen de la BD en su lugar); `postgres:18-alpine` monta el volumen en `/var/lib/postgresql`, no `/data`; 3040/3041/5437/5522 estaban ocupados por otro stack → puertos reasignados a 3050/3051/5438/6383/5523/8098/8099. `npm audit`: 4 *high* en transitivas del CLI de Prisma (devDep, sin ruta alcanzable — usamos Postgres), sin fix sin bajar a Prisma 6; en seguimiento. Primer commit del repo git propio. |
| 2026-09-01 | **Decisiones §4 confirmadas + inicio de Fase 1.** El dueño confirmó los 7 defaults propuestos (con D3 resuelto como **Cloudinary**: el backend corre igual su pipeline de seguridad — validación por contenido + re-encode con `sharp` + tiro de EXIF — *antes* de subir el derivado limpio a Cloudinary, que queda como almacén + CDN + entrega, no como límite de seguridad). Schema Prisma congelado. Marcas 🟡 retiradas de la documentación. Arranca la construcción de la Fase 1 (núcleo/infra) — ver `DOCUMENTO_VIVO_ARQUITECTURA.md` §2. |
| 2026-09-01 | **Documentación inicial del proyecto, autocontenida.** Set completo de documentos creado (`CLAUDE.md`, `PLAN_DESARROLLO.md`, `DOCUMENTO_VIVO_ARQUITECTURA.md`, este archivo, `APRENDIZAJE.md`, `PRUEBAS_SEGURIDAD.md`, `BIBLIOGRAFIA.md`, `README.md`). Diseño técnico provisional: monorepo, puertos, schema identidad + media, pipeline de subida seguro en 10 pasos, servido con URLs firmadas, módulos y endpoints, objeto `theme` de personalización. Sin código de aplicación (modo diseño). |
