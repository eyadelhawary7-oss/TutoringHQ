# CSRF Protection Setup

> Synced against the live code on 2026-07-18. Load-bearing facts verified live are marked (verified live 2026-07-18).

This app uses CSRF tokens to protect state-changing operations (POST, PUT, DELETE) from cross-site request forgery attacks.

## Environment Variable

Add to your `.env.local`:

```
# CSRF secret - 32 bytes as 64-character hex string. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CSRF_SECRET=your_64_character_hex_string_here
```

Generate a valid secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Behavior — fails CLOSED when the secret is missing (verified live 2026-07-18)

- **When `CSRF_SECRET` is set** (well-formed 64-char hex): All protected endpoints require `X-CSRF-Token` and `X-Session-ID` headers. The client fetches a token from `GET /api/csrf-token` (authenticated) and includes it in state-changing requests.
- **When `CSRF_SECRET` is unset or malformed**: CSRF validation **fails closed** — it is NOT skipped. `isCSRFEnabled()` returns false, so `validateCSRFRequest()` returns `false` and every mutation caller returns **403 in every environment** (including development). Additionally, `getKey()` **throws** in production (`NODE_ENV === 'production'`) when the secret is absent or not a 64-char hex string, so `CSRF_SECRET` is effectively mandatory to serve any mutation. Source of truth: `src/lib/csrf.ts` (`isCSRFEnabled`, `validateCSRFRequest`, `getKey`).

> Correction (2026-07-18): a prior version of this doc claimed "CSRF validation is skipped (development fallback)" when the secret is unset. That was WRONG and is the opposite of the actual behaviour — the code fails closed. `CSRF_SECRET` must be set in **every** environment (production, preview, and local dev) or all state-changing requests are rejected with 403. See `.env.example`.
