# Architecture

Shippr is a thin proxy and access-control layer that sits in front of a Coolify instance. It does not duplicate Coolify's functionality — it controls *who* can see *what* and surfaces it in a clean UI.

---

## Bird's-eye view

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                  │
│                                                           │
│  React SPA (Vite)                                         │
│  ├── Firebase Web SDK  ──── Google sign-in               │
│  ├── api.ts            ──── all HTTP calls to server      │
│  └── pages / components                                   │
└─────────────────────┬────────────────────────────────────┘
                      │  HTTPS  Bearer <Firebase ID token>
┌─────────────────────▼────────────────────────────────────┐
│  Express Server  (Node.js / TypeScript)                   │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Middleware                                          │ │
│  │  requireAuth  ──── verifies Firebase ID token       │ │
│  │               ──── loads user from cache or DB      │ │
│  │               ──── enforces email domain if set     │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │  req.user                       │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │  Routes                                              │ │
│  │  /api/apps          /api/services                   │ │
│  │  /api/deployments   /api/logs                       │ │
│  │  /api/projects      /api/admin                      │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                 │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │  Models                                              │ │
│  │  registry.ts  ──── RBAC + DB queries                │ │
│  │  users.ts     ──── user upsert / project assignment │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                 │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │  Prisma ORM  ──── SQLite (default), MySQL, Postgres  │ │
│  │                                                      │ │
│  │  users            user_projects                      │ │
│  │  registry_projects    registry_environments          │ │
│  │  registry_applications   registry_services           │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  In-memory Cache  (cache/)                           │ │
│  │  ── user records cached 5 min after DB lookup        │ │
│  │  ── pluggable: swap MemoryCache for Redis            │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Background sync  (sync.ts)                          │ │
│  │  ── runs on startup                                  │ │
│  │  ── re-runs lazily every 10 min (after any request) │ │
│  └──────────────────────┬──────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │  Coolify REST API
┌─────────────────────────▼────────────────────────────────┐
│  Coolify Instance                                         │
│  /api/v1/projects  /api/v1/applications  /api/v1/services│
│  /api/v1/deployments  (logs embedded in deployment obj)  │
└──────────────────────────────────────────────────────────┘
```

In production a single container serves both the API and the pre-built React SPA (Express `static` middleware). No separate web server needed.

---

## Authentication & authorisation flow

```
Browser                    Server                       Firebase
   │                          │                              │
   │──── GET /api/config ────▶│                              │
   │◀─── Firebase Web config ─│  (public, no auth)           │
   │                          │                              │
   │──── Google sign-in ─────▶│                              │
   │◀─── ID token ────────────│                              │
   │                          │                              │
   │──── GET /api/apps ──────▶│                              │
   │   (Bearer <ID token>)    │──── verifyIdToken() ────────▶│
   │                          │◀─── { uid, email } ──────────│
   │                          │                              │
   │                          │── cache.get(uid)             │
   │                          │   hit → skip DB              │
   │                          │   miss → upsertUser()        │
   │                          │          cache.set(uid, 5min)│
   │                          │                              │
   │                          │── check ALLOWED_EMAIL_DOMAIN │
   │                          │   (403 if mismatch)          │
   │                          │                              │
   │                          │── resolve envUuids           │
   │                          │   (projects → environments)  │
   │                          │                              │
   │                          │── filter registry_applications│
   │                          │   WHERE env_uuid IN (...)    │
   │◀─── filtered apps ───────│                              │
