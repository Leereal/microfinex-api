# Deploying the API to Coolify

The `Dockerfile` in this directory is what Coolify builds. `docker-compose.yml`
is for local development only — don't point Coolify at it.

Deploy the API **before** the frontend: the frontend's build bakes in the API's
public URL, so you want to know that URL first.

## 1. Provision Postgres and Redis

In your Coolify project, add the databases first:

- **+ New** → **Database** → **PostgreSQL 16**
- **+ New** → **Database** → **Redis**

Coolify gives each one an internal connection URL on the project's Docker
network. Copy both — they become `DATABASE_URL` and `REDIS_URL` below. Use the
**internal** URLs, not the public ones; there is no reason for database traffic
to leave the server.

Redis is optional in the sense that the API logs a warning and runs without
caching if it cannot connect, but it is cheap and you want it.

## 2. Create the application

**+ New** → **Application** → **Public** (or **Private**, via GitHub App)
**Repository**.

| Field | Value |
|---|---|
| Repository | `https://github.com/Leereal/microfinex-api` |
| Branch | the branch you deploy from |
| Build Pack | **Dockerfile** |
| Base Directory | `/` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `8000` |

Leave **Docker Build Stage Target** empty. `runner` is the last stage in the
Dockerfile, so it is what gets built by default.

Set the domain under **Domains** — for example `https://api.example.com`.

**Give this application at least 2GB of memory.** It keeps a headless Chromium
alive between requests for PDF rendering, and Chromium is not modest. A 1GB
container will be killed by the OOM reaper the first time somebody downloads a
statement.

## 3. Environment variables

Unlike the frontend, nothing here is needed at build time — every value is read
when the process starts. Leave **Build Variable?** unticked on all of them.

### Required — the server will not start without these

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8000` |
| `DATABASE_URL` | Coolify's internal Postgres URL |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | a **different** `openssl rand -base64 48` |
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | |

`JWT_SECRET` and `JWT_REFRESH_SECRET` are both mandatory in production — the
config layer refuses to start rather than fall back to a default, since a
checked-in default would let anyone forge an admin token. `JWT_REFRESH_SECRET`
is the easy one to miss: it has no development default either, it just gets
randomly generated per process when `NODE_ENV` is not `production`.

The Supabase client is constructed when its module is imported, so a missing
`SUPABASE_URL` crashes the process at startup with `supabaseUrl is required`
before anything else is logged.

### Required for the app to actually work

| Variable | Notes |
|---|---|
| `ALLOWED_ORIGINS` | `https://app.example.com` — your frontend's domain, comma separated for several. Defaults to `http://localhost:3000`, so leaving it out blocks the deployed frontend in the browser. |
| `TRUST_PROXY` | `1`. Coolify puts Traefik in front of this container. |
| `REDIS_URL` | Coolify's internal Redis URL |
| `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` | Uploads are held in memory and streamed to object storage — there is no local-disk fallback, so without these every photo, logo and document upload fails. |
| `API_PUBLIC_URL` | `https://api.example.com`. Used in unsubscribe links and the WhatsApp webhook URL. |
| `APP_PUBLIC_URL` | `https://app.example.com`. Where Composio sends staff back to after connecting a mailbox. |
| `ENCRYPTION_MASTER_KEY`, `ENCRYPTION_KEY_SALT` | Encrypts credentials for the assistant's connected accounts. Without them the encryption service logs a warning and stays off. **Changing the master key later makes everything already encrypted unreadable.** |

### Single-instance switches

Three background workers must run on exactly one instance. If you ever scale
the API past one replica, turn them off everywhere except one:

| Variable | Default | What it runs |
|---|---|---|
| `ENABLE_SCHEDULER` | off | Loan status transitions, arrears, penalties, reminders. **Set it to `true`** — loans never go OVERDUE and penalties never accrue without it. |
| `COMMS_DISPATCHER` | `true` | Sends queued client messages and fetches SMS delivery reports. |
| `ASSISTANT_WORKER` | `true` | The assistant's queue, automations and expiring approvals. |

`ENABLE_SCHEDULER` is the one people forget. It is off by default and the only
sign is a warning line at startup.

### The rest

`SMTP_*`, `SMS_PROVIDER` and the Twilio/Econet keys, `OBSE_*`, `COMPOSIO_*`,
`RATE_LIMIT_*`, `LOG_LEVEL` — see [.env.example](.env.example). Each is
optional and degrades to a disabled feature rather than a failed start.

## 4. Database schema

`prisma migrate deploy` does **not** build this database from nothing. The
migration history starts partway through the project's life — the oldest
migration alters tables that no migration creates — so it only works against a
database that already has the base schema.

