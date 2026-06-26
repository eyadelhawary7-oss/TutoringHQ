# CRON_SECRET — Vault-sourced bearer for pg_cron jobs

_Last updated: 2026-06 (Phase 5 — secret hygiene)_

## Summary

The Supabase **pg_cron** jobs that call CenterHQ cron endpoints authenticate with
a bearer token (`Authorization: Bearer <CRON_SECRET>`). That token used to be
**embedded as a literal** inside each job's command SQL, which made it visible in
the `cron.job` catalog, the Supabase dashboard, and any DB snapshot.

As of Phase 5 the literal is **de-embedded**: the secret lives in **Supabase
Vault** under the name **`cron_secret`**, and each job reads it at runtime:

```sql
SELECT net.http_post(
  url     := 'https://center-hq.vercel.app/api/cron/<endpoint>',
  headers := jsonb_build_object(
    'Authorization',
    'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
  ),
  body    := '{}'::jsonb
);
```

The de-embed script: [`scripts/schema/cron-deembed-secret.sql`](../scripts/schema/cron-deembed-secret.sql)
(idempotent, with a documented rollback).

### How verification works

Every cron endpoint calls `requireCronSecret(request)`
([`src/lib/cron/requireCronSecret.ts`](../src/lib/cron/requireCronSecret.ts)),
which timing-safe-compares the incoming header against
`` `Bearer ${process.env.CRON_SECRET}` ``. So **two places must hold the same
value**:

| Side       | Where                                   | Used for      |
| ---------- | --------------------------------------- | ------------- |
| Sender     | Supabase Vault secret `cron_secret`     | pg_cron jobs  |
| Verifier   | Vercel env `CRON_SECRET`                | API endpoints |

The committed `db/cron.snapshot` keeps the secret **redacted/absent** — the job
commands no longer contain a literal, and `scripts/schema/introspect-cron.sql`
still redacts any `Bearer …` defensively.

## ⚠️ Known state at time of writing (pre-go-live)

The jobs currently point at `https://center-hq.vercel.app` (the pre-go-live
deployment — `/api/health` reports `paymob_mode: sandbox`). The Vault value
equals the value previously embedded, **but it does not match that deployment's
Vercel `CRON_SECRET`**, so the scheduled jobs were already returning **HTTP 401**
before this change (confirmed: 24h of `net._http_response` rows were all 401, with
the empty body that `requireCronSecret` returns). The de-embed did **not** change
this — it is behaviour-preserving (same value sent). Aligning the two sides is the
go-live rotation below.

## Go-live rotation runbook (deferred — do at go-live)

Goal: set a fresh `CRON_SECRET`, with **no window where a scheduled job fails
auth**. The verifier does an exact single-value match, so use a brief dual-accept
overlap.

1. **(Optional but recommended) Dual-accept the verifier.** Update
   `requireCronSecret` to accept `CRON_SECRET` **or** a transient
   `CRON_SECRET_PREVIOUS`, deploy. (Skip only if you can tolerate a few-minute
   gap; `status-ping` runs every 5 min.)
2. **Generate** a new value, e.g. `openssl rand -hex 32`.
3. **Vercel:** set `CRON_SECRET = <new>` (and, if doing step 1,
   `CRON_SECRET_PREVIOUS = <old>`), then **redeploy** so endpoints pick it up.
4. **Vault:** update the sender to the same new value:
   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'cron_secret'),
     '<new>'   -- same value set in Vercel
   );
   ```
   (No job SQL changes — jobs read Vault at runtime.)
5. **Verify** a full cron cycle authenticates: watch `status-ping` (every 5 min)
   return 200:
   ```sql
   SELECT id, status_code, created FROM net._http_response ORDER BY id DESC LIMIT 20;
   ```
6. **Clean up:** once green, remove `CRON_SECRET_PREVIOUS` from Vercel and
   redeploy (if step 1 was used).

> The value never needs to be typed into job SQL or committed anywhere. Future
> rotations are just steps 2–6.

## Rollback

See the rollback block at the bottom of
[`scripts/schema/cron-deembed-secret.sql`](../scripts/schema/cron-deembed-secret.sql).
It re-embeds the literal from Vault back into the job commands (emergency use
only — it re-introduces the catalog-visibility issue this change fixes).
