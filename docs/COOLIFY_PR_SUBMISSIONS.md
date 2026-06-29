# Coolify PRs — Ready to Submit

> Target branch: **`next`** (never `v4.x`). Create a GitHub issue first, then open the PR linking to it.

---

## Before anything — setup

```bash
# Fork coolify on GitHub, then:
git clone https://github.com/YOUR_FORK/coolify.git
cd coolify
cp .env.development.example .env
spin up

# Verify dev instance at http://localhost:8000
# Login: test@example.com / password
```

After making changes, always run migrations:
```bash
docker exec -it coolify php artisan migrate
```

---

## PR 1 — Index on `application_id`

### Step 1 — Create GitHub issue first

**Issue title:**
```
[Performance] GET /deployments/applications/:uuid does full table scan — missing index on application_id
```

**Issue body:**
```
## Problem

`GET /api/v1/deployments/applications/:uuid` performs a full table scan on
`application_deployment_queues` for every request. The `application_id` column
has no index, so MySQL reads every row across all apps on the instance.

There is also a type mismatch: `application_id` is declared as `string` but
`Application.id` is `unsignedBigInteger`. This causes implicit casting on every
comparison, which silently prevents index usage even if one is manually added.

As the total number of deployments on an instance grows, every call to this
endpoint gets linearly slower. There is no ceiling.

## Reproduction

Run `EXPLAIN` on the query:
```sql
EXPLAIN SELECT * FROM application_deployment_queues
WHERE application_id = '1'
ORDER BY created_at DESC
LIMIT 20;
```
`type` will be `ALL` — full table scan.

## Expected

`type` should be `ref` using an index on `(application_id, created_at)`.
```

---

### Step 2 — Branch

```bash
git checkout next
git pull upstream next
git checkout -b perf/deployment-queue-index
```

---

### Step 3 — Create the migration

```bash
docker exec -it coolify php artisan make:migration add_index_to_application_deployment_queues
```

**Migration content:**
```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('application_deployment_queues', function (Blueprint $table) {
            $table->unsignedBigInteger('application_id')->change();
            $table->index(['application_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('application_deployment_queues', function (Blueprint $table) {
            $table->dropIndex(['application_id', 'created_at']);
            $table->string('application_id')->change();
        });
    }
};
```

Run and verify:
```bash
docker exec -it coolify php artisan migrate

# Verify index was created
docker exec -it coolify php artisan tinker
# >>> DB::select("SHOW INDEX FROM application_deployment_queues");
```

---

### Step 4 — PR title & description

**Title:**
```
fix(perf): add composite index on application_deployment_queues(application_id, created_at)
```

**Description:**
```
## What

Adds a composite index on `(application_id, created_at)` to the
`application_deployment_queues` table, and fixes the column type from `string`
to `unsignedBigInteger` to match `Application.id`.

## Why

`GET /api/v1/deployments/applications/:uuid` currently does a full table scan
on every request. The `application_id` column was declared as `string` in the
original migration but `Application.id` is an integer — this type mismatch
causes MySQL to cast values on every comparison, silently preventing any index
from being used.

With no index, MySQL reads every deployment row across every application on the
instance to find the ones matching the requested app. As total deployments grow,
this gets linearly slower.

## How to test

Run before and after the migration:

```sql
EXPLAIN SELECT * FROM application_deployment_queues
WHERE application_id = 1
ORDER BY created_at DESC
LIMIT 20;
```

Before: `type = ALL` (full table scan)
After: `type = ref`, `key = application_deployment_queues_application_id_created_at_index`

Or from artisan:
```bash
docker exec -it coolify php artisan tinker
>>> DB::select("EXPLAIN SELECT * FROM application_deployment_queues WHERE application_id = 1 ORDER BY created_at DESC LIMIT 20");
```

## Breaking changes

None. Migration only. No API or behavior changes.

Closes #ISSUE_NUMBER
```

---

## PR 2 — Exclude logs from deployment list by default

> Open this only after PR 1 is merged.

### Step 1 — Create GitHub issue first

**Issue title:**
```
[Performance] GET /deployments/applications/:uuid always returns full logs field — 93% of response payload is unused data
```

**Issue body:**
```
## Problem

`GET /api/v1/deployments/applications/:uuid` always returns the full `logs`
column in every response. Callers fetching a deployment list almost never
need logs — they need status, commit, and timestamps.

The `logs` column stores a full JSON array of every log line. In InnoDB with
DYNAMIC row format, large TEXT values are stored in overflow pages — MySQL
must do extra disk reads per row even if the caller discards the data.

`get_application_deployments` never calls `removeSensitiveData()`, so logs
are returned unconditionally for all callers.

## Measured on a real Coolify instance

| | |
|--|--|
| Response size for 3 deployments | 294 KB |
| Of which `logs` | 273 KB (93%) |
| Actual metadata | 21 KB (7%) |

## Proposal

- Default behavior: exclude `logs` from the list response (no breaking change
  for callers that don't use logs in the list)
- Opt-in: `?with_logs=true` for callers that need logs in the list response
```

