FROM node:20-alpine

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

WORKDIR /app

# Copy prisma schema first so postinstall (prisma generate) works
COPY prisma ./prisma
COPY scripts ./scripts
COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile 2>/dev/null || yarn install

COPY . .

RUN chmod +x /app/scripts/start-dev.sh

EXPOSE 3069

CMD ["/app/scripts/start-dev.sh"]
