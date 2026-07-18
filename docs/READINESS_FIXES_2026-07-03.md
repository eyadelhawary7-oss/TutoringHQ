# Readiness Findings — Fixes (2026-07-03)

> HISTORICAL fixes record (2026-07-03), synced against the live database and code on 2026-07-18. The WhatsApp-template submission lists were introspected on 2026-07-03 and are point-in-time — `wa_meta_templates` now has **45 rows** live (2026-07-18), so those specific "no row / not APPROVED" tallies have moved. Still current: the retired-domain safety net (code fallbacks default to `https://tutoringhq.app`, not the retired `centerhq.app`), and the `dormancy_trigger_day` (30) / `dormancy_data_retention_months` (12) config keys still exist (verified live 2026-07-18). Eyad's manual-task list is preserved as-was.

One branch (`claude/readiness-findings-fixes-mh33gj`), one commit per fix, ordered smallest/safest
first. Fix 6 was rebuilt per Eyad's final decision: **no automatic, time-based cleanup of any
kind** — see its section. Pricing and the summer engine were not touched.

---

## Fix 1 — Invoices page not protected

**Before:** `/invoices` was missing from `AUTHENTICATED_ROUTE_PREFIXES` in the middleware, so an
anonymous request reached the page code (its own redirect then sent visitors to
`/settings/billing`, whose wall bounced them to login). The prefix itself had no session check and
none of the suspended/blacklisted-center gating every other dashboard page gets.

**After:** the middleware walls `/invoices` directly — an anonymous `GET /ar/invoices` is redirected
to `/ar/login` before any page code runs. Verified on a running dev server:

```
BEFORE  GET /ar/invoices -> 307 Location: /ar/settings/billing   (page code ran unauthenticated)
AFTER   GET /ar/invoices -> 307 Location: /ar/login              (middleware wall)
```

There is no visual difference for a real user (both paths end at the login screen), so the only
screenshot that exists is the after-state: unauthenticated `/ar/invoices` landing on the login page.

- Files: `src/proxy.ts` (one line).
- Commit: `Protect /invoices behind middleware auth`.

## Fix 2 — Payment-alert cron errors on every run

**Before:** `payment-alert` failed on every run (12 failures in the last 5 days of `cron_log`) with
`Could not embed because more than one relationship was found for 'invoices' and 'centers'`. Root
cause: the summer promo migration (`20260628110833_summer_2026_promo_billing`) added
`centers.summer_first_invoice_id → invoices(id)`, so PostgREST now sees **two** relationships
between `invoices` and `centers` and refuses any un-hinted `centers(...)` embed. Three more queries
had the same latent break: `payment-retry` (swallowed the error and silently processed **zero**
invoices), the admin invoice CSV export, and center invoice PDF generation.

**After:** all four embeds pin the intended relationship with an explicit FK hint
(`centers!invoices_center_id_fkey`), the same pattern the referral crons already use.

- Files: `src/app/api/cron/payment-alert/route.ts`, `src/app/api/cron/payment-retry/route.ts`,
  `src/app/api/admin/export/invoices/route.ts`, `src/lib/generateInvoicePdf.ts`.
- Tables: `invoices`, `centers` (no schema change).
- Commit: `Disambiguate invoices->centers embeds broken by summer FK`.

## Fix 3 — Enrollment OTP variable order

**Before:** the `chq_enrollment_otp` template body (documented at the send site) is
`"كود تسجيلك في مجموعة {{1}}: {{2}}. صالح ١٠ دقايق."` — `{{1}}` = group name, `{{2}}` = code — but the
enqueue passed `params: [code, groupName]`, so the code would have rendered in the group-name slot
and vice versa. (The template has no `wa_meta_templates` row and is not yet in Meta, so nothing had
been sent wrong yet — it would have been wrong on day one.)

**After:** `params: [groupName, code]`, with the expected order documented beside the payload.

- Files: `src/app/api/join/g/[groupId]/send-otp/route.ts`.
- Commit: `Fix enrollment OTP template variable order`.

## Fix 4 — OTP messages never send

**Before:** parent-join and teacher-signup OTPs were enqueued into `webhook_outbox` as
`send_enrollment_otp_wa` / `send_teacher_signup_otp_wa`, but the `process-outbox` cron only handled
`send_wa_payment_confirmed`, `send_card_order_status_wa`, and `send_billing_nudge_wa`. Both OTP job
types fell into the unknown-type branch, retried five times, and dead-lettered. **No OTP could ever
deliver** — the real reason parent self-enrollment half-works. (Live `webhook_outbox` currently has
no rows of either type, so there is no backlog to replay; expired OTPs must not be resent anyway.)

**After:** `src/lib/otpOutboxHandler.ts` dispatches both job types through the center-agnostic
sender (`sendNudgeWhatsapp`, `ar_EG`), gated the same way as every other template send
(`wa_sending_enabled` + APPROVED row in `wa_meta_templates`) — but a gated/failed OTP **throws**, so
it retries and dead-letters visibly (Sentry + CEO action) instead of silently marking done. Tests
prove a queued OTP of each type is picked up by the cron, sent with the right params and language,
marked `done`, and scheduled for retry when the send fails.

