# Deploying Pulse API

The API runs as a container on **Railway**. Postgres is **Neon** and Redis is
**Upstash** — both are managed services the API connects out to, not things
Railway hosts.

```text
mobile app ──► Railway (Pulse API container) ──┬──► Neon      (Postgres)
                                               └──► Upstash   (Redis)
```

Neon and Upstash cannot host the API itself: neither runs a Node.js process.
They host the data layer only.

---

## Before the first deploy

### 1. Rotate the development credentials

The Neon and Upstash credentials used in local development were shared in plain
text and must not reach production. Reset both, and use the new values only in
Railway's variable editor:

- Neon → **Roles** → `neondb_owner` → _Reset password_
- Upstash → your database → **Danger Zone** → _Reset password_

### 2. Generate real JWT secrets

Never reuse the `dev-only-…` placeholders. Generate two distinct values:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Create the Firebase service account

`config/env.ts` **refuses to boot in production** without `FIREBASE_PROJECT_ID`,
`FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` — without them the API cannot
verify a sign-in, so nobody could log in.

Firebase Console -> Project settings -> Service accounts -> _Generate new
private key_. Copy the three values out of the downloaded JSON. Paste the private
key on one line, keeping its `
` escapes; the env layer expands them.

Enable **Phone** as a sign-in provider under Authentication -> Sign-in method,
and add your app's SHA-256 fingerprint (Android) / APNs key (iOS), or the SMS
challenge will fail in the app.

`FIREBASE_AUTH_EMULATOR_HOST` must be unset — env validation rejects it in
production, because the emulator does not verify token signatures.

---

## Railway setup

1. **New Project** → _Deploy from GitHub repo_ → select this repository.
2. Railway reads [`railway.toml`](../railway.toml) and builds with the
   `Dockerfile`. No build configuration needed in the UI.
3. Set the region to **Singapore** — it matches where Neon and Upstash live, and
   cross-region hops would show up on every query.
4. Add the variables below under **Variables**.
5. **Settings → Networking → Generate Domain** to get a public URL.
6. Set `API_PUBLIC_URL` to that domain and redeploy so the OpenAPI `servers`
   block advertises it.

### Required variables

| Variable                | Value                         | Notes                                                                                |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------ |
| `NODE_ENV`              | `production`                  | Enables the strict env checks below.                                                 |
| `DATABASE_URL`          | Neon **direct** URL           | Not the `-pooler` host — migrations fail against PgBouncer. Keep `?sslmode=require`. |
| `REDIS_URL`             | Upstash `rediss://…`          | Two s's. TLS is read from the scheme.                                                |
| `JWT_ACCESS_SECRET`     | 48 random bytes               | Rotating this invalidates all access tokens.                                         |
| `JWT_REFRESH_PEPPER`    | 48 random bytes, different    | Rotating this invalidates all refresh tokens.                                        |
| `CORS_ORIGINS`          | Explicit origin list          | A wildcard is **rejected** in production.                                            |
| `FIREBASE_PROJECT_ID`   | From the service account JSON | Required to boot.                                                                    |
| `FIREBASE_CLIENT_EMAIL` | From the service account JSON | Required to boot.                                                                    |
| `FIREBASE_PRIVATE_KEY`  | From the service account JSON | Required to boot. One line, keep the `                                               |
| ` escapes.              |
| `API_PUBLIC_URL`        | Your Railway domain           | Adds it to the OpenAPI servers list.                                                 |

`PORT` is injected by Railway and read automatically — do not set it.
`FIREBASE_AUTH_EMULATOR_HOST` must stay unset in production.

### What deploys do

`preDeployCommand` runs `prisma migrate deploy` before the new version takes
traffic, so the schema is never behind the code. The health check targets
`/api/v1/health/ready`, which probes Postgres and Redis — a release with a bad
connection string fails its check and rolls back instead of serving errors.

---

## Verifying a deploy

```bash
curl -s https://<your-domain>/api/v1/health/ready
```

Expect `"status":"ok"` with both dependencies `up`. A `503` names the failing
dependency:

```json
{ "database": { "status": "down", "latencyMs": null } }
```

Swagger UI is **not** served in production (`app.ts` mounts it only outside
production). The contract for the mobile team is the committed
[`docs/openapi.json`](./openapi.json).

---

## Notes

- **Node version.** The Dockerfile pins `node:20-alpine`, matching the handoff,
  even though local development runs Node 24.
- **`prisma` is a runtime dependency,** not a dev one — `pnpm prune --prod` would
  otherwise strip the CLI and `preDeployCommand` would fail.
- **`.dockerignore` excludes `.env`.** Never remove that line; it would bake
  secrets into an image layer.
- **Neon free tier auto-suspends after ~5 minutes idle,** so the first request
  after a quiet period pays a cold start. Move to a paid Neon plan before real
  traffic, or the readiness probe may time out on wake.
- **Redis is not required to boot.** If Upstash is unreachable, rate limiting
  degrades to per-instance in-memory counters and logs a warning. Readiness will
  still report `degraded`, so alert on it.