**Deploying against your existing database:** set it as a Pre-deployment
Command in Coolify so each deploy applies whatever is new:

```
npx prisma migrate deploy
```

**Standing up a brand new database:** create the schema first, then baseline
the history so `migrate deploy` does not try to replay it. From a shell in the
container (**Terminal** in Coolify, once the app has been deployed once):

```sh
# Build the schema from prisma/schema.prisma
npx prisma db push

# Tell Prisma those migrations are already represented in that schema
for m in prisma/migrations/2*/; do
  npx prisma migrate resolve --applied "$(basename "$m")"
done
```

`prisma/ddl/schema.sql` is a `pg_dump` of the same schema if you would rather
apply it with `psql`. Either way, baseline the history afterwards.

Then create the first Super Admin. `npm run bootstrap` is interactive and needs
a TTY, so run it from Coolify's **Terminal** rather than as a deploy command.

## 5. Health check

The Dockerfile declares a `HEALTHCHECK` against `/health`, which answers
without touching Postgres or Redis.

Under **Health Checks**, either leave Coolify's own check disabled so the
Dockerfile's is used, or enable it with:

| Field | Value |
|---|---|
| Path | `/health` |
| Port | `8000` |
| Scheme | `http` |
| Method | `GET` |
| Expected Status | `200` |
| Start Period | `30` |

The probe is deliberately shallow. A deep check that pinged the database would
restart this container over a Postgres outage, which fixes nothing and drops
the in-flight requests that were still fine.

## 6. Deploy

Hit **Deploy**. The first build is slow — it compiles bcrypt, generates the
Prisma client, runs `tsc`, and installs Chromium — and produces a ~1.5GB image.
Later builds reuse the layer cache as long as `package-lock.json` is unchanged.

Then point the frontend at it: `NEXT_PUBLIC_API_URL=https://api.example.com`
as a **build** variable, and `API_INTERNAL_URL=http://<this-container>:8000` as
a runtime one. See the frontend's `COOLIFY.md`.

## How the image is put together

Five stages, all on `node:22-bookworm-slim`:

- **base** — Debian rather than the alpine the frontend uses. This service
  renders PDFs and drives the assistant's browser through puppeteer, and
  Chromium on musl is a fight over fonts and missing glibc symbols. bcrypt's
  prebuilt binaries are glibc-only too.
- **deps** — `npm ci` with devDependencies, plus the toolchain bcrypt needs if
  it has to compile. None of it reaches the runner.
- **prod-deps** — the same install with `--omit=dev`.
- **builder** — `prisma generate` then `tsc`.
- **runner** — Chromium, fonts, the pruned dependency tree, `dist/`, and the
  Prisma CLI and engines so migrations can be run from the deployed image.
  Runs as the unprivileged `node` user under `dumb-init`, which reaps the
  processes Chromium leaves behind and forwards SIGTERM so the graceful
  shutdown in `server.ts` runs.

Puppeteer's own ~150MB Chromium download is skipped in favour of Debian's, via
`PUPPETEER_SKIP_DOWNLOAD` and `PUPPETEER_EXECUTABLE_PATH`. `puppeteer.launch()`
reads the second one directly, so no launch option had to change.

## Troubleshooting

**`supabaseUrl is required` and the container exits immediately** — `SUPABASE_URL`
is unset. The client is built at import time, so this happens before any other
startup logging.

**`JWT_SECRET is not set. Refusing to start`** — or the same for
`JWT_REFRESH_SECRET`. Both are mandatory in production.

**Everything returns 429 under light load** — `TRUST_PROXY` is not set to `1`.
Every request then appears to come from Traefik's address, so the rate limiter
puts the whole internet in one bucket.

**Browser requests fail with a CORS error while curl works** —
`ALLOWED_ORIGINS` does not list the frontend's domain. Scheme included, no
trailing slash.

**PDF downloads fail or the container is OOM-killed** — Chromium needs headroom.
Give the application at least 2GB.

**Loans never go overdue, penalties never accrue** — `ENABLE_SCHEDULER` is not
`true`.

**Uploads fail** — the MinIO variables are unset, so the client is pointed at
`localhost:9000` inside the container.

**`P3018` / `relation "..." does not exist` during migrate** — you ran
`migrate deploy` against an empty database. See section 4.

**Build fails resolving `docker/dockerfile:1.7`** — the first line of the
Dockerfile pulls a BuildKit frontend image, so the Coolify server needs to
reach Docker Hub.

**`/api-docs` is empty** — swagger-jsdoc reads annotations from
`src/routes/*.ts`, which is not in the runtime image, and `tsc` strips comments
from `dist` anyway. The docs link is only printed in development; treat Swagger
UI as a local tool.
