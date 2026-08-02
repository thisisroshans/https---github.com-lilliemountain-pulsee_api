# Pulse API

Backend for **Pulse** — an AI diet & fitness coaching app for the Indian market.
Fastify + TypeScript (strict) + PostgreSQL/Prisma + Redis, built as a layered
modular monolith.

**Read [`docs/BACKEND_HANDOFF.md`](docs/BACKEND_HANDOFF.md) before writing code.**
It is the source of truth for architecture, conventions, and the definition of
done. This README only covers how to run things.

---

## Quick start

```bash
pnpm install
cp .env.example .env          # then set DATABASE_URL, TEST_DATABASE_URL, REDIS_URL
docker compose up -d postgres redis   # or use managed Postgres/Redis — see below
pnpm db:migrate               # apply migrations
pnpm db:seed                  # optional dev users
pnpm dev                      # http://localhost:3000
```

Check it came up: `curl -s localhost:3000/api/v1/health/ready` should report
`"status":"ok"` with both dependencies `up`.

API docs (dev only): <http://localhost:3000/docs>

### Pointing the docs at a deployed API

Swagger UI's "Try it out" targets whichever server is selected in its dropdown.
Set `API_PUBLIC_URL` to add your deployed base URL alongside localhost:

```bash
API_PUBLIC_URL=https://api.pulse.fit
```

| `NODE_ENV`  | Servers listed                                |
| ----------- | --------------------------------------------- |
| development | `localhost:PORT` (Local), then Deployed       |
| production  | Deployed only — localhost is never advertised |

The deployed API must allow the docs origin in `CORS_ORIGINS`, or browser
requests from Swagger UI will be blocked.

`servers` is deployment metadata, not contract, so `pnpm openapi:check` ignores
it — setting `API_PUBLIC_URL` will not fail the CI staleness check.

### Without Docker (managed Postgres / Redis)

Point the URLs at any Postgres 16+ and Redis 7 and run `pnpm db:migrate && pnpm dev`.
Two gotchas with managed providers:

- **Neon:** use the **direct** connection host, not the `-pooler` one — Prisma
  migrations fail against PgBouncer. Keep `?sslmode=require`, and drop
  `channel_binding=require` (Prisma does not parse it). Create a dedicated
  database for `TEST_DATABASE_URL`; the suite must never share with dev.
