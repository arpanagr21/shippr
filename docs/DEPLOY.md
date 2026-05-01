# Deploying Shippr with Docker

Shippr ships as a single Docker image that bundles the API server and the pre-built React frontend. The server serves the UI as static files, so one container is all you need.

**Image:** `arpanagr/shippr:latest` — multi-platform (linux/amd64, linux/arm64)

---

## Prerequisites

- Docker (and optionally Docker Compose) on your server
- A running [Coolify](https://coolify.io) instance
- A free [Firebase](https://firebase.google.com) project for Google sign-in

---

## 1. Firebase Setup

Shippr uses Firebase Authentication for Google sign-in. You need two sets of credentials from the same Firebase project.

### 1a. Create the project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
2. **Authentication → Sign-in method → Google → Enable**
3. **Authentication → Settings → Authorized domains → Add domain** — add your server's domain (e.g. `shippr.your-company.com`)

### 1b. Server credentials (Admin SDK)

These verify tokens on the backend. They are **runtime secrets — never baked into the image.**

1. **Project Settings → Service accounts → Generate new private key** → download the JSON
2. Copy these three values into your env:

```
FIREBASE_PROJECT_ID=        ← "project_id"   from the JSON
FIREBASE_CLIENT_EMAIL=      ← "client_email"  from the JSON
FIREBASE_PRIVATE_KEY=       ← "private_key"   from the JSON (full -----BEGIN…END----- block)
```

> The private key contains literal `\n` characters. Wrap the entire value in double quotes in your `.env` file.

### 1c. Client credentials (Web SDK)

These are used by the browser to sign in. They are **public values** — safe to expose.

1. **Project Settings → Your apps → Add app → Web** (if you haven't added one yet)
2. Copy the `firebaseConfig` object values:

```
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=
FIREBASE_STORAGE_BUCKET=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_APP_ID=
```

The browser fetches these at runtime from `/api/config` — no rebuild required if they change.

---

## 2. Coolify API Token

In your Coolify instance: **Settings → API Tokens → Create token**

```
COOLIFY_URL=https://coolify.your-domain.com
COOLIFY_TOKEN=your_token_here
```

---

## 3. Create your `.env` file

```env
# ── Coolify ──────────────────────────────────────────────────────────────────
COOLIFY_URL=https://coolify.your-domain.com
COOLIFY_TOKEN=your_coolify_api_token

# ── Firebase Admin SDK (server-side) ─────────────────────────────────────────
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_HERE\n-----END PRIVATE KEY-----\n"

# ── Firebase Web SDK (client-side — fetched at runtime, not baked in) ────────
FIREBASE_API_KEY=your_web_api_key
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
FIREBASE_MESSAGING_SENDER_ID=000000000000
FIREBASE_APP_ID=1:000000000000:web:xxxxxxxxxxxx

# ── Access control ────────────────────────────────────────────────────────────
# Email auto-promoted to super_admin on first login
SUPER_ADMIN_EMAIL=you@your-company.com

# Restrict sign-in to one email domain. Leave empty to allow any Google account.
ALLOWED_EMAIL_DOMAIN=your-company.com

# ── Optional ──────────────────────────────────────────────────────────────────
PORT=3069
GOOGLE_HD=your-company.com   # domain hint on the Google sign-in picker

# ── Database (SQLite default — change for MySQL / PostgreSQL) ─────────────────
DB_PROVIDER=sqlite
DATABASE_URL=file:./data/shippr.db
```

---

## 4. Run with Docker

### Option A — `docker run`

```bash
docker run -d \
  --name shippr \
  --restart unless-stopped \
  -p 3069:3069 \
  -v shippr_data:/app/data \
  --env-file .env \
  arpanagr/shippr:latest
```

Shippr is now available at `http://your-server:3069`.

### Option B — Docker Compose (recommended)

Save this as `docker-compose.prod.yml` next to your `.env` file:

```yaml
services:
  shippr:
    image: arpanagr/shippr:latest
    restart: unless-stopped
    ports:
      - "3069:3069"
    volumes:
      - shippr_data:/app/data
    env_file: .env

volumes:
  shippr_data:
```

Then:

```bash
docker compose -f docker-compose.prod.yml up -d
```

---

## 5. First Login & Admin Setup

1. Open `http://your-server:3069` and sign in with the Google account you set as `SUPER_ADMIN_EMAIL`
2. That account is automatically promoted to **super-admin** on first login
3. Go to **User Management** (top-right menu) to invite team members
4. Assign each user to the Coolify **projects** they should see
5. Users can only access apps and services within their assigned projects

---

## 6. Database Options

By default Shippr uses SQLite (stored in the mounted volume). For teams or multi-replica setups, switch to MySQL or PostgreSQL:

```env
DB_PROVIDER=mysql
DATABASE_URL=mysql://user:password@db-host:3306/shippr
```

```env
DB_PROVIDER=postgresql
DATABASE_URL=postgresql://user:password@db-host:5432/shippr
```

The startup script substitutes the provider into the Prisma schema and runs migrations automatically — no code changes needed.

---

## 7. Reverse Proxy (optional but recommended)

To run Shippr on a proper domain with TLS, put it behind nginx or Caddy.

**Caddy example** (`Caddyfile`):
```
shippr.your-company.com {
    reverse_proxy localhost:3069
}
```

**nginx example**:
```nginx
server {
    listen 443 ssl;
    server_name shippr.your-company.com;

    location / {
        proxy_pass http://localhost:3069;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Remember to add the domain to Firebase's **Authorized domains** list.

---

## 8. Upgrading

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

The startup script runs `prisma db push` on every container start, so database schema migrations apply automatically.

---

## 9. Building from Source

If you want to build your own image (e.g. for a custom fork):

```bash
git clone https://github.com/your-org/shippr.git
cd shippr

# Single-platform (your current machine's arch)
docker build -t your-username/shippr:latest .

# Multi-platform (amd64 + arm64)
docker buildx create --use --name shippr-builder 2>/dev/null || true
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push \
  -t your-username/shippr:latest \
  .
```

No build args required — Firebase config is runtime-only.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `COOLIFY_URL` | Yes | — | Base URL of your Coolify instance |
| `COOLIFY_TOKEN` | Yes | — | Coolify API token |
| `FIREBASE_PROJECT_ID` | Yes | — | Firebase project ID (shared by server + client) |
| `FIREBASE_CLIENT_EMAIL` | Yes | — | Firebase Admin SDK service account email |
| `FIREBASE_PRIVATE_KEY` | Yes | — | Firebase Admin SDK private key (full PEM block) |
| `FIREBASE_API_KEY` | Yes | — | Firebase Web SDK API key |
| `FIREBASE_AUTH_DOMAIN` | Yes | — | Firebase Auth domain |
| `FIREBASE_STORAGE_BUCKET` | Yes | — | Firebase storage bucket |
| `FIREBASE_MESSAGING_SENDER_ID` | Yes | — | Firebase messaging sender ID |
| `FIREBASE_APP_ID` | Yes | — | Firebase web app ID |
| `SUPER_ADMIN_EMAIL` | Yes | — | Email auto-promoted to super-admin on first login |
| `ALLOWED_EMAIL_DOMAIN` | No | *(any)* | Restrict sign-in to this domain, e.g. `acme.com` |
| `PORT` | No | `3069` | Port the server listens on |
| `DB_PROVIDER` | No | `sqlite` | Database provider: `sqlite`, `mysql`, or `postgresql` |
| `DATABASE_URL` | No | `file:./data/shippr.db` | Prisma connection URL |
| `GOOGLE_HD` | No | — | Domain hint on the Google sign-in picker |
| `CORS_ORIGINS` | No | — | Comma-separated allowed CORS origins (not needed in single-container setup) |
