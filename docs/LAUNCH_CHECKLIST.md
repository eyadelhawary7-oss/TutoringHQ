# Launch checklist — TutoringHQ

> Synced against the live database and code on 2026-07-18, with the
> never-run code paths section added 2026-07-28. Environment is still
> pre-launch / test-data only (re-verified live 2026-07-28: 2 centres, 1 active,
> 4 students, 0 parent-pack opt-ins). Live product domain is **tutoringhq.app**.

## Pre-launch (blocking)

- Vodafone postpaid SIM (WhatsApp + SMS fallback).
- Paymob **live** credentials & webhook URLs pinned to production. Note: `PAYMOB_RECURRING_INTEGRATION_ID` is still a **placeholder**, so the saved-card / single-day billing-lockout path is built but **inert** until a real recurring integration ID is set (verified 2026-07-18).
- EHG registration via Adsero (commercial entity billing).
- Vercel env: `NEXT_PUBLIC_APP_URL`, `WHATSAPP_APP_SECRET`, `BOSTA_WEBHOOK_SECRET`, `VENDOR_WHATSAPP_NUMBER`, `ADMIN_WHATSAPP_NUMBER`, `BACKUP_DRIVE_FOLDER_ID`.
- Bosta merchant onboarding complete.
- Meta Business Verification (after SIM stabilizes).
- Brand lock: Looka logo + printed business cards.

## Day 1

- Redeploy after secrets applied.
- Smoke: signup funnel → dashboard, scanner admit path, admin finance loads non-zero aggregates (`is_test = false` default).
- Run `npx tsx scripts/security-audit.ts --all` with production base URL.

## Day 1–7 monitoring

- Sample `audit_log` for unusual admin mutations.
- Finance dashboard MRR sanity vs prior week.
- Cron heartbeat / logs — each scheduled job ran.
- `webhook_inbox` / DLQ — no stuck poison rows.

## Code paths that have never run in production

These are correct as far as tests and review can tell, and have **never been
exercised against real data**. A green test suite is not evidence that they
work — it is evidence that they do what we think they should. Watch the first
real run of each rather than assuming.

### Parent absence alerts — watch the first live run

`/api/cron/parent-absence-alerts`, scheduled `0 19 * * *`.

**It has never fired once, in the entire life of the feature.** It compared
`schedule_slots.day_of_week` against a day *name* (`"monday"`) while the column
stores a JS weekday as *text* (`"1"`), so the query matched zero rows on every
run and the send loop never executed. Fixed in **#194** (`ae352f9`), which also
added `tests/unit/scheduleSlotsDayOfWeek.test.ts` to stop the convention drifting
again. **The fix is untested by reality.**

**What triggers the first run.** Two independent gates, both currently closed
(verified live 2026-07-28 — 2 centres, 1 active):

1. a centre with `centers.parent_pack_enabled = true` **and**
   `subscription_status = 'active'` — today both centres are `false`; and
2. at least one student with `students.parent_pack_opted_in = true`, a
   `parent_phone`, and `is_active` not false — today 0 of 4.

Opt-in is **per student and defaults false**, so enabling the pack on a centre is
not by itself enough to start sending. The first centre to enable it will not
get a retroactive blast.

**Everything else is already armed:** `platform_config.cron_paused = false`, and
the `chq_parent_absence` template is **APPROVED** in `wa_meta_templates`. So the
gap between "a centre enables the pack and a parent opts in" and "parents receive
WhatsApp messages that evening" is hours, not a deploy.

**On that first run, check:**

- `cron_log` for `parent-absence-alerts` — `records_processed` should be
  non-zero if any opted-in student missed a class that day, and **zero is only
  correct if nobody was actually absent**. Zero with known absentees means the
  slot query still is not matching.
- The messages went to the **right parents for the right day** — the failure
  this replaces was a day-matching bug, so verify the day, not just delivery.
- No duplicates. Dedup is `sentToday`, which is per-invocation only; a retry or
  a second run in one day would re-send.

**No backlog risk:** the cron only looks at the current Cairo day's slots and
that day's attendance, so nothing accumulated during the period it silently
matched nothing.
