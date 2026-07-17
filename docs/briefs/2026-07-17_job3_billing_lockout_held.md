# Job 3 — Billing lockout: held apply steps

Held branch `claude/zealous-hamilton-ztu9gm`. PR is NOT to be merged until Eyad has
reviewed it and the manual steps below are applied by hand. Nothing in this batch
was applied to production by the branch. Every live fact below was checked against
the TutoringHQ production catalog (project `lczmjpnbuhnsislcvzar`) on 2026-07-17,
not against schema_migrations or any summary.

The whole policy is inert on merge: it cannot lock, downgrade a teacher, or paywall
a centre until BOTH `PAYMOB_RECURRING_INTEGRATION_ID` is a real credential AND
`summer.first_charge_release` is flipped to `RELEASED`. Merging changes no amount
and locks no centre.

## Apply order (Eyad, by hand)

1. Review the PR.
2. Apply the manual SQL in sections A–D below, in order, to production.
3. Confirm the objects/values exist in the live catalog (queries given).
4. Let the code deploy.
5. Only later, when Paymob recurring is live and a real test payment has passed,
   flip `summer.first_charge_release` to `RELEASED`. The auto-charge interlock is
   the backstop if that flip happens before the credential is real.

Do NOT merge-and-assume the migration applied: tested 2026-07-15, a merged
migration was still absent from production 8 minutes later (PR #159).

---

## A. Part 1 — migration history repair (report only, no SQL re-run)

Live check confirmed production records the tax-snapshot migration under the WRONG
version:

```
select version, name from supabase_migrations.schema_migrations
where version in ('20260715214425','20260715140000') or name ilike '%tax_snapshot%';
-- -> one row: version 20260715214425, name add_invoice_tax_snapshot
--    (no row for 20260715140000)
```

The repo file is `supabase/migrations/20260715140000_add_invoice_tax_snapshot.sql`.
The schema is already correct and verified (`invoices.vat_rate`, `vat_amount`,
`processing_fee`, constraint `invoices_tax_snapshot_nonneg` all present). Repair the
HISTORY only — do NOT re-run the DDL:

```sql
update supabase_migrations.schema_migrations
set version = '20260715140000'
where version = '20260715214425' and name = 'add_invoice_tax_snapshot';
```

Confirm:

```sql
select version, name from supabase_migrations.schema_migrations
where name = 'add_invoice_tax_snapshot';   -- expect 20260715140000
```

## B. The new migration — `20260717120000_billing_lockout.sql`

Apply the file as-is (it is idempotent and wrapped in a transaction). It:

1. Creates `public.billing_lockout_events` — the per-Cairo-day idempotency ledger
   for the lockout cron. RLS ON with ZERO policies (deny-by-default, server-managed,
   the same posture as `card_charge_intents` / `billing_nudges`). Only the
   service-role cron writes it.
2. Seeds the tunable knobs (WHERE NOT EXISTS, so a later tuned value is never
   overwritten): `billing.lockout.enabled` = true, `billing.lockout.retry_times_cairo`
   = `["09:00","14:00","19:00"]`, `billing.lockout.reminder_time_cairo` = `"17:00"`.
3. Part 5: sets `summer.pay_window_days` = 1 (was 2).
4. Part 4: deletes the five dead `late_fee_*` keys.

Confirm after apply:

```sql
select to_regclass('public.billing_lockout_events') as ledger;  -- not null
select key, value from platform_config
where key like 'billing.lockout%' or key = 'summer.pay_window_days'
order by key;                                                    -- 3 lockout keys + pay_window = 1
select count(*) from platform_config where key like 'late_fee_%'; -- 0
select relrowsecurity from pg_class where oid='public.billing_lockout_events'::regclass; -- true
select count(*) from pg_policy where polrelid='public.billing_lockout_events'::regclass; -- 0
```

## C. Part 4 — late-fee key call sites (reported before deletion)

The five keys (`late_fee_grace_days`, `late_fee_tier1_rate`, `late_fee_tier1_trigger_day`,
`late_fee_tier2_rate`, `late_fee_tier2_trigger_day`) were read by exactly ONE module
in live code: the admin config editor `src/app/[locale]/admin/platform-config/page.tsx`
(number-editor special-casing for the two `*_rate` keys, plus the `isLateFeesDormancyKey`
grouping). Those dead branches are removed in this PR. The other `late_fee` hits
(`ScanTab.tsx:1048`, `sync.ts:60`, `db.ts:137`) are the offline late-ENTRY scan
payload, unrelated to these keys, and are untouched. The invoice columns
`late_fee_rate`, `late_fee_amount`, `days_overdue` are LEFT in place (column drops
are a separate decision).

## D. Do NOT change

- `summer.first_charge_release` stays `HELD`. Only Eyad flips it, per the launch
  sequence, after a real test payment.
- `PAYMOB_RECURRING_INTEGRATION_ID` stays as-is (currently the placeholder). The
  interlock treats `unset` / empty / `placeholder` as "not configured".
- Invoice `INV-007-2026-07` is untouched (still `total_amount` 1020, `vat_amount`
  125.26, status pending). The lock does not modify invoices.

---

## Live facts verified 2026-07-17 (production `lczmjpnbuhnsislcvzar`)

- `platform_config`: `summer.first_charge_release` = HELD, `summer.pay_window_days`
  = 2, `subscription_dunning_max_attempts` = 3, `cron_paused` = false, the five
  `late_fee_*` keys present, no `billing.lockout.*` keys.
- `centers`: 2 rows, both `is_test = true`. "Test Owner Center" is active with
  `next_payment_due` 2099-12-31 (never lock-eligible). "Test Center 333" is already
  `status='suspended'` (caught by the suspension branch, which precedes and is
  independent of the billing-lock branch). So wiring the interlock into the existing
  middleware lock changes nothing observable today.
- `platform_config` RLS: `platform_config_read_all` (authenticated, qual true) — so
  the middleware's authenticated client can read the gate keys with no service-role.
- `invoices` amount column is `total_amount` (not `total`/`amount`); `vat_amount`,
  `invoice_number`, `status`, `due_date` present. `total`/`amount`/`currency` do NOT
  exist — the lock screen reads `total_amount`.
