# AGENTS.md — Ground rules for AI agents working on Shippr

Read this before touching any file. These rules exist because several have been learned the hard way.

---

## What this project is

Shippr is a self-hosted dashboard that sits in front of a [Coolify](https://coolify.io) instance. It adds per-user project access control, live deployment log polling, and a clean UI. It is **not** a general-purpose deployment tool — every feature decision is made in the context of Coolify.

Authoritative docs:
- `docs/ARCHITECTURE.md` — how everything fits together
- `docs/CONTRIBUTING.md` — dev setup and PR process
- `README.md` — user-facing setup guide

---

## Non-negotiable rules

Break any of these and the PR will not be merged.

1. **No raw Coolify API types outside `server/src/coolify/v*.ts`.** All Coolify response shapes (snake_case, version-specific) are private to adapter files. Everything else imports from `coolify/adapter.ts` only.

2. **No `VITE_` prefixed variables anywhere.** The client fetches Firebase config at runtime from `GET /api/config` — nothing is baked into the build. The Docker image contains zero personal data. Do not add `VITE_*` vars to `.env`, `.env.example`, compose files, or the Dockerfile.

3. **New DB fields must be optional (`?`) in `schema.prisma`.** Prisma's `db push` can add nullable columns to existing tables; required fields without defaults break on existing data.

4. **No dropping or renaming fields in `schema.prisma`.** Schema changes are additive-only. Soft-retire fields instead (stop writing, ignore in queries). Prisma `db push` with destructive changes requires `--accept-data-loss`, which we never pass.

5. **No hardcoded domain names, emails, API versions, or URLs** that should come from config. All of these have env vars. Check `server/src/config.ts` before reaching for a string literal.

6. **No `any` without a comment explaining why.**

7. **No new auth providers.** Firebase Auth (Google sign-in) is the only supported auth mechanism. Do not add sessions, JWTs of your own, OAuth flows, or any other auth layer.

---

## The "if you change X, update Y" map

This is the most important section. Every change has propagation requirements. Missing one is the most common mistake.

| If you change / add… | You must also update… |
|---|---|
| A server env var | `server/src/config.ts` · `.env.example` · README env var table · `docker-compose.prod.yml` environment block |
| A DB table or column | `server/prisma/schema.prisma.template` · restart server (startup script runs `prisma generate` + `prisma db push` automatically) |
| A server HTTP response shape | `client/src/types.ts` (new fields must be `optional?`) · `client/src/api.ts` if the fetch function signature changes |
| `CoolifyAdapter` interface (`coolify/adapter.ts`) | Every adapter file that implements it (`coolify/v1.ts`, any future `vN.ts`) |
| `getAllowedEnvUuids` or RBAC logic | Every route that calls `canAccessApplication` / `canAccessService` / `findApplications` |
| A new Express route | `server/src/index.ts` (register it) · `client/src/api.ts` (add typed fetch) |
| `server/prisma/schema.prisma` models | Run `npx prisma generate` to regenerate the client; models in `server/src/models/` pick up changes automatically |
| `.env.example` | README env var table (keep in sync) |

---

## File ownership — one fact, one place

| Concern | Canonical file |
|---|---|
| All env var definitions and defaults | `server/src/config.ts` |
| Coolify API version-specific shapes | `server/src/coolify/v1.ts` (private) |
| Stable Coolify contract the app depends on | `server/src/coolify/adapter.ts` |
| Adapter selection | `server/src/coolify/client.ts` |
| RBAC and project access | `server/src/models/registry.ts` |
| User CRUD | `server/src/models/users.ts` |
| Deployment history DB cache | `server/src/models/deployments.ts` |
| Registry sync from Coolify | `server/src/sync.ts` |
| DB schema | `server/prisma/schema.prisma.template` (never edit `schema.prisma` directly — it is generated) |
| In-memory / Redis cache | `server/src/cache/` — interface in `types.ts`, impl in `memory.ts`, factory in `factory.ts` |
| All client fetch functions | `client/src/api.ts` |
| Shared client TypeScript types | `client/src/types.ts` |
| Firebase init | `client/src/lib/firebase.ts` |
| Auth middleware | `server/src/middleware/auth.ts` |

Do not put logic that belongs in one of these files somewhere else.

---

## Safe to do without asking

- Add a new nullable column to an existing table (with migration)
- Add a new optional field to a server DTO + matching optional field in `client/src/types.ts`
- Add a new route file + register it + add fetch function to `api.ts`
- Add a new page to the client under `client/src/pages/`
- Add a new shadcn/ui component under `client/src/components/ui/`
- Add a new env var (following the propagation rules above)
- Refactor inside a single file without changing its public exports

---

## Things that look safe but aren't

- **Editing `coolify/adapter.ts`** — changing the interface breaks every adapter. Think hard before adding or removing interface methods.
- **Editing `schema.prisma` directly** — it is generated at startup from `schema.prisma.template`. Changes will be overwritten on next container start.
- **Adding a `required` field to a server DTO** — old client bundles will break. New fields must always be `optional?`.
- **Reading `req.user` without `!`** — `requireAuth` guarantees it's set for all `/api` routes, but TypeScript doesn't know that. Use `req.user!` consistently.
- **Touching `server/src/db/seed.ts`** — this runs on every server start. Side effects must be idempotent.
- **Adding a direct Coolify `fetch()` call anywhere outside `coolify/v*.ts`** — all Coolify communication goes through the adapter.

---

## DB schema workflow (Prisma)

`server/prisma/schema.prisma` is **generated at container startup** — do not edit it directly and do not commit it. The source of truth is `server/prisma/schema.prisma.template`. The startup script (`server/scripts/start.sh` / `start-dev.sh`) substitutes `__DB_PROVIDER__` with the `$DB_PROVIDER` env var, then runs `prisma generate` and `prisma db push`.

```bash
# 1. Edit server/prisma/schema.prisma.template

# 2. Restart the container — startup script regenerates schema.prisma and applies changes
docker compose restart server

# To switch databases:
#   Set DB_PROVIDER=mysql (or postgresql) and DATABASE_URL=... in .env, then restart.
#   No code changes needed — schema.prisma is regenerated with the new provider on startup.
```

Do not run destructive schema changes — additive-only (add models/fields, never drop or rename).

---

## Adding a new Coolify API version

```
1. Create server/src/coolify/vN.ts
   - Implement CoolifyAdapter from ./adapter
   - Keep all raw API types (snake_case) private to this file
   - Map everything to NormalizedXxx types before returning

2. Register in server/src/coolify/client.ts:
   adapters['vN'] = () => new VNAdapter();

3. Set COOLIFY_API_VERSION=vN in .env

4. Update docs/ARCHITECTURE.md "Coolify adapter pattern" section
```

Nothing outside `coolify/` changes.

---

## Compatibility rules (enforced on all PRs)

- **Backward**: existing `.env` files and DB data must keep working after an upgrade. No removed env vars without a deprecation period, no breaking schema changes.
- **Forward**: new fields added to HTTP responses must be optional so old clients don't crash on new server responses.
- **Coolify version isolation**: v1 quirks stay in `v1.ts`. The adapter normalises everything so routes and sync never see version-specific shapes.

---

## What this project will never support

- Non-Coolify backends
- Alternative auth providers (Firebase is the only one; do not add sessions, custom JWTs, or other OAuth flows)
- Selling access to Shippr as a SaaS — see LICENSE
- `VITE_` vars directly in `.env`
- Bare `NOT NULL` DB columns without defaults
