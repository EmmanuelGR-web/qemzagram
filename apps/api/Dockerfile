# Imagen de producción de la API. Se construye desde la RAÍZ del repositorio:
#   docker build -f apps/api/Dockerfile -t qemzagram-api .
# Funciona en amd64 y arm64 (Oracle Cloud Ampere).

FROM node:24-bookworm-slim AS base
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
WORKDIR /app

# 1) Dependencias completas (con las de desarrollo, para compilar TypeScript).
#    Primero solo los package.json: si no cambian, Docker reutiliza esta capa y no reinstala todo.
FROM base AS build
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace=@qemzagram/shared --workspace=@qemzagram/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @qemzagram/shared && npm run build -w @qemzagram/api

# 2) Solo dependencias de producción (sin TypeScript, Jest, etc.: menos código = menos superficie de ataque).
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --ignore-scripts --workspace=@qemzagram/shared --workspace=@qemzagram/api \
 && npm rebuild argon2 sharp

# 3) Imagen final: Node + ffmpeg (audio y video) + tini (cierra bien los procesos), corre SIN root.
FROM base AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tini \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/data/uploads \
    MEDIA_DIR=/data/media \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
# Carpetas de datos (fotos de perfil y adjuntos en disco): las únicas donde el proceso puede escribir.
RUN mkdir -p /data/uploads /data/media && chown -R node:node /data
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
