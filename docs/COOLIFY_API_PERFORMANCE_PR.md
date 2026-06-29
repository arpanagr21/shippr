# Coolify API Performance — `GET /deployments/applications/:uuid`

> Analysis of `DeployController.php`, `Application.php`, `ApplicationDeploymentQueue.php`, and the original migration.

---

## The Problem

`GET /api/v1/deployments/applications/:uuid` is slow, and it gets worse as the Coolify instance grows. Measured on a real instance: **~1.2s, 294KB** for an app with only 3 deployments — 93% of that payload is log data the caller never asked for.

There are three concrete issues, ordered by actual impact.

---

## Issue 1 — No index on `application_id` (biggest impact)

### What happens

The original migration creates the table with no index on `application_id`:

```php
Schema::create('application_deployment_queues', function (Blueprint $table) {
    $table->id();
    $table->string('application_id'); // no index
    $table->string('deployment_uuid')->unique();
    // ...
});
```

So this query in `Application::deployments()`:

```php
ApplicationDeploymentQueue::where('application_id', $this->id)
    ->orderBy('created_at', 'desc')
    ->skip($skip)
    ->take($take)
    ->get();
```

Does a **full table scan** across every deployment from every application on the instance. The more apps and deployments on the server, the slower every single call to this endpoint gets — regardless of which app you're querying.

The `count()` call immediately before also does a full scan.

### Bonus issue — type mismatch

`application_id` is declared as `string` but `Application.id` is an integer (`unsignedBigInteger`). MySQL does implicit type casting on the comparison, which can **silently prevent the index from being used** even after you add one.

### Fix

One new migration:

```php
Schema::table('application_deployment_queues', function (Blueprint $table) {
    $table->unsignedBigInteger('application_id')->change();
    $table->index(['application_id', 'created_at']);
});
```

### Impact

- Full table scan → index seek: **O(n total deployments) → O(log n)**
- The `count()` query benefits from the same index
- Effect compounds as the instance grows — this is what makes large Coolify instances noticeably slower than small ones on this endpoint

---

## Issue 2 — `logs` always loaded and always returned

### What happens

`Application::deployments()` calls `->get()` with no column selection:

```php
$deployments = $deployments->skip($skip)->take($take)->get(); // SELECT *
```

The `logs` column is a `TEXT` field storing a full JSON array of every log line from the deployment. In InnoDB with DYNAMIC row format (default), TEXT values over ~8KB are stored in **overflow pages** — separate disk pages that MySQL must follow a pointer to read. For apps with large deployments this means extra disk reads per row, per request.

`get_application_deployments` then returns the collection directly:

```php
return response()->json($deployments);
```

`removeSensitiveData` is **never called** on this endpoint. Logs are always in the response, for every caller, always.

### Measured payload breakdown

| | Size |
|--|--|
| Total response (3 deployments) | 294 KB |
| Of which: `logs` field | 273 KB (93%) |
| Of which: actual metadata | 21 KB (7%) |

### Fix

Add an optional `with_logs` parameter (default `false`) and push the exclusion to the query level:

```php
public function deployments(int $skip = 0, int $take = 10, ?string $pullRequestId = null, bool $withLogs = false)
{
    $query = ApplicationDeploymentQueue::where('application_id', $this->id)
        ->orderBy('created_at', 'desc');

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

In `get_application_deployments`, pass `with_logs` from the request:

```php
$deployments = $application->deployments(
    $skip, $take, null,
    $request->boolean('with_logs', false)
);
```

### Impact

- MySQL never reads overflow pages for `logs`: removes extra disk I/O per row
- Response: **294 KB → ~21 KB**
- Realistic response time improvement: **~100–300ms** depending on MySQL buffer pool state

---

## Issue 3 — No HTTP caching headers

### What happens

The endpoint returns no `ETag`, `Last-Modified`, or `Cache-Control` headers. Tools that poll this endpoint (monitoring dashboards, CI integrations) must download the full response every time even when nothing has changed.

### Fix

Add an `ETag` based on the latest `updated_at` in the result set:

```php
$etag = md5($deployments->max('updated_at') . $count);

if ($request->header('If-None-Match') === $etag) {
    return response()->json(null, 304);
}

return response()->json($result)->header('ETag', $etag);
```

### Impact

- Polling clients that send `If-None-Match` get a **304 No Content** (zero body) when nothing changed
- Eliminates payload transfer entirely between deployments
- No breaking change — clients that don't send `If-None-Match` are unaffected

---

## Summary

| Issue | Change | Impact |
|-------|--------|--------|
| No index on `application_id` | New migration: type fix + composite index | Full table scan → index seek. Biggest win, grows with instance size |
| Logs always loaded + returned | `select()` without logs by default, `?with_logs=true` opt-in | 294 KB → 21 KB, removes overflow page reads |
| No HTTP caching | Add `ETag` + `304` support | Zero-body responses for polling clients when nothing changed |

---

## Reproduction

```bash
# Measure current response
curl -s -o /dev/null -w "size: %{size_download} bytes | time: %{time_total}s\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$COOLIFY_URL/api/v1/deployments/applications/$APP_UUID?skip=0&take=20"

# After fix — expected: ~21 KB, meaningfully faster on large instances
```
