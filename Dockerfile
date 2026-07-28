# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: build — instala TODAS las dependencias (nest build y prisma generate
# necesitan devDeps), genera el cliente Prisma (TypeScript en ./generated/) y
# compila. El resultado queda en dist/ (incluye dist/generated y las plantillas
# HTML que nest-cli.json copia como assets).
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24.3.0-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# prisma generate no necesita conexión a BD (el aviso de DIRECT_URL ausente de
# prisma.config.ts es esperado aquí).
RUN npx prisma generate && npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: prod-deps — node_modules solo de producción, con poda: @prisma/client
# v7 arrastra el CLI `prisma` completo (y con él typescript, effect, pglite,
# engines y studio) que el runtime jamás importa — el cliente generado ya está
# compilado en dist/generated y habla con Postgres vía @prisma/adapter-pg + pg.
# Si un futuro upgrade de Prisma llegara a necesitar algo de esto en runtime,
# el smoke test de arranque lo detecta (el boot hace $connect()).
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24.3.0-slim AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && rm -rf \
    node_modules/prisma \
    node_modules/typescript \
    node_modules/effect \
    node_modules/@electric-sql \
    node_modules/@prisma/engines \
    node_modules/@prisma/studio-core

# ──────────────────────────────────────────────────────────────────────────────
# Stage 3: runtime — imagen final. Solo Node: el render de PDFs se delega a
# Gotenberg (servicio aparte), así que aquí ya no hay Chromium ni sus fuentes.
# tini se mantiene como init para propagar bien SIGTERM en los despliegues.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24.3.0-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000

# package.json es obligatorio en runtime: su "type": "module" es lo que hace
# que Node interprete dist/**/*.js como ESM.
COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

# Liveness contra el endpoint público de salud (GET /api/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/src/main.js"]