- Files: `src/lib/otpOutboxHandler.ts` (new), `src/app/api/cron/process-outbox/route.ts`,
  `src/lib/centerNotify.ts` (export), both send-otp routes,
  `tests/unit/otpOutboxHandler.test.ts`, `tests/unit/api/cron-process-outbox-otp.test.ts`.
- Tables: `webhook_outbox`, `dead_letter_queue`, `wa_meta_templates` (reads only).
- Commit: `Deliver queued OTPs: add outbox handlers for both OTP job types`.
- Note: delivery still requires the two templates to be approved in Meta (see Fix 5 list).

## Fix 5 — Template-gated sends with no approved row

**How `wa_meta_templates` rows are created:** three ways — (1) seed migrations (several of which did
**not** survive the baseline consolidation, which is why templates like `chq_balance_reminder` and
`chq_reenrollment` that were once seeded APPROVED have no live row); (2) manual SQL (the `IN_REVIEW`
rows dated 2026-04-15); (3) the super-admin **sync button**
(`POST /api/admin/whatsapp/sync-templates`) — which was **broken**: it queried
`GET /{phone_number_id}/message_templates`, but Meta serves template listings on the WhatsApp
**Business Account** edge (`/{WABA_ID}/message_templates`). It also hard-coded `variables_count: 0`
on every upsert. There is no Meta webhook for template status and no cron — so even a correct
manual sync only happened when someone clicked the button.

**After:** shared sync lib (`src/lib/waTemplateSync.ts`) uses `WHATSAPP_BUSINESS_ACCOUNT_ID`,
requests `name,status,category,components`, derives `variables_count` from the real body
placeholders (and never clobbers a known count), and runs two ways: the admin button and a **new
hourly cron** `/api/cron/sync-wa-templates`. Once Eyad approves a template in Meta, its row appears
within the hour and the gated send fires — no clicks required.

- Files: `src/lib/waTemplateSync.ts` (new), `src/app/api/admin/whatsapp/sync-templates/route.ts`,
  `src/app/api/cron/sync-wa-templates/route.ts` (new), `vercel.json`,
  `src/lib/vercelCronDefinitions.ts`, `tests/unit/waTemplateSync.test.ts`.
- Tables: `wa_meta_templates`, `cron_log`, `cron_health_log`.
- Commit: `Keep wa_meta_templates mirrored from Meta (fix sync + hourly cron)`.
- Env needed on Vercel: `WHATSAPP_BUSINESS_ACCOUNT_ID` (the submit script already documents it);
  the cron no-ops cleanly until it is set.

### Templates Eyad must submit/approve in Meta (live table introspected 2026-07-03)

**No `wa_meta_templates` row at all — the send silently skips (13):**

| Template | What it gates |
|---|---|
| `chq_enrollment_otp` | Student self-enrollment OTP (ar_EG; {{1}} group, {{2}} code) |
| `chq_teacher_signup_otp` | Teacher signup OTP (1 var: code) |
| `chq_pin_setup_link` | PIN setup link (cross-device login fallback) |
| `chq_parent_consent` | Parent consent request |
| `chq_balance_reminder` | Balance reminder |
| `chq_reenrollment` | Re-enrollment campaign (MARKETING) |
| `chq_credit_expiry` | Credits expiring in 30 days |
| `chq_inactivity_day3` | Churn: day-3 inactivity nudge |
| `chq_internal_churn_alert` | Churn: internal sales alert |
| `chq_checkin_day3` | Onboarding: day-3 check-in |
| `chq_payments_guide` | Onboarding: payments guide |
| `chq_week1_summary` | Onboarding: week-1 summary |
| `chq_referral_intro` | Onboarding: referral intro |

**Row exists but not APPROVED — the send silently skips (16):**

- `IN_REVIEW` (since April, likely stale — the fixed sync will pick up the truth):
  `chq_pin_delivery` (PIN delivery), `chq_onboarding_step2`, `chq_onboarding_step3`,
  `chq_onboarding_step4`, `chq_team_invite`, `chq_order_shipped`, `chq_referral_commission`,
  `chq_withdrawal_processed`, `chq_upgrade_nudge`
- `PENDING`: `chq_fee_reminder`, `chq_card_order_status_update`, `chq_card_order_paid`,
  `chq_card_order_in_production`, `chq_card_order_in_transit`, `chq_card_order_delivered`,
  `chq_card_order_cancelled`

**Deliberately pending (deferred, do NOT submit as part of this build):** the four billing-nudge
templates `chq_nudge_prebill`, `chq_nudge_due_today`, `chq_nudge_locked`, `chq_nudge_card_expiry` —
the nudge switch is off on purpose until they are approved and Eyad flips it.

**Reworded, must be RESUBMITTED:** `chq_data_deletion_notice` — see Fix 6.

## Fix 6 — Deletion & retention (final: no automatic cleanup of any kind)

