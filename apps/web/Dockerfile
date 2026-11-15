# Imagen de producción de la web (Next.js en modo "standalone"). Se construye desde la RAÍZ del repositorio.
# OJO: estas direcciones quedan GRABADAS al compilar (Next las incrusta en el código del navegador),
# por eso la imagen se construye en el servidor con su dominio (ver docker-compose.prod.yml).
#   docker build -f apps/web/Dockerfile --build-arg PUBLIC_URL=https://midominio -t qemzagram-web .

FROM node:24-bookworm-slim AS base
ENV npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
# Dirección de la API dentro de la red de Docker (el navegador nunca la ve: Next hace de proxy en /api).
ARG API_URL=http://api:4000
# Dirección pública del sitio (WebSocket en el mismo dominio, ruta /socket.io).
ARG PUBLIC_URL
# Servidor de llamadas (wss://…).
ARG LIVEKIT_PUBLIC_URL
RUN test -n "$PUBLIC_URL" && test -n "$LIVEKIT_PUBLIC_URL" || (echo "Faltan PUBLIC_URL y LIVEKIT_PUBLIC_URL" && exit 1)
ENV API_URL=$API_URL \
    NEXT_PUBLIC_WS_URL=$PUBLIC_URL \
    NEXT_PUBLIC_LIVEKIT_URL=$LIVEKIT_PUBLIC_URL \
    NEXT_OUTPUT=standalone
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace=@qemzagram/shared --workspace=@qemzagram/web --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @qemzagram/shared && npm run build -w @qemzagram/web

# Imagen final: solo el servidor mínimo que arma Next + archivos estáticos. Corre SIN root.
FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/manifest.webmanifest').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/web/server.js"]
