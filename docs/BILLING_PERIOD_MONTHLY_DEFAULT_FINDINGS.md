# Findings — Flip center billing default to monthly (schema cleanup)

Step-0 introspection of the live catalog (project `lczmjpnbuhnsislcvzar`, Postgres
17.6) before any change. Money-adjacent; surgical. This is the deferred DB
follow-up recommended in `MONTHLY_ANNUAL_BILLING_FINDINGS.md` line 52 (schema
change needs a PG17 snapshot regen, impossible in the prior environment).

## Live schema (as-is)
- `centers.billing_period` — `text`, default **`'quarterly'`**, CHECK
  `IN ('monthly','quarterly','annual')`.
- `centers.subscription_billing_period` — `text`, default **`'quarterly'`**, CHECK
  `IN ('monthly','quarterly','biannual','yearly')`. **Value quirk:** annual is
  spelled **`yearly`** here; `'annual'` is NOT an allowed value on this column.

## Live data (as-is)
Only 2 rows exist, both **test centers** (`is_test = true`); zero real customers,
zero non-test rows, zero quarterly rows.

| billing_period | subscription_billing_period | rows | non-test rows |
|----------------|------------------------------|------|---------------|
| monthly        | monthly                      | 2    | 0             |

→ **No live row would violate a check tightened to monthly + annual.** ✅

## Snapshot regeneration (PG17)
- `scripts/schema/introspect.sql` is explicitly designed to produce byte-identical
  output whether run via `psql -tAqX` (CI rebuild) or via the Supabase MCP
  `execute_sql` against live prod (see its header). Confirmed empirically:
  PG17's `md5(string_agg(line, E'\n' ORDER BY sk, line) || E'\n')` equals the
  committed `db/schema.snapshot` md5 (`b7e214e3…`, 6190 lines) exactly — so the
  MCP regen path is byte-identical to the CI drift gate, and there is **zero
  pre-existing drift** between live prod and the committed snapshot.
- Docker Hub CDN (`production.cloudfront.docker.com`) and the PGDG apt repo are
  both blocked by org egress policy (403); local Postgres is 16. The MCP path
  above is therefore the PG17-native regen channel (not a hand-edit).

## The intended change
- `ALTER COLUMN billing_period SET DEFAULT 'monthly'` and
  `ALTER COLUMN subscription_billing_period SET DEFAULT 'monthly'`.
- Tighten CHECKs to the pricing rule (monthly + annual), preserving each column's
  annual spelling:
  - `billing_period` → `IN ('monthly','annual')`.
  - `subscription_billing_period` → `IN ('monthly','yearly')` (keeps the `yearly`
    value quirk; annual left exactly as-is).
- End the migration with `NOTIFY pgrst, 'reload schema'`.

## ⚠️ Conflict found — quarterly is NOT fully retired in code
Tightening the `subscription_billing_period` CHECK to `{monthly, yearly}` means any
future write of `'quarterly'` (or `'biannual'`, or bare `'annual'`) to that column
will raise a constraint violation. Two **live, reachable** code paths still write
`'quarterly'` there today:

1. **Admin manual-approve** — `src/app/api/admin/centers/route.ts:859`
   (`action === 'approve'`). Hardcodes `subscription_billing_period: 'quarterly'`
   and `billing_amount = allInPerMonth × 3` (a quarterly charge). Directly refutes
   "no center can be billed quarterly." A tightened CHECK makes this approval
   `UPDATE` throw.

2. **PAYG → fixed switch cron** — `src/app/api/cron/payg-billing/route.ts:259/265`.
   `period = (sw.payg_pending_target_period || 'quarterly')` is written to both
   `billing_period` and `subscription_billing_period`. The `|| 'quarterly'`
   fallback (null target) would violate the tightened CHECK. (A legit `'annual'`
   target would also violate the `subscription_billing_period` CHECK — bare
   `'annual'` is not the `yearly` quirk — but that already violates today's CHECK.)

The monthly **default flip** alone is safe and fully satisfies "nothing can ever
default back to quarterly." The **CHECK tightening** is what collides with the two
writers above. Decision on how to proceed escalated to Eyad (see below).

## Decision
_(pending Eyad's call — recorded here once made.)_
