# Authentication

Pulse uses **phone number sign-in only** — no email, no password. Screens 14–15
of the prototype.

The important thing to understand up front: **the API never sees the SMS code.**
Firebase Phone Auth runs in the mobile app, and the backend only verifies the
resulting ID token. There is deliberately no `/auth/otp/request` or
`/auth/otp/verify` endpoint.

---

## The flow

```text
1. app  ──► Firebase SDK          signInWithPhoneNumber("+919876543210")
2.          Firebase ──► SMS ──► user types the code
3. app  ──► Firebase SDK          confirm(code)  ->  Firebase ID token
4. app  ──► POST /api/v1/auth/firebase { idToken }
5.          API verifies with Firebase Admin, upserts the user by phone
6. API  ──► { accessToken, refreshToken, user }
7. app  ──► every request:  Authorization: Bearer <accessToken>
```

Firebase proves the user controls the number. Everything after that — who they
are in Pulse, what they may do, how long the session lasts — is decided by this
API, so access can be revoked without depending on Firebase.

### Why not use the Firebase ID token directly?

Because sessions would then be Firebase's to control. Our own access token
carries `roles` and `entitlement` as claims (so Premium gating needs no extra
database read), expires in 15 minutes, and can be revoked server-side
immediately. Firebase tokens can do none of those.

---

## Endpoints

| Method | Path                    | Auth   | Purpose                                                                                     |
| ------ | ----------------------- | ------ | ------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/auth/firebase` | none   | Exchange a Firebase ID token for a session. **201** created the account, **200** logged in. |
| POST   | `/api/v1/auth/refresh`  | none   | Rotate tokens.                                                                              |
| POST   | `/api/v1/auth/logout`   | none   | Revoke the session. Always 204.                                                             |
| GET    | `/api/v1/auth/me`       | Bearer | The current user.                                                                           |

### Sign in

```bash
curl -X POST http://localhost:3000/api/v1/auth/firebase \
  -H 'Content-Type: application/json' \
  -d '{"idToken":"<firebase id token>","deviceId":"pixel-8-abc123"}'
```

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "0192f0a1-....<secret>",
    "expiresIn": 900,
    "tokenType": "Bearer",
    "isNewUser": true,
    "user": {
      "id": "0192f0a1-8f3c-7c21-9b40-1f2e3d4c5b6a",
      "phone": "+919876543210",
      "displayName": null,
      "timezone": "Asia/Kolkata",
      "locale": "en-IN",
      "entitlement": "free",
      "roles": ["user"],
      "createdAt": "2026-08-02T05:10:33.114Z"
    }
  }
}
```

Use `isNewUser` to decide whether to send the user into onboarding (screens 2–6)
or straight to Home (screen 8).

### Refresh

Access tokens last 15 minutes. Refresh before expiry, or on any `401`:

```bash
curl -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh token>"}'
```

Each refresh returns a **new** refresh token and invalidates the old one. Always
store the newest; replaying an old one logs the user out everywhere (see below).

### Logout

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refresh token>","allDevices":false}'
```

Always returns 204, even for an unknown token — reporting otherwise would tell a
caller whether a token exists.

---

## Token model

|                    | Access token            | Refresh token                     |
| ------------------ | ----------------------- | --------------------------------- |
| Format             | JWT (HS256)             | opaque `<uuid>.<secret>`          |
| Lifetime           | 15 minutes              | 60 days                           |
| Sent as            | `Authorization: Bearer` | request body                      |
| Stored server-side | no                      | argon2id hash of the secret only  |
| Client storage     | memory                  | secure keychain / encrypted prefs |

The refresh token is split so the id can be looked up in one indexed query while
only the secret is hashed — hashing the whole token would force a table scan,
since every argon2 hash uses a distinct salt. Hashes are also peppered with
`JWT_REFRESH_PEPPER`, so a stolen database alone cannot be brute-forced.

### Reuse detection

Refresh tokens rotate, and every token descended from one sign-in shares a
**family id**. Presenting an already-rotated token means it leaked, so the entire
family is revoked and an `AUTH_REFRESH_REUSE_DETECTED` audit row is written.

The practical consequence for the app: **never retry a refresh with an old
token.** If two threads refresh concurrently, one will replay a rotated token and
log the user out. Serialise refreshes behind a single in-flight promise.

---

## Local development

Do not point the backend at real SMS while developing. Use **Firebase test phone
numbers**: Firebase Console → Authentication → Sign-in method → Phone → _Phone
numbers for testing_.

Add e.g. `+91 99999 99999` with code `123456`. Firebase then returns a genuine ID
token for that number without sending an SMS, and it is free. The real code path
runs end to end.

For backend-only work you can skip Firebase entirely — the integration suite
injects a fake verifier (`test/helpers/fake-identity-verifier.ts`), so
`pnpm test` needs no Firebase credentials.

The API also boots without Firebase configured: the client is created lazily, so
health and every non-auth route work, and only `/auth/firebase` fails.

---

## Rate limits

| Endpoint              | Limit              |
| --------------------- | ------------------ |
| `POST /auth/firebase` | 10 / minute per IP |
| `POST /auth/refresh`  | 30 / minute per IP |
| everything else       | 300 / minute       |

Firebase enforces its own SMS quotas, so these protect _our_ endpoints against
token replay and enumeration rather than capping SMS spend. Exceeding one returns
`429` with a `Retry-After` header.

---

## What gets audited

Written to `audit_logs`, append-only: `AUTH_SIGNUP`, `AUTH_LOGIN`,
`AUTH_REFRESH`, `AUTH_LOGOUT`, `AUTH_LOGOUT_ALL`, and
`AUTH_REFRESH_REUSE_DETECTED`.

Phone numbers are masked in application logs (`+91********10`) and tokens are
redacted; the audit table stores user ids, never credentials.