```

**Token verification** is done on every request — there is no session. The Firebase ID token (JWT) is verified with the Firebase Admin SDK. It expires after 1 hour; the client SDK refreshes it automatically.

**User cache**: after the first DB lookup, the user record is cached in memory for 5 minutes. The cache is immediately invalidated when an admin changes a user's role or project assignments. This is a pluggable `CacheStore` — swappable for Redis without changing anything outside `server/src/cache/`.

**Firebase config at runtime**: the client fetches `GET /api/config` (unauthenticated) on startup to get the Firebase Web SDK config. No Firebase keys are baked into the client bundle — the Docker image contains zero personal data.

**Super-admin shortcut**: if the authenticated email matches `SUPER_ADMIN_EMAIL` and the user's role is still `user`, it is promoted to `super_admin` in the same request before the route handler runs.

---

## Cache system

```
server/src/cache/
  types.ts    ← CacheStore interface (get / set / del)
  memory.ts   ← MemoryCache — TTL-based in-process Map
  factory.ts  ← createCache(provider) → CacheStore
  index.ts    ← initCache() called at startup; getCache() used everywhere
```

`initCache('memory')` is called once in `server/src/index.ts`. All consumers call `getCache()` — they never import a concrete implementation. To swap in Redis:

1. Implement `CacheStore` in `cache/redis.ts`
2. Add `case 'redis'` in `cache/factory.ts`
3. Change `initCache('redis')` in `index.ts`

Nothing else changes.

**Current uses:**
- `middleware/auth.ts` — caches user records by Firebase UID, TTL 5 min. Invalidated on role/project changes via `clearUserCache()`.

---

## Registry sync

The registry is a local DB cache of everything in Coolify. It exists so:
1. The UI is fast — reads hit SQLite, not the Coolify API over the network
2. RBAC can be enforced offline — project/env UUIDs are known without calling Coolify

### Sync algorithm (`server/src/sync.ts`)

```
syncRegistry()
  ├── parallel fetch from Coolify:
  │   ├── GET /api/v1/projects/{uuid}  → projects + environments (with IDs)
  │   ├── GET /api/v1/applications     → all apps (all build pack types)
  │   └── GET /api/v1/services         → all services
  │
  ├── build envIdToInfo map (numeric environment ID → uuid + name)
  │   used to resolve app.environmentId → environment UUID
  │
  ├── upsert all fetched records
  │   (INSERT ... ON CONFLICT DO UPDATE, always sets deletedAt = NULL)
  │   → soft-recovers anything previously soft-deleted
  │
  ├── for all apps:
  │   └── GET /api/v1/applications/{uuid}/deployments
  │       → stores latest deployment uuid + status
  │
  └── soft-delete anything not in the fetched set
      (UPDATE ... SET deletedAt = now WHERE uuid NOT IN (...))
```

**Trigger points:**
- On server startup (blocks until complete so the first request hits a warm registry)
- Lazily after any API response via `maybeBackgroundSync()` — fires if `lastSyncAt` is >10 min ago
- On force-refresh (`?refresh=true`) — same lazy fire, but the HTTP response returns whatever is in the DB immediately

**Concurrency guard**: `syncInProgress` flag prevents overlapping syncs. `lastSyncAt` is optimistically advanced before the sync starts to prevent double-fires.

---

## RBAC model

```
User
 └── user_projects[]  (project UUIDs assigned by admin)
      └── registry_projects
           └── registry_environments
                └── registry_applications  ← filtered by environment UUID
                └── registry_services      ← filtered by environment UUID
```

`super_admin` role bypasses all project filtering — they see every app and service.

Key functions in `server/src/models/registry.ts`:

| Function | What it does |
|---|---|
| `getAllowedEnvUuids(user)` | Returns `'all'` for super_admin, or a `Set<string>` of environment UUIDs the user can access |
| `findApplications(envUuids)` | Queries registry for all non-deleted apps in those environments |
| `canAccessApplication(user, appUuid)` | Used per-request to gate log/deployment endpoints |
| `findServices(envUuids)` | Same as `findApplications` for services |
| `canAccessService(user, serviceUuid)` | Per-request gate for service endpoints |

---

## Log polling

Logs are fetched via stateless HTTP polling. The client owns an `offset` counter.

```
Client                              Server                        Coolify
  │                                    │                              │
  │── GET /api/logs/{uuid}?offset=0 ──▶│── GET deployment + logs ────▶│
  │◀── { lines[0..N], total:N, done } ─│◀────────────────────────────│
  │   (client sets offset = N)         │                              │
  │                                    │                              │
  │  (2 s later)                       │                              │
  │── GET /api/logs/{uuid}?offset=N ──▶│── GET deployment + logs ────▶│
  │◀── { lines[N..M], total:M, done } ─│◀────────────────────────────│
  │   (append-only, no duplicates)     │                              │
  │                                    │                              │
  │  (done = true → stop polling)      │                              │