- **Upstash / any TLS Redis:** the URL scheme must be `rediss://` (two s's).
  Upstash's `redis-cli --tls` snippet expresses the same thing as a flag, but
  this codebase reads TLS from the scheme.

Redis is not required to boot: rate limiting degrades to in-memory counters and
logs a warning if it is unreachable.

---

## Commands

| Command                             | What it does                                       |
| ----------------------------------- | -------------------------------------------------- |
| `pnpm dev`                          | Run with hot reload (tsx watch).                   |
| `pnpm build` / `pnpm start`         | Compile to `dist/` and run the compiled server.    |
| `pnpm typecheck`                    | `tsc --noEmit`, strict.                            |
| `pnpm lint` / `pnpm lint:fix`       | ESLint (typescript-eslint, type-aware).            |
| `pnpm format` / `pnpm format:check` | Prettier.                                          |
| `pnpm test` / `pnpm test:watch`     | Vitest unit + integration.                         |
| `pnpm test:coverage`                | Coverage report (thresholds enforced).             |
| `pnpm db:migrate`                   | Create + apply a migration in development.         |
| `pnpm db:deploy`                    | Apply migrations in CI/production.                 |
| `pnpm db:seed`                      | Deterministic, idempotent dev seed.                |
| `pnpm db:studio`                    | Prisma Studio.                                     |
| `pnpm openapi:generate`             | Regenerate `docs/openapi.json` from route schemas. |
| `pnpm openapi:check`                | Fail if the committed spec is stale (CI gate).     |

---

## Layout

```text
src/
  app.ts            # builds the Fastify instance (plugins, hooks, routes)
  server.ts         # boot, listen, graceful shutdown
  config/           # Zod-validated env + non-secret constants
  modules/<domain>/ # routes → controller → service → repository → schema
  shared/           # errors, http envelope, validation, logger, db, cache, queue, middleware
  integrations/     # external providers behind interfaces (SMS, LLM, vision, storage, payments)
  jobs/             # BullMQ processors
prisma/             # schema.prisma, migrations, seed
test/               # unit/, integration/, fixtures/, helpers/
```

Dependencies point inward and downward: `route → controller → service →
repository`. A controller never imports a repository; a service never imports
Fastify. Cross-module calls go service-to-service.

---

## Conventions worth knowing up front

- **Response envelopes.** Success is `{ success: true, data, meta? }`, errors are
  `{ success: false, error: { code, message, details?, requestId } }`. Build them
  with the helpers in `shared/http/envelope.ts` — never hand-roll one.
- **Errors.** Services throw typed `AppError`s (`NotFoundError`,
  `BusinessRuleError`, …). The global handler in
  `shared/middleware/error-handler.ts` is the only place that formats an HTTP
  error response, and the only place that decides log level.
- **Validation.** Zod schemas on every route, covering request and response alike. Response
  schemas are what stop internal fields leaking. Reuse the primitives in
  `shared/validation/common.ts` (`indianPhoneSchema` normalises to E.164).
- **Auth.** `requireAuth` authenticates; `requireRole` / `requireEntitlement`
  authorize. Resource **ownership** is enforced in services via `assertOwned` —
  guards cannot do it, because only the service knows what an id refers to.
- **Time.** All timestamps stored UTC; "today", meal times, and streaks are
  computed in the user's timezone (default `Asia/Kolkata`).
- **Expensive AI calls** (plan generation, food-photo vision) go through BullMQ,
  never inline on the request path.
- **Logging.** Structured Pino only, never `console.log`. Redaction of phones,
  tokens, cookies, and OTP codes is configured in `shared/logger` — don't defeat it.

---

## Health endpoints

| Endpoint                   | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/health/live`  | Liveness. 200 whenever the process runs; touches no dependencies.  |
| `GET /api/v1/health/ready` | Readiness. Probes Postgres and Redis; **503** when either is down. |

```bash
curl -s localhost:3000/api/v1/health/ready
```

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptimeSeconds": 14,
    "version": "0.1.0",
    "dependencies": {
      "database": { "status": "up", "latencyMs": 3 },
      "redis": { "status": "up", "latencyMs": 1 }
    }
  }
}
```

Both are exempt from rate limiting and unauthenticated — probes call them constantly.

---

## Testing

- **Unit** (`test/unit/`) — services and pure logic, all dependencies mocked.
- **Integration** (`test/integration/`) — real HTTP through the built app via
  `app.inject()`, against a real test database.

`test/helpers/setup-env.ts` pins a hermetic test environment, so the suite never
reads a developer's `.env`. Integration tests use `TEST_DATABASE_URL` — point it
at a throwaway database (`docker compose up` creates `pulse_test` for you).

Coverage floors: 80% lines/functions/statements, 75% branches. Business-critical
logic (auth, entitlements, billing, macro math, streaks) is expected at 100%.

---

## Authentication

Phone sign-in only, via **Firebase Phone Auth**. Verification happens
client-side: the app gets a Firebase ID token and exchanges it at
`POST /api/v1/auth/firebase` for Pulse's own access and refresh tokens. The API
never sees the SMS code, and there is no server-side OTP endpoint.

See [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) for the full flow, the
token model, reuse detection, and how to develop without sending real SMS.

Firebase credentials are not needed to run the API locally — the client is built
lazily, so only `/auth/firebase` requires them.

---

## Deployment

The API is deployed as a container on **Railway**, connecting out to **Neon**
(Postgres) and **Upstash** (Redis). Configuration lives in
[`railway.toml`](railway.toml); the full checklist — required variables, secret
rotation, and how migrations run on deploy — is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Neon and Upstash host the data layer only; neither can run the API process.

---

## Notes on this environment

- The handoff targets **Node 20 LTS**; `engines` allows `>=20`. This machine runs
  Node 24 and the suite passes there, but CI and the Docker image should pin 20.
- `docs/openapi.json` is generated. Never edit it by hand — run
  `pnpm openapi:generate` and commit the result. CI runs `pnpm openapi:check`.
