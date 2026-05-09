# Audit seed (manual apply only)

Seeds six phone+PIN accounts and two centers for automated UI audits (e.g. Cowork). The migration file is applied **manually** — CI does not run Supabase migrations.

## Login URLs

| Environment | URL |
|-------------|-----|
| Production | https://centerhq.app/en/login |
| Dev / staging | Use your dev tenant URL (same `/en/login` path pattern). |

## Phone + PIN

| Role (conceptual) | Phone | PIN |
|-------------------|-------|-----|
| Super admin (`admin_users.role = super_admin`) | +201111111111 | 111111 |
| Internal admin (`admin_users.role = admin`) | +201222222222 | 222222 |
| Owner — Elite Test Center | +201333333333 | 333333 |
| Assistant — Elite Test Center | +201444444444 | 444444 |
| Owner — minimal center | +201555555555 | 555555 |
| Assistant — minimal center | +201666666666 | 666666 |

Auth email format (Supabase): `{digits}@centerhq.local` (e.g. `201111111111@centerhq.local`).

**Phone-based super admin:** `SUPER_ADMIN_PHONES` env must include the normalized phone if you rely on `isSuperAdminPhone()` for extra privileges.

## Center UUIDs and seeded data

### `cccccccc-1111-1111-1111-111111111111` — Elite Test Center (سنتر النخبة للاختبار)

- **plan:** `starter`; optional **plan_key** / pricing columns updated when present (`4499`).
- **Terms:** `terms_version = v1-2026-05`, `terms_accepted_at` set (~89 days after creation).
- **Students:** 50 (`STU-00001` … `STU-00050`), Arabic names, grades 7–12 in `subject`, 45 active / 5 inactive, 30 with `parent_pack_opted_in`, notes `__audit_seed__`.
- **Invoices:** 12 rows — 8 paid `subscription`, 2 pending `subscription`, 1 pending `signup_first_payment`, 1 rejected `subscription`. No Paymob / external payment IDs.
- **Attendance:** 30 `attendance_scans` over the last ~14 days (links to active student indices 1–45).
- **Daily metrics:** 30 `center_metrics_daily` rows (last 30 days) with `health_score` only (date column auto-detected: `metric_date` or `day`).
- **schedule_slots:** intentionally **not** seeded (requires rooms, subjects, teachers). See migration TODO.

### `cccccccc-2222-2222-2222-222222222222` — Minimal center (سنتر بسيط)

- **plan:** `solo`; optional **plan_key** pricing `999` when columns exist.
- **Students:** 3 (`STU-90001` … `STU-90003`).
- **Invoices:** 1 pending `subscription`.
- No scans, no daily metrics.

## Apply scripts

**Production** (interactive confirmation):

```bash
./scripts/audit/seed-prod.sh
```

**Dev tenant** (requires `SUPABASE_DEV_PROJECT_REF`):

```bash
export SUPABASE_DEV_PROJECT_REF="your-dev-project-ref"
./scripts/audit/seed-dev.sh
```

Both run `supabase db push --project-ref …` so **all pending migrations** are applied, not only this file.

## Teardown (SQL)

Run in the Supabase SQL editor (or `psql`) as a privileged role. Order respects FKs. Adjust `metric_date` vs `day` for `center_metrics_daily` if your schema differs.

```sql
BEGIN;

DELETE FROM public.attendance_scans
WHERE center_id IN (
  'cccccccc-1111-1111-1111-111111111111',
  'cccccccc-2222-2222-2222-222222222222'
);

DELETE FROM public.invoices
WHERE center_id IN (
  'cccccccc-1111-1111-1111-111111111111',
  'cccccccc-2222-2222-2222-222222222222'
);

DELETE FROM public.center_metrics_daily
WHERE center_id IN (
  'cccccccc-1111-1111-1111-111111111111',
  'cccccccc-2222-2222-2222-222222222222'
);

DELETE FROM public.students
WHERE center_id IN (
  'cccccccc-1111-1111-1111-111111111111',
  'cccccccc-2222-2222-2222-222222222222'
);

DELETE FROM public.admin_users
WHERE id IN (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'aaaaaaaa-2222-2222-2222-222222222222'
);

DELETE FROM public.users
WHERE id IN (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'aaaaaaaa-2222-2222-2222-222222222222',
  'aaaaaaaa-3333-3333-3333-333333333333',
  'aaaaaaaa-4444-4444-4444-444444444444',
  'aaaaaaaa-5555-5555-5555-555555555555',
  'aaaaaaaa-6666-6666-6666-666666666666'
);

DELETE FROM public.centers
WHERE id IN (
  'cccccccc-1111-1111-1111-111111111111',
  'cccccccc-2222-2222-2222-222222222222'
);

DELETE FROM auth.users
WHERE id IN (
  'aaaaaaaa-1111-1111-1111-111111111111',
  'aaaaaaaa-2222-2222-2222-222222222222',
  'aaaaaaaa-3333-3333-3333-333333333333',
  'aaaaaaaa-4444-4444-4444-444444444444',
  'aaaaaaaa-5555-5555-5555-555555555555',
  'aaaaaaaa-6666-6666-6666-666666666666'
);

COMMIT;
```

UUID “ranges” used by this seed: `aaaaaaaa-1111…6666`, `cccccccc-1111…2222`, invoice IDs `ffffffff-1111-1111-1111-111111111101`–`112` and `ffffffff-2222-2222-2222-222222222201`.