---

### Step 2 — Branch

```bash
git checkout next
git pull upstream next
git checkout -b perf/deployment-list-exclude-logs
```

---

### Step 3 — Code changes

**`app/Models/Application.php`** — update `deployments()`:
```php
public function deployments(int $skip = 0, int $take = 10, ?string $pullRequestId = null, bool $withLogs = false)
{
    $query = ApplicationDeploymentQueue::where('application_id', $this->id)
        ->orderBy('created_at', 'desc');

    if ($pullRequestId) {
        $query->where('pull_request_id', $pullRequestId);
    }

    if (! $withLogs) {
        $query->select([
            'id', 'deployment_uuid', 'application_id', 'status',
            'commit', 'commit_message', 'pull_request_id', 'force_rebuild',
            'is_webhook', 'created_at', 'updated_at', 'started_at', 'finished_at',
            'server_id', 'application_name', 'server_name', 'deployment_url',
            'rollback', 'current_process_id', 'docker_registry_image_tag',
        ]);
    }

    $count = $query->count();
    $deployments = $query->skip($skip)->take($take)->get();

    return ['count' => $count, 'deployments' => $deployments];
}
```

**`app/Http/Controllers/Api/DeployController.php`** — update `get_application_deployments()`:
```php
$deployments = $application->deployments(
    $skip,
    $take,
    null,
    $request->boolean('with_logs', false)
);
```

Verify in dev:
```bash
# Without logs (default)
curl -s http://localhost:8000/api/v1/deployments/applications/$APP_UUID \
  -H "Authorization: Bearer $TOKEN" | wc -c

# With logs (opt-in)
curl -s "http://localhost:8000/api/v1/deployments/applications/$APP_UUID?with_logs=true" \
  -H "Authorization: Bearer $TOKEN" | wc -c
```

---

### Step 4 — PR title & description

**Title:**
```
fix(perf): exclude logs column from deployment list response by default
```

**Description:**
```
## What

Adds a `with_logs` parameter (default `false`) to `Application::deployments()`
and exposes `?with_logs=true` as an opt-in query parameter on
`GET /api/v1/deployments/applications/:uuid`.

## Why

The list endpoint always returned the full `logs` TEXT column, which is 93% of
the response payload in real usage. Callers fetching a deployment list need
status, commit, and timestamps — not full log output.

In InnoDB with DYNAMIC row format, large TEXT values are stored in overflow
pages. Without `select()`, MySQL reads those pages for every returned row even
though the data gets discarded. Excluding the column at query level eliminates
those reads entirely.

Also, `get_application_deployments` never called `removeSensitiveData()`, so
logs were returned unconditionally regardless of the `can_read_sensitive` flag.
This change also fixes that gap by default.

## Measured

| | Before | After |
|--|--|--|
| Response (3 deployments) | 294 KB | 21 KB |
| Logs in payload | Always | Only with `?with_logs=true` |

## How to test

```bash
# Default — no logs
curl -s "http://localhost:8000/api/v1/deployments/applications/$UUID" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -c '"logs"'
# Expected: 0

# Opt-in — with logs
curl -s "http://localhost:8000/api/v1/deployments/applications/$UUID?with_logs=true" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | grep -c '"logs"'
# Expected: number of deployments returned
```

## Breaking changes

Callers that relied on getting logs from the list endpoint must add
`?with_logs=true`. The dedicated single-deployment endpoint
`GET /api/v1/deployments/:uuid` is unaffected and continues to return logs.

Closes #ISSUE_NUMBER
```

---

## PR 3 — ETag / 304 support (optional, do last)

### Step 1 — Create GitHub issue first

**Issue title:**
```
[Performance] Add ETag and 304 support to deployment list endpoint to avoid redundant polling payloads
```

### Step 2 — Branch

```bash
git checkout next
git pull upstream next
git checkout -b feat/deployment-list-etag
```

### Step 3 — Code change

**`app/Http/Controllers/Api/DeployController.php`**:
```php
$result = $application->deployments($skip, $take, null, $request->boolean('with_logs', false));

$etag = md5($result['count'] . collect($result['deployments'])->max('updated_at'));

if ($request->header('If-None-Match') === $etag) {
    return response()->json(null, 304);
}

return response()->json($result)->header('ETag', $etag);
```

### Step 4 — PR title

```
feat: add ETag and 304 Not Modified support to deployment list endpoint
```

---

## Submission checklist (each PR)

- [ ] Issue created and number noted
- [ ] Branched from `next` (not `v4.x`)
- [ ] `spin up` + `php artisan migrate` tested locally
- [ ] `EXPLAIN` output or `wc -c` benchmark captured for description
- [ ] PR description includes: what, why, how to test, breaking changes
- [ ] PR links to issue (`Closes #ISSUE_NUMBER`)
- [ ] PR is out of draft immediately when ready
- [ ] Can explain every line of code without AI help
