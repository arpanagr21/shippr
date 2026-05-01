# Contributing

## Before you start

Read [ARCHITECTURE.md](ARCHITECTURE.md) first — it explains how the pieces fit together. This document covers the practicalities of running, changing, and submitting code.

---

## Dev setup

Requirements: Docker, Docker Compose. No local Node.js needed.

```bash
git clone https://github.com/arpanagr21/shippr.git
cd shippr
cp .env.example .env
# fill in .env (Coolify URL/token + Firebase creds)

docker compose up --build
```

| Service | URL | Notes |
|---|---|---|
| Client | http://localhost:5173 | Vite dev server, HMR enabled |
| Server | http://localhost:3069 | nodemon, restarts on file save |

Source files are volume-mounted. Saving any file under `client/src/` or `server/src/` triggers a reload instantly — no container restart needed.

---

## Project structure

```
client/src/
  api.ts          ← every fetch call lives here
  types.ts        ← shared TypeScript types (Application, Service, Deployment)
  lib/
    firebase.ts   ← deferred Firebase init (config fetched from /api/config at runtime)
    utils.ts      ← cn(), parseApiError()
  contexts/
    AuthContext.tsx
  components/     ← shared UI components
  pages/          ← one file per route

server/src/
  index.ts        ← Express wiring + startup (calls initCache)
  config.ts       ← env vars (add new ones here first)
  sync.ts         ← Coolify → DB sync logic
  cache/          ← pluggable cache (MemoryCache default, swappable for Redis)
  coolify/        ← typed Coolify API client
  db/             ← Prisma client singleton + seed
  middleware/     ← auth (Firebase token verify + user cache)
  models/         ← DB queries (registry RBAC, users)
  routes/         ← one file per route group
```

---

## Common tasks

### Add a new API route

1. Create `server/src/routes/myroute.ts`
2. Register it in `server/src/index.ts`: `app.use('/api/myroute', myrouteRouter)`
3. Add a typed fetch function to `client/src/api.ts`
4. If the client type shape changes, update `client/src/types.ts` — make new fields optional so old bundles don't break

### Support a new Coolify API version

1. Create `server/src/coolify/vN.ts` implementing `CoolifyAdapter` from `./adapter`
2. Add it to the `adapters` map in `server/src/coolify/client.ts`
3. Set `COOLIFY_API_VERSION=vN` in `.env`

Raw API response types (snake_case, version-specific) stay private inside `vN.ts`. The normalised types in `adapter.ts` are the stable contract everything else depends on.

### Add a new DB column

1. Edit `server/prisma/schema.prisma.template` — new fields must be optional (`?`) or have a `@default`. Never edit `schema.prisma` directly; it is generated at container startup and is not committed.
2. Restart the server container — the startup script runs `prisma generate` and `prisma db push` automatically:
   ```bash
   docker compose restart server
   ```

### Use the cache

Import `getCache()` from `server/src/cache`. Never import a concrete implementation directly.

```typescript
import { getCache } from '../cache';

const value = await getCache().get<MyType>('my-key');
await getCache().set('my-key', value, 5 * 60 * 1000); // 5 min TTL
await getCache().del('my-key');
```

To add a new cache provider (e.g. Redis):
1. Implement `CacheStore` from `cache/types.ts` in a new file `cache/redis.ts`
2. Add `case 'redis'` in `cache/factory.ts`
3. Change `initCache('redis')` in `server/src/index.ts`

### Change how RBAC works

All access-control logic is in `server/src/models/registry.ts`. The key entry point is `getAllowedEnvUuids(user)` — everything else derives from it.

### Add a new env var

1. Add it to `server/src/config.ts`
2. Document it in `.env.example` and the README env var table

---

## Code style

- TypeScript everywhere, strict mode on
- No `any` without a comment explaining why
- No comments explaining *what* the code does — only *why* (non-obvious constraints, workarounds)
- New routes follow the pattern in existing routes: import `AuthRequest`, use `req.user!`

---

## Pull request checklist

- [ ] `docker compose up --build` starts cleanly
- [ ] The feature works end-to-end in a browser (not just type-checks)
- [ ] No hardcoded values that belong in config (URLs, emails, domain names)
- [ ] New env vars are added to `.env.example` and the README table
- [ ] New DB columns are in `schema.prisma.template`, nullable or with a `@default`
- [ ] New response fields on server DTOs are optional in `client/src/types.ts`
- [ ] No raw Coolify API types imported outside of `coolify/v*.ts`
- [ ] PR description includes a **Docs impact** section (see below)

---

## PR description — required Docs impact section

Every PR description must end with a **Docs impact** section. The maintainer updates documentation after merge based on this section — contributors do not edit docs directly.

```
## Docs impact

- README: <what changed, or "none">
- ARCHITECTURE.md: <what changed, or "none">
- CONTRIBUTING.md: <what changed, or "none">
- AGENTS.md: <new rules, propagation chains, or ownership changes — or "none">
- .env.example: <new/changed vars, or "none">
```

Be specific. "Added `COOLIFY_API_VERSION` env var, default `v1`" is useful. "Updated docs" is not.

---

## What we won't merge

- Features that require a non-Coolify backend
- Alternative auth providers — Firebase is the only supported auth mechanism
- UI framework changes (we're staying on shadcn/ui + Tailwind)
- PRs missing a Docs impact section
