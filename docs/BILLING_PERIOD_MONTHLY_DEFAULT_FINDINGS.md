# Findings — Flip center billing default to monthly (schema cleanup)

> Dated record (Step-0 through applied change). Synced against the live database on 2026-07-18: the change described here is **live** — `centers.billing_period` CHECK is `IN ('monthly','annual')` and `subscription_billing_period` CHECK is `IN ('monthly','yearly')`, both default `'monthly'` (verified live 2026-07-18). The "Live schema (as-is)" section below is the pre-change snapshot, preserved. The migration filename below has been corrected to the one actually committed.

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

## Decision — Option 3 (Eyad): fix the quarterly writers, then tighten
Fix both quarterly writers (including the admin ×3 triple-charge), then tighten the
CHECKs. Applied to live PG17; snapshot regenerated; held for review, no PR.

### Code changes (retire quarterly at every writer)
1. **Admin manual-approve** — `src/app/api/admin/centers/route.ts`
   `subscription_billing_period` `'quarterly'` → `'monthly'`, and `billing_amount`
   / `early_adopter_price` now use `getChargeFromQuarterlyAllIn(effectiveAllInPerMonth,
   'monthly', planKey)` (the monthly list price) instead of `× 3`. This also removes
   the internal inconsistency where the record already carried a +30-day
   `next_payment_due` but a ×3 / quarterly amount. Matches the signup / Paymob
   auto-approve activation paths.
2. **PAYG → fixed switch cron** — `src/app/api/cron/payg-billing/route.ts`
   Fallback `'quarterly'` → `'monthly'`; annual now honors each column's vocabulary
   (`billing_period='annual'`, `subscription_billing_period='yearly'`) so both writes
   satisfy the tightened CHECKs.
3. **PAYG switch entry + UI** — `src/app/api/billing/switch-payg/route.ts` and
   `src/app/[locale]/settings/billing/page.tsx`: the leave-PAYG period is now
   monthly | annual only (quarterly option removed, default monthly; legacy
   `'quarterly'` input coerces to monthly rather than 400-ing).

Remaining `|| 'quarterly'` occurrences in `src/` are **reader/normalizer fallbacks**
(months-calc in `admin/approve-payment`, aggregation display in `admin/billing`,
`normalizeBillingPeriod`/`pricing.ts` defaults) — none write the period columns or
produce a quarterly row, so they are left untouched and pose no CHECK risk.

### Schema migration — `supabase/migrations/20260705050120_billing_period_monthly_default.sql` (verified present live 2026-07-18)
- `billing_period` / `subscription_billing_period` DEFAULT `'quarterly'` → `'monthly'`.
- `centers_billing_period_check` → `IN ('monthly','annual')`.
- `centers_subscription_billing_period_check` → `IN ('monthly','yearly')` (annual
  value quirk preserved; annual otherwise untouched).
- Ends with `NOTIFY pgrst, 'reload schema'`.

### Applied + verified on live prod (PG17, project `lczmjpnbuhnsislcvzar`)
- Pre-apply violation check: 2 rows total, **0** violations on either column.
- Post-apply: both defaults `'monthly'`; checks are `{monthly, annual}` and
  `{monthly, yearly}`; **0** rows in violation.
- Snapshot regenerated from live PG17 (not hand-authored): the 4 changed `line`
  values were read back verbatim via `execute_sql`, and the whole regenerated file's
  md5 (`86b385b0…`, 6190 lines) matches PG17's own
  `md5(string_agg(line, E'\n' ORDER BY sk, line) || E'\n')` byte-for-byte — proving
  exactly those 4 lines changed and the file equals a full PG17 introspection. Both
  drift gates (rebuild-from-migrations on `postgres:17`, and live-vs-snapshot) will
  therefore be green.
- Gates run locally: `typecheck`, `i18n:check`, `check:bidi`, `check:tolocale`, and
  the full unit suite (1147 passed) — all green.
