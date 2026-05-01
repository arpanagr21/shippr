# ── Stage 1: Build React client ──────────────────────────────────────────────
FROM node:20-alpine AS client-build

RUN corepack enable && corepack prepare yarn@1.22.22 --activate
WORKDIR /app

COPY client/package.json client/yarn.lock* ./
RUN yarn install --frozen-lockfile 2>/dev/null || yarn install

COPY client/ .

# No Firebase / personal config at build time.
# The app fetches /api/config at runtime — all secrets stay in server env vars.
# VITE_API_URL is intentionally absent so all API calls use the same origin.
RUN yarn build

# ── Stage 2: Build Express server ────────────────────────────────────────────
FROM node:20-alpine AS server-build

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
WORKDIR /app

# Pre-generate schema.prisma from the template so postinstall (prisma generate) succeeds.
COPY server/prisma ./prisma
RUN sed 's/__DB_PROVIDER__/sqlite/g' prisma/schema.prisma.template > prisma/schema.prisma

COPY server/package.json server/yarn.lock* ./
RUN yarn install --frozen-lockfile 2>/dev/null || yarn install

COPY server/ .
RUN yarn build

# ── Stage 3: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache openssl
WORKDIR /app

# Copy everything from the build stage — node_modules already has the generated
# Prisma client. start.sh regenerates it at container start for the actual DB provider.
COPY --from=server-build /app/dist         ./dist
COPY --from=server-build /app/node_modules ./node_modules
COPY --from=server-build /app/prisma       ./prisma
COPY --from=server-build /app/scripts      ./scripts
COPY --from=server-build /app/package.json ./package.json

# Built client — Express serves this at / in production
# path.join(__dirname='dist', '../client/dist') → /app/client/dist ✓
COPY --from=client-build /app/dist ./client/dist

RUN chmod +x /app/scripts/start.sh

EXPOSE 3069

ENV NODE_ENV=production \
    DB_PROVIDER=sqlite \
    DATABASE_URL=file:./data/shippr.db

CMD ["/app/scripts/start.sh"]