```

**Server side** (`server/src/routes/logs.ts`): fetches all log entries, sorts by `order`, strips ANSI codes, returns `all.slice(offset)`. Completely stateless.

**Client side** (`client/src/components/LogViewer.tsx`): `totalRef` holds the offset. On each response, appends `result.lines` and advances `totalRef.current = result.total`. Stops when `result.done === true`.

Terminal statuses that stop polling: `finished`, `failed`, `cancelled`.

---

## Deployment trigger flow

```
User clicks "Deploy Now"
       │
       ▼
POST /api/apps/{uuid}/deploy
       │
       ▼
coolify.triggerApplicationDeploy(uuid)
       │
       ▼  returns { deploymentUuid }
       │
Client redirects to /deployments/{deploymentUuid}
       │
       ▼
LogViewer starts polling immediately
```

The deployment list page does a hard refresh (`?refresh=true`) after triggering so the new `in_progress` entry appears right away.

---

## Database schema

Managed by Prisma ORM. Schema source of truth is `server/prisma/schema.prisma.template`. At container startup, the startup script substitutes `__DB_PROVIDER__` with the `$DB_PROVIDER` env var, generates `schema.prisma`, and runs `prisma db push`. The generated `schema.prisma` is never committed.

### User tables

| Table | Purpose |
|---|---|
| `users` | One row per signed-in user. Stores Firebase UID, email, name, photo, role. |
| `user_projects` | Join table: which Coolify project UUIDs each user can access. |

### Registry tables (Coolify mirror)

| Table | Purpose |
|---|---|
| `registry_projects` | Coolify projects. |
| `registry_environments` | Environments nested inside projects. |
| `registry_applications` | All Coolify applications (all build pack types). |
| `registry_services` | Coolify services. |

All registry tables have `deleted_at` (soft delete) and `synced_at` (last seen in Coolify response).

---

## Compatibility notes

### Coolify API coupling

The Coolify API is the biggest external dependency. A few rules that protect us when Coolify releases new versions:

- **`COOLIFY_API_VERSION`** is a config var (default `v1`). If Coolify ships `/api/v2`, operators can switch without a code change.
- All fields on Coolify response types in `coolify/types.ts` that are not guaranteed to be present use `?`. The `parseLogEntries` function returns `[]` on any parse failure. This means new Coolify versions that add or rename fields degrade gracefully (missing data, not crashes).
- `started_at` on `CoolifyDeployment` is declared optional and falls back to `created_at`. If Coolify adds a real `started_at` field in a future version, the normaliser picks it up automatically.

### Database migrations

All schema changes must be **additive only**:

- **Add** columns — always with a default value or nullable so existing rows are valid
- **Never** drop or rename columns — SQLite does not support these operations
- **Never** add `NOT NULL` columns without a `@default` — this fails on existing data
- Edit `server/prisma/schema.prisma.template`, never `schema.prisma` directly

If you need to remove a column logically, soft-retire it: keep the column, stop writing to it, ignore it in queries.

### Role enum

`users.role` is `['user', 'super_admin']`. Adding a new role requires:
1. A schema change in `schema.prisma.template`
2. Updates to `requireAdmin` in `middleware/auth.ts`
3. Updates to every route that checks `req.user?.role`
4. Updates to the admin UI in `UserManagement.tsx`

Do not add roles without considering all four touch points.

### Client ↔ server DTO contract

The client types in `client/src/types.ts` must match the server DTO shapes in `server/src/routes/apps.ts`. They are not auto-generated — if you add a field to a server DTO, add it to the client type too, and make it optional (`field?: T`) so old client bundles (before a rebuild) don't break on the new JSON.

---

## Coolify adapter pattern

The Coolify API is the biggest external dependency. To isolate version changes:

```
coolify/
  adapter.ts   ← CoolifyAdapter interface + normalised types (stable public contract)
  client.ts    ← factory: createCoolifyClient(version) → CoolifyAdapter singleton
  v1.ts        ← Coolify v1 implementation (raw API types are private to this file)
