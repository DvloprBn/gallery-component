# Imagen de PRODUCCIÓN — build multi-etapa.
#   Etapa 1 (build):  instala TODO, genera el cliente Prisma, compila con Nest,
#                     y poda las devDependencies.
#   Etapa 2 (runtime): solo el resultado + lo mínimo del sistema.

# ─────────────────────────── Etapa 1: build ───────────────────────────
FROM node:22-bookworm-slim AS build

# openssl -> lo necesitan Prisma y su generación de cliente.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencias (con lockfile -> instalación reproducible).
COPY package.json package-lock.json ./
RUN npm ci

# El cliente de Prisma se genera aquí, contra el schema, y queda dentro de
# node_modules — que después se copia tal cual a la imagen final.
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Código y compilación.
COPY . .
RUN npm run build

# Fuera las devDependencies (nest-cli, jest, ts-*, @types…). `prisma` y
# `@prisma/client` están en dependencies a propósito: `migrate deploy` corre
# en runtime.
RUN npm prune --omit=dev

# ─────────────────────────── Etapa 2: runtime ─────────────────────────
FROM node:22-bookworm-slim AS runtime

# openssl -> motor de Prisma en runtime.
# fontconfig + fuente -> rasterizado de texto SVG (seed de demo + marca de agua).
# libimage-exiftool-perl -> embebe IPTC/XMP de derechos (Fase 11).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       openssl ca-certificates fontconfig fonts-dejavu-core libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/package.json ./package.json

# Usuario sin privilegios (viene en la imagen base de node).
USER node

EXPOSE 3040

# Aplica las migraciones ya versionadas, siembra roles + cuentas de prueba
# (idempotente; es una demo con datos dummy), y arranca la API compilada.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run prod:seed || true; node dist/main.js"]