**Eyad's decision:** no automatic, time-based cleanup. No data is masked, anonymized, or deleted on
a timer. The only way a student's personal data is ever removed is the existing on-request
privacy-request erasure.

**Before (state of master):** a monthly `dormancy-warnings` cron existed whose job was to warn
long-dormant centers at months 9 and 11 and, at month 12, export the center's data to Drive and
**hard-delete** payments, students, attendance, groups, rooms, parent records, and card orders. It
was doubly broken — it crashed on a `centers.dormancy_purged_at` column that never existed in the
live database, and nothing had marked a center dormant since the June billing-model change — but as
written it violated both the five-year financial-retention rule and, now, the no-timer decision.

**After:**

- **Nothing time-based remains.** The `dormancy-warnings` cron route and both of its registrations
  (`vercel.json` crons + functions, `src/lib/vercelCronDefinitions.ts`) are removed. The
  delete-based purge library (`src/lib/dormantCenterPurge.ts`) is removed. The earlier fix-6 work
  from this branch (the `dormancy_purged_at` migration, the restored dormancy scan, the
  strip-at-12-months purge) was **dropped from the branch entirely** — no migration ships, and the
  live database was never touched (verified by introspection: the column does not exist, and there
  are 0 dormant centers).
- **On-request erasure is untouched.** The privacy-request anonymize route
  (`src/app/api/admin/privacy-requests/anonymize/route.ts`) is byte-identical to master on this
  branch.
- **Warning messages:** after the removal, **nothing in the codebase sends**
  `chq_dormancy_notice`, `chq_reactivation_warning_90`, `chq_reactivation_warning_30`, or
  `chq_data_deletion_notice` (the four dead sender functions in `centerNotify.ts` were removed as
  dead code). The templates themselves remain in `wa_meta_templates` and in Meta, now **unused** —
  no new trigger was wired, on purpose.
- **Deletion-notice wording fixed:** the old `chq_data_deletion_notice` body claimed data was
  permanently deleted after 12 months — false under the new rule. New body (Arabic EGY, plain,
  matching the consent style), one variable `{{1}}` = student name (example: أحمد):

  > تم حذف البيانات الشخصية لـ {{1}} بناءً على طلب. السجلات المالية بتتحفظ حسب القانون.

  Updated in `scripts/submit-dormancy-wa-templates.mjs`. **It must be resubmitted in Meta for the
  new wording to take effect — Eyad's task.** Once resubmitted, the fix-5 hourly sync mirrors the
  new status and variable count automatically.

- Files: `src/app/api/cron/dormancy-warnings/route.ts` (deleted), `src/lib/dormantCenterPurge.ts`
  (deleted), `src/lib/centerNotify.ts` (dead senders removed), `vercel.json`,
  `src/lib/vercelCronDefinitions.ts`, `scripts/submit-dormancy-wa-templates.mjs`.
- Tables: none changed; no migration on this branch. Inert leftovers kept deliberately to avoid
  schema churn: `centers.dormancy_date` column (still read by the invoice PDF query),
  `platform_config` keys (`dormancy_trigger_day`, `dormancy_data_retention_months`), and the four
  template rows.
- Commits: `Remove time-based dormancy/purge machinery entirely`,
  `Reword chq_data_deletion_notice for on-request erasure`.

## Extra (from the brief's safety-net line)

`tests/unit/retiredDomainSafetyNet.test.ts` fails if a configured public URL
(`NEXT_PUBLIC_APP_URL` / `APP_URL`) points at the retired `centerhq.app`, or if any `src/` file
references it again (the middleware CORS allowlist keeps the legacy origins on purpose during the
cutover and is the one exception). All code fallbacks that still defaulted to
`https://centerhq.app` now default to `https://tutoringhq.app`. The env values on Vercel and
Supabase remain Eyad's dashboard task.

---

## Verification

- Full unit suite green, `lint` 0 errors, `typecheck` clean, `verify:stabilization`
  (i18n / bidi / tolocale) green.
- Schema: **no migration on this branch**; `db/schema.snapshot` is identical to master, so the
  migrations-vs-snapshot drift gate is trivially green. The **live** drift gate stays
  red-by-design until the `SCHEMA_DRIFT_DATABASE_URL` secret is added (dead since June 27).
- Live DB was introspected read-only throughout. **No writes were made to production.**

## Eyad's manual tasks

1. Set `NEXT_PUBLIC_APP_URL` (Vercel) and `APP_URL` (Supabase) to `https://tutoringhq.app`.
2. Add the read-only `SCHEMA_DRIFT_DATABASE_URL` repo secret to revive the daily live drift alarm.
3. Submit/approve the WhatsApp templates listed under Fix 5 in Meta Business Manager — **including
   resubmitting the reworded `chq_data_deletion_notice`** — and set
   `WHATSAPP_BUSINESS_ACCOUNT_ID` on Vercel so the hourly sync can mirror the approvals.
4. Check Paymob/Vercel key mode (live vs test) and the Supabase auth URL config.
5. After approving the four `chq_nudge_*` templates (separate decision): flip the billing-nudge
   switch. Deferred on purpose, untouched here.