```

**Adding a new Coolify API version:**
1. Create `coolify/vN.ts` implementing `CoolifyAdapter`
2. Register it in `client.ts`'s `adapters` map
3. Set `COOLIFY_API_VERSION=vN` in `.env`

Nothing else changes. `sync.ts`, `routes/`, and `models/` depend only on `CoolifyAdapter` and the normalised types — not on any version-specific shapes.

---

## File map

```
/
├── Dockerfile              ← production multi-stage build
├── docker-compose.yml      ← dev (hot reload, volume mounts)
├── docker-compose.prod.yml ← production (single container)
├── .env.example
│
├── client/
│   └── src/
│       ├── api.ts               ← all fetch calls, auth token injection
│       ├── types.ts             ← shared TypeScript types (must match server DTOs)
│       ├── lib/
│       │   ├── firebase.ts      ← deferred Firebase init (config fetched at runtime)
│       │   └── utils.ts         ← cn(), parseApiError()
│       ├── contexts/
│       │   └── AuthContext.tsx  ← Firebase auth state, auto-token refresh
│       ├── components/
│       │   ├── Layout.tsx       ← shell with breadcrumbs + nav
│       │   ├── LogViewer.tsx    ← polling log display
│       │   ├── StatusBadge.tsx  ← parses Coolify compound statuses
│       │   ├── AppCard.tsx      ← dashboard app tile
│       │   └── ErrorAlert.tsx   ← shared error display
│       └── pages/
│           ├── Dashboard.tsx        ← app/service grid, deploying banner
│           ├── AppDeployments.tsx   ← deployment history table
│           ├── DeploymentView.tsx   ← single deployment + LogViewer
│           ├── UserManagement.tsx   ← admin: assign projects to users
│           └── Login.tsx            ← Google sign-in screen
│
└── server/
    └── src/
        ├── index.ts        ← Express setup, static serving, startup sync
        ├── config.ts       ← env var loading + validation
        ├── sync.ts         ← registry sync + background trigger
        ├── cache/
        │   ├── types.ts    ← CacheStore interface
        │   ├── memory.ts   ← MemoryCache implementation
        │   ├── factory.ts  ← createCache(provider) factory
        │   └── index.ts    ← initCache() / getCache() entry point
        ├── coolify/
        │   ├── adapter.ts  ← CoolifyAdapter interface + normalised types
        │   ├── client.ts   ← factory (picks adapter by COOLIFY_API_VERSION)
        │   └── v1.ts       ← Coolify v1 implementation
        ├── db/
        │   ├── index.ts    ← Prisma client singleton
        │   └── seed.ts     ← super_admin promotion on startup
        ├── middleware/
        │   └── auth.ts     ← Firebase token verification, user cache, domain check
        ├── models/
        │   ├── registry.ts     ← RBAC queries, env UUID resolution
        │   ├── users.ts        ← user CRUD, project assignment
        │   └── deployments.ts  ← deployment_cache DB reads/writes
        └── routes/
            ├── apps.ts         ← GET /api/apps, POST /api/apps/:uuid/deploy
            ├── services.ts     ← GET /api/services
            ├── deployments.ts  ← GET /api/deployments/:uuid
            ├── logs.ts         ← GET /api/logs/:uuid (polling)
            ├── projects.ts     ← GET /api/projects
            ├── auth.ts         ← GET /api/auth/me
            └── admin.ts        ← user management endpoints
```
