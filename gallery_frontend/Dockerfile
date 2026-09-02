# Imagen de PRODUCCIÓN del frontend — build multi-etapa con salida standalone.

# ─────────────────────────── Etapa 1: build ───────────────────────────
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# NEXT_PUBLIC_* se hornea en tiempo de BUILD (no de arranque del contenedor).
# En producción la API vive en el mismo origen bajo /api.
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ─────────────────────────── Etapa 2: runtime ─────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# La salida standalone trae su propio node_modules mínimo + server.js.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

USER node

EXPOSE 3041

# server.js (Next standalone) escucha en PORT / HOSTNAME del entorno.
CMD ["node", "server.js"]
