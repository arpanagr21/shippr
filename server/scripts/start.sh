#!/bin/sh
set -e

DB_PROVIDER=${DB_PROVIDER:-sqlite}
echo "[startup] DB provider: $DB_PROVIDER"

sed "s/__DB_PROVIDER__/$DB_PROVIDER/g" /app/prisma/schema.prisma.template > /app/prisma/schema.prisma

npx prisma generate
npx prisma db push --skip-generate

exec node dist/index.js
