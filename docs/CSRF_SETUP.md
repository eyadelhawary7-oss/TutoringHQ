# CSRF Protection Setup

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

## Behavior

- **When `CSRF_SECRET` is set**: All protected endpoints require `X-CSRF-Token` and `X-Session-ID` headers. The client fetches a token from `GET /api/csrf-token` (authenticated) and includes it in state-changing requests.
- **When `CSRF_SECRET` is not set**: CSRF validation is skipped (development fallback). **Always set it in production.**
