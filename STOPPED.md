# STOPPED — pricing rollout checkpoints

> HISTORICAL — point-in-time audit checkpoints from the 2026-05-09 pricing rollout. Preserved as a record. Re-checked against live on 2026-07-18: the Enterprise price baseline (`18499` EGP/mo) is still current, but several SQL snippets below reference `public.centers` columns that **no longer exist** — see the inline notes. Do not run them as-is.

## Post-deploy verification

Eyad runs manually after deploy:

```sql
SELECT id, name, plan_key, monthly_price, status
FROM public.centers
WHERE plan_key = 'enterprise'
  AND is_test = false
  AND monthly_price != 18499;
```

> ⚠️ STALE QUERY (verified 2026-07-18): `public.centers` has **no** `plan_key` column and **no** `monthly_price` column today (only `plan` and `all_in_price` exist). This exact query would error. The Enterprise baseline is still `18499` EGP/mo (verified 2026-07-18 against `pricing_plans`); to check it live, use `centers.all_in_price` and `centers.plan`, or `pricing_plans`.

Any rows indicate live Enterprise centres whose stored monthly inclusive price does not match the fixed Enterprise tier (`18499` EGP/mo per pricing spec baseline). Investigate before treating pricing/MRR as authoritative.

## Top Centers (`plan_key = top_centers`)

Centres **must** have `all_in_price` set for Top Centers tier. Application code calls `requireTopCentersAllInPrice` where tier pricing is resolved; missing values trigger Sentry and throw.

## Duplicate centre phones (before `centers_phone_unique` migration)

```sql
SELECT phone, count(*) AS n, array_agg(id) AS center_ids, array_agg(name) AS names, bool_or(is_test) AS any_test
FROM public.centers
WHERE phone IS NOT NULL AND trim(phone) <> ''
GROUP BY phone
HAVING count(*) > 1;
```

If non-test centres share a phone, resolve data before applying `20260509120000_centers_phone_unique.sql`.

## Overdue without next due (B3)

```sql
SELECT id, name, status, next_payment_due
FROM public.centers
WHERE status = 'overdue' AND next_payment_due IS NULL AND is_test = false;
```

If rows exist: backfill / fix invoice triggers so `next_payment_due` is set; auto-suspend cron needs a date.

## Starter price normalisation (B4)

Migration `20260509120001_normalize_starter_monthly_price.sql` sets `monthly_price` from 4500 → 4499 for non-test Starter centres. Confirm with Eyad if any centre should intentionally stay at 4500.

> ⚠️ Historical (verified 2026-07-18): `centers.monthly_price` no longer exists (see top banner); the current Starter baseline is `4499` in `pricing_plans`. This checkpoint is a record of the 2026-05-09 rollout, not a runnable step today.

## Verification 2026-05-09 — deterministic centre UUID patterns (M7 / F-605)

Eyad runs manually:

```sql
SELECT id, name, status, created_at
FROM public.centers
WHERE is_test = false
  AND (
    id::text LIKE '%-1111-%'
    OR id::text LIKE '%-2222-%'
  );
```

Any rows are live centres with predictable UUIDs (security smell). Decision: re-issue UUIDs (destructive FK updates) or accept as residual risk.

## Admin nav 404 triage (M8)

Walked 2026-05-09 against `AdminSidebar.tsx` hrefs and matching pages under `src/app/[locale]/**/admin/**`:

- `/admin/health`, `/admin/referral-rewards`, `/admin/staff`, `/admin/center-assignments`, `/admin/commissions`, `/admin/payouts` — `page.tsx` present.
- Primary admin tabs resolve on `/admin` (overview, billing, etc.). Flag any new 404 here if product adds links without routes.

RTL / bidirectional UI residuals are gated by `npm run check:bidi` (also runs in `npm run build`).

---

## Post-finalization residual queries (Prompt 7 audit closure)

Run manually after stabilization doc lock:

- **Phone uniqueness duplicates** — Prompt 6 PART B1 (`centers_phone_unique` / duplicate SQL in section above).
- **“Not set” Next Due overdue centres** — Prompt 6 PART B3 (overdue without `next_payment_due`).
- **Starter price drift** — Prompt 6 PART B4 (normalisation migration confirmation).
- **Deterministic UUID prod centres** — Prompt 6 PART M7 (pattern SQL above).
- **Enterprise mispricing** — Prompt 5 Step 10 (Enterprise `monthly_price` vs `18499` baseline).
- **New Prompt 7 gaps** — mobile 375 screenshots under `tests/e2e/__screenshots__/375px/`, RTL grep residuals, security HMAC matrix with live secrets.

---

## Audit closure 2026-05-09

All catalogued findings have a documented disposition (see `docs/tracker_disposition_v4.md`). Pre-launch blockers remaining are operational / manual verification only (SQL in this file, secrets on staging for webhook probes), not undeployed code gaps.
