# Docker Hub Release — DO NOT COMMIT

Registry: `arpanagr/shippr`
Platforms: `linux/amd64` + `linux/arm64`

---

## One-time setup (BuildKit multi-platform builder)

```bash
docker buildx create --name shippr-builder --driver docker-container --bootstrap
docker buildx use shippr-builder
docker login
```

Verify:
```bash
docker buildx inspect --bootstrap
# should list linux/amd64 and linux/arm64 under platforms
```

---

## Build & Push (latest only)

```bash
# Server
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t arpanagr/shippr:server-latest \
  ./server

# Client
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t arpanagr/shippr:client-latest \
  ./client
```

`--push` sends directly to Docker Hub as a multi-arch manifest.
No separate `docker push` needed.

---

## Verify the manifest

```bash
docker buildx imagetools inspect arpanagr/shippr:server-latest
docker buildx imagetools inspect arpanagr/shippr:client-latest
# should show both amd64 and arm64 digests
```

---

## Verify nothing sensitive is baked in

```bash
# Run on native arch — should return nothing
docker run --rm --platform linux/amd64 arpanagr/shippr:server-latest \
  find /app -name "*.sqlite" -o -name "*.db" -o -name ".env"
```

---

## Checklist before pushing

- [ ] No `.sqlite` / `.db` files in image (bind-mount only)
- [ ] `.env` not baked in
- [ ] `SHIPPR_COOLIFY_TOKEN` and other secrets are runtime env vars only
- [ ] Tested locally with `docker compose up` before pushing
- [ ] `docker buildx inspect` shows both amd64 + arm64
