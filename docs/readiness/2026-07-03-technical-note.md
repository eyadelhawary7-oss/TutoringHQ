# Readiness Pass — Technical Note (3 July 2026)

Companion to `2026-07-03-readiness-report.md`. All evidence is from the repo at `master` (13aed7a) and the live Supabase catalog (project `lczmjpnbuhnsislcvzar`), read-only. No secret values were read or printed; env presence was inferred from behavior only.

---

## 1. WhatsApp templates — code send-sites vs the approval mirror

### Send helpers (three, independent)

| Helper | File | Variables | Language | Gates |
|---|---|---|---|---|
| `sendTemplateMessage` | `src/lib/whatsapp/client.ts:120` | `Record<string,string>`; order = `bodyParameterOrder` else `Object.keys().sort()` (alphabetical!) | hardcoded `ar` | `isTemplateApproved` + `platform_config.wa_sending_enabled` + test-phone-id skip; logs to `wa_message_queue` |
| `postWhatsappTemplate` via `send*` fns | `src/lib/centerNotify.ts:126` | positional `string[]` | `ar` / `ar_EG` per call | callers use `canSendApprovedTemplate` (`centerNotify.ts:93`) = `wa_sending_enabled` && `wa_meta_templates.status==='APPROVED'` (`centerNotify.ts:37-46`); "no row" ⇒ blocked |
| `sendNudgeWhatsapp` | `src/lib/nudges/send.ts:29` | positional `string[]` | `ar` | `NUDGE_WHATSAPP_ENABLED==='true'` (`src/lib/nudges/config.ts:49`, default OFF) + `isTemplateApproved` |

Graph API versions differ (v19.0 in client.ts, v18.0 in centerNotify/nudges). Phone-id envs differ per path: template paths read `PHONE_NUMBER_ID`/`WHATSAPP_PHONE_ID`; freeform `src/lib/whatsapp.ts:3` reads `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`.

### Live mirror table `wa_meta_templates` (46 rows, live DB)

- APPROVED: `chq_welcome`, `chq_ceo_briefing`, `chq_daily_summary`, `chq_weekly_summary`, `chq_data_deletion_notice`, `chq_dormancy_notice`, `chq_inactivity_alert`, `chq_onboarding_step1`, `chq_pack_invoice`, `chq_parent_absence`, `chq_parent_announcement_ops/promo`, `chq_parent_balance_due`, `chq_parent_term_summary`, `chq_parent_welcome`, `chq_payment_confirmed/failed/retry`, `chq_reactivation_warning_30/90`, `chq_renewal_overdue/reminder`, `chq_scan_notification`, `chq_vendor_new_order`, `chq_withdrawal_processed`→IN_REVIEW (see below).
- PENDING: `chq_nudge_prebill/due_today/locked/card_expiry` (updated 2026-06-24), `chq_fee_reminder`, all 7 `chq_card_order_*`.
- IN_REVIEW: `chq_pin_delivery`, `chq_onboarding_step2/3/4`, `chq_order_shipped`, `chq_team_invite`, `chq_upgrade_nudge`, `chq_referral_commission`, `chq_withdrawal_processed`.
- The table's `variables_count` column is unmaintained for most rows (0 for many templates the code sends with 2–8 vars) — do not treat it as Meta truth; use the code-side counts below.

### Code-side template inventory (name → vars → trigger)

| Template | Vars (code) | Send site | Trigger | Blocked today? |
|---|---|---|---|---|
| `chq_nudge_prebill` | 4 `[name, amount, days, payUrl]` | `src/lib/nudges/messages.ts:47` → outbox `send_billing_nudge_wa` | cron `billing-nudges` (T-3/T-1) | PENDING + `NUDGE_WHATSAPP_ENABLED` off — live `billing_nudges` rows show `channel_whatsapp_status='disabled'` |
| `chq_nudge_due_today` | 3 `[name, amount, payUrl]` | `messages.ts:54` | due-today/grace | same |
| `chq_nudge_locked` | 3 `[name, amount, payUrl]` | `messages.ts:54` | post-lock | same |
| `chq_nudge_card_expiry` | 4 `[name, last4, MM/YY, updateUrl]` | `messages.ts:63` | card expiry T-30/T-7 | same |
| `chq_pin_setup_link` | 1 `[setupUrl]` | `centerNotify.ts:1418` ← `api/auth/request-pin-setup-link/route.ts:137` | owner PIN-setup link | **No row in mirror ⇒ never sends** |
| `chq_pin_delivery` | 1 `[otp]` | `centerNotify.ts:1439` ← `api/auth/reset-pin/route.ts:100` | PIN reset OTP | IN_REVIEW ⇒ never sends |
| `chq_enrollment_otp` | 2 `[code, groupName]` — **swapped vs documented body `{{1}}=group, {{2}}=code`** | enqueued `api/join/g/[groupId]/send-otp/route.ts:129` | parent join OTP | **No outbox handler in `api/cron/process-outbox/route.ts:91-112` ⇒ queued, never sent** (TODO at `send-otp/route.ts:31`) |
| `chq_teacher_signup_otp` | 1 `[code]` | enqueued `api/auth/teacher/signup/send-otp/route.ts:126` | teacher signup OTP | **No outbox handler ⇒ never sent** |
| `chq_class_cancelled` / `chq_class_rescheduled` / `chq_schedule_changed` / `chq_class_reminder` | — | `src/lib/teacherScheduleNotifications.ts:14,24,35,54` — **all no-op stubs** (`console.info` only) | first three called from `api/teacher/private/groups/[groupId]/route.ts:179` and `.../schedule/exceptions/route.ts:202,209`; reminder has **no caller** | No send code, no mirror rows, no Meta submission |
| `chq_renewal_overdue` | 3 | `centerNotify.ts:487` | `subscriptionBillingCron.ts:269,347`; `payment-retry` urgent | APPROVED |
| `chq_payment_retry` | 4 | `centerNotify.ts:455` | cron `payment-retry:189` | APPROVED |
| `chq_payment_confirmed` | 3 | `centerNotify.ts:772` | outbox `send_wa_payment_confirmed` (`process-outbox/route.ts:98`) | APPROVED |
| `chq_payment_failed` | 2 | `centerNotify.ts:962` | `api/paymob/webhook/route.ts:17` | APPROVED; also gated by `platform_config.payment_failed_enabled` = **false** |
| `chq_credit_expiry` | 3 | `centerNotify.ts:864` | cron `expire-credits:157` | hardcoded `creditExpiryWaEnabled=false` (`expire-credits/route.ts:13`); no mirror row |
| `chq_pack_invoice` | 4 | `centerNotify.ts:821` | crons `parent-pack-billing:232`, `parent-pack/toggle:135` | APPROVED |
| `chq_data_deletion_notice` | 2 `[name, deletionDate]` | `centerNotify.ts:695` | `dormancy-warnings/route.ts:118` | APPROVED but pipeline dead (§3) |
| `chq_reactivation_warning_90` / `_30` | 2 each | `centerNotify.ts:590,643` | `dormancy-warnings/route.ts:124,127` (months 9 / 11) | APPROVED but pipeline dead |
| `chq_dormancy_notice` | 3 | `centerNotify.ts:538` | **no caller** | dead code |
| `chq_parent_welcome` | 3 | `studentParentPackWelcome.ts:66,100,134`; `api/settings/parent-pack:54` | pack opt-in | APPROVED |
| `chq_parent_absence` | 3 | cron `parent-absence-alerts:114` | daily | APPROVED |
| `chq_parent_balance_due` | 3 | cron `parent-balance-alerts:94` | daily, 7-day dedupe | APPROVED |
| `chq_parent_term_summary` | 6 (two consistent sites; langs differ `ar` vs `ar_EG`) | `api/parent-pack/term-summary:131`; `centerNotify.ts:1390` | manual/report | APPROVED |
| `chq_parent_consent` | 1 `[studentName]` | `api/parents/request-consent:58` | consent request button | **No mirror row ⇒ never sends** |
| `chq_scan_notification` | 4 | `parentNotifications.ts:150` ← `api/parents/notify-scan:40` | pack scan | APPROVED |
| `chq_balance_reminder` | 2 | `api/whatsapp/send-balance-reminder:81` | manual | **No mirror row** |
| `chq_reenrollment` | 2 | `api/students/re-enrollment-campaign:37` | manual campaign | **No mirror row** |
| `chq_fee_reminder` | 4 (explicit order) | cron `fee-reminders:306` | private-tutoring fees | PENDING |
| `chq_card_order_*` (7 names, picked dynamically) | 3 generic / 2 dedicated | `cardOrderNotifications.ts:36,206` via outbox | order lifecycle | all PENDING |
| `chq_vendor_new_order` | 4 body + 1 quick-reply button param | `centerNotify.ts:1303` | new vendor order | APPROVED |
| `chq_welcome` | **3** (`centerNotify.ts:1004`, includes literal `PLATFORM_URL`) vs **1** (`onboarding.ts:143`) | signup auto-approve; onboarding step 1 | APPROVED — count conflict |
| `chq_onboarding_step1/2/3` | 2–3 (`centerNotify.ts:1039,1074,1103`) vs **0** (`onboarding.ts:149,152,155`) | renewal cron / onboarding flow | step1 APPROVED, 2–3 IN_REVIEW — count conflicts |
| `chq_onboarding_step4` | 3 | `centerNotify.ts:1132` — **no caller** | — | IN_REVIEW |
| `chq_checkin_day3`, `chq_payments_guide` | 0 | `onboarding.ts:158,161` | onboarding flow (`api/whatsapp/process-onboarding-step:35`) | **No mirror rows** |
| `chq_week1_summary` | 3; `chq_referral_intro` 2 | `onboarding.ts:165,174` | onboarding flow | **No mirror rows** |
| `chq_team_invite` | 4 | `centerNotify.ts:1163` | team invite | IN_REVIEW |
| `chq_order_shipped` | 4 | `centerNotify.ts:1193` | shipping | IN_REVIEW |
| `chq_referral_commission` | 4 | `centerNotify.ts:1223` | commission | IN_REVIEW |
| `chq_withdrawal_processed` | 4 | `centerNotify.ts:1253` | payout decision | IN_REVIEW |
| `chq_inactivity_alert` | **4** (`centerNotify.ts:371`) vs **2** (`centerNotify.ts:1574`, called from `detect-churn`) | churn passes | APPROVED — count conflict |
| `chq_inactivity_day3` | 2 named keys, no order ⇒ alphabetical (happens correct) | `churnDetection.ts:45` ← `detect-churn:248` | day-3 churn | **No mirror row** |
| `chq_internal_churn_alert` | 5 named keys, no order ⇒ **sent alphabetically** `alert_type, center_name, days_inactive, last_scan, mrr_at_risk` | `churnDetection.ts:88` ← `detect-churn:264,290` | day-7 internal alert | **No mirror row + ordering bug** |
| `chq_weekly_summary` | **7** (`centerNotify.ts:918`, owner report) vs **2** (`parentNotifications.ts:200`, parent) | weekly crons | APPROVED — same name, 7 vs 2 vars, different audiences |
| `chq_ceo_briefing` | 7 | `ceoBriefing.ts:71` ← cron | needs `CEO_PHONE` | APPROVED |
| `chq_daily_summary` | 8 | `dailySummary.ts:95` ← cron + manual route | daily | APPROVED |

Freeform (non-template) text sends bypass the approval gate entirely — list in agent inventory; notable: waitlist notify, watchdog, token-health, pack-suspended notice, payment-retry follow-up links.

Live state: `platform_config.wa_sending_enabled = true`; `wa_message_queue` has **0 rows** (no `sendTemplateMessage` send has ever been logged in prod).

## 2. Schedule feature

Live row counts: `group_schedule` 4, `schedule_slots` 1, `schedule_exceptions` 0, `sessions` 3, `group_slot_proposals` 0.

- Center timetable: `src/app/[locale]/schedule/page.tsx` (reads :176, insert :302, delete :349 via db-proxy), sidebar-linked `src/components/Sidebar.tsx:124`, edit gated owner/admin/super_admin (page.tsx:115). **Built.**
- Slot proposals: teacher `api/teacher/group-slots/route.ts` (GET :74, POST→`propose_group_slot` :169); center `api/center/group-slots/route.ts:50` + `[slotProposalId]/respond/route.ts` (`confirm_group_slot` books `schedule_slots` :24-70); UI `src/components/teachers/GroupSlotsTab.tsx` mounted at `my-teachers/page.tsx:66`. **Built.**
- Teacher private schedule: `api/teacher/private/schedule/route.ts` (GET :81,:96), replace-all PATCH `.../groups/[groupId]/route.ts:155-163`, exceptions POST `.../schedule/exceptions/route.ts:177`; gates `requireTeacherPrivateAccess` + `requireTeacherUnderCap`. **Built — teacher portal only; no center-facing UI for group_schedule/exceptions/sessions.**
- Sessions: manual create/start/finish/cancel/attendance routes under `api/teacher/private/schedule/sessions/`; **no generation lib/cron** (grep `generateSessions|materialize` = 0). `vercel.json` has no session or class-reminder cron.
- Notifications: `src/lib/teacherScheduleNotifications.ts` — all four functions are no-op stubs; cancelled/rescheduled/changed are invoked (fail-open try/catch), reminder is not invoked anywhere.

## 3. Retention / deletion

- Cron `dormancy-warnings` registered `vercel.json:32` (`0 4 2 * *`, maxDuration 300). Logic `src/app/api/cron/dormancy-warnings/route.ts` + `src/lib/dormantCenterPurge.ts`.
- **Crash in prod:** `cron_log` 2026-07-02 04:00 — `column centers.dormancy_purged_at does not exist`. Code references it (`route.ts:84,95-103`); live catalog lacks it. Schema drift, undetected because the live drift gate is unconfigured (§4).
- **Dead trigger:** no code sets `centers.status='dormant'` or a non-null `dormancy_date`; the day-30 machinery exists only in `supabase/migrations_archive/20260410120000_late_fee_dormancy.sql`; `src/lib/billingLifecycle.ts:1-15` and `src/lib/renewalLateFeeDormancy.ts:1-10` document its removal. Only write to `dormancy_date` is `invoicePaymobPayment.ts:498` (sets null).
- Purge (`dormantCenterPurge.ts:152-183`) deletes: attendance_scans, **payments**, student_group_members, students, student_groups, schedule_slots, rooms, paid_parents, announcement_blasts, card_order_events, card_orders, parent_pack_monthly_counts — after CSV export of 10 tables to Drive (`EXPORT_TABLES` :10-21). Invoices + audit_log retained (header comment :3).
- **No 5-year rule** anywhere (grep `five|5.?year|retention` → UI strings + 30-day cohort analytics only). FK protection: `supabase/migrations/20260702103413_money_audit_fk_delete_rules.sql` (RESTRICT on audit_log/invoices/payments/commissions/credit_ledger/…; `parent_pack_billing.student_id` SET NULL). Note RESTRICT on `payments.center_id` does not stop the purge — it deletes payments rows directly, never the center row.
- `platform_config.dormancy_data_retention_months` = "12" and `dormancy_trigger_day` = "30" exist but are read by no code; cron hardcodes `months >= 12` and warnings at 9/11.
- Manual anonymization: `api/admin/privacy-requests/anonymize/route.ts` (super-admin + CSRF; strips student PII :88-101, deletes notes :107-108, audit-logs :111-120; keeps financial links per header :12-13; "Adsero-pending" note :16-18). Intake: `api/privacy-request/route.ts` (public, rate-limited, 30-day due-date derived in UI only — no SLA job).
- pg_cron in live DB: single job `backup-check-daily` (`0 4 * * *`) writing `backup_log`. No DB-side retention jobs.

## 4. Go-live wiring / config (presence only — no values read)

| Item | State | Evidence |
|---|---|---|
| `CRON_SECRET` | **Present + valid** | `cron_log`: 40+ distinct crons succeeded in last 24h incl. status-ping (2016 runs/7d), all behind `requireCronSecret` |
| `SCHEMA_DRIFT_DATABASE_URL` (read-only drift key, GitHub repo secret) | **Empty** | `schema-drift-live.yml` run 2026-07-02: `::error … SCHEMA_DRIFT_DATABASE_URL is not set`; failing daily since 06-27, last success 06-26 |
| App URL (web, `NEXT_PUBLIC_APP_URL`) | Value not readable from this session (Vercel MCP has no team scope); app answers on the configured URL — `status_checks` 24h: payments(=self `/api/health`) operational 286/288 | fallbacks: `centerhq.app` in `nudges/payLinks.ts:9`, `request-pin-setup-link/route.ts:132`; **`tutoringhq.app`** in `centerNotify.ts:7-10`, passed literally into `chq_welcome`/`chq_onboarding_step1` vars (`centerNotify.ts:1004,1043`) |
| Supabase auth URL config (site URL / redirect list) | **Not readable via available tooling** (no MCP tool; outbound probe policy-blocked). Verify in Dashboard → Auth → URL Configuration; code expects `{origin}/auth/callback` | — |
| Paymob keys live/test | **Unverifiable from here** (env-only: `PAYMOB_API_KEY`, `PAYMOB_INTEGRATION_ID`, `PAYMOB_IFRAME_ID`, `PAYMOB_HMAC_SECRET` — `src/lib/paymobConfig.ts`). Boot guard `paymobGuardLogic.ts:24-29` throws on sandbox-shaped keys in prod and the app boots — but empty keys also pass the guard | `getPaymobHealthMode()` exists for the admin health UI |
| Paymob callback | **Never exercised**: `webhook_inbox` 0 rows, `payments` 0 rows, `webhook_outbox` 0 rows. Callback URL config lives in the Paymob dashboard — check there | `api/paymob/webhook/route.ts:309-331` writes `webhook_inbox` on receipt |
| `PAYMOB_RECURRING_INTEGRATION_ID` | **Not yet issued** per code doc — auto-charge returns `recurring_integration_not_configured` until set | `paymobConfig.ts:52-66` |
| Summer engine | `summer.promo.enabled=true`, `summer.first_charge_release='HELD'`, `free_until=2026-08-16`, `first_charge_floor=2026-08-30`, `trial_days=14`, `pay_window_days=2` (all updated 2026-06-28) | live `platform_config`; semantics `src/lib/summer/config.ts:133-149` (`firstChargeAllowed` requires enabled && RELEASED) |
| Other live flags | `wa_sending_enabled=true`, `cron_paused=false`, `read_only_mode=false`, `maintenance_mode=false`, `pause_new_signups=false`, `payment_failed_enabled=false`, `digital_student_fee_collection.enabled=false`, policy/DPA version 1.0 | live `platform_config` |
| Failing crons | `payment-alert`: every run fails — PostgREST `Could not embed because more than one relationship was found for 'invoices' and 'centers'` (ambiguous FK after `20260702103413` added rules; needs explicit `!fk` hint). `dormancy-warnings`: §3 crash | `cron_log` last 7d |
| Scanner probe | `status_checks.scanner='degraded'` continuously (edge fn `process-onboarding` returns non-OK to unauthenticated probe — likely 401 by design; probe misclassifies) | `status-ping/route.ts:26-44` |

## 5. Build-truth sweep — pointers

- Proxy `src/proxy.ts:89-116` `AUTHENTICATED_ROUTE_PREFIXES`: `/invoices` **missing** (page exists at `src/app/[locale]/invoices/`); `/teacher` deliberately excluded (portal layout self-auths, `teacher/(portal)/layout.tsx:8-14`); `/join`, `/set-pin`, `/legal`, `/privacy` intentionally public.
- Center portal: pages under `src/app/[locale]/{dashboard,students,groups,payments,schedule}`, sidebar `Sidebar.tsx:116-158`, writes via `api/db/route.ts` (center_id forced by `dbProxyScope.ts`, CSRF + audit_log). Live.
- Teacher portal: `src/app/[locale]/teacher/(portal)/*` + `api/teacher/**`; server-side auth in `(portal)/layout.tsx`; proxy enforces center↔teacher wall (`proxy.ts:269-296`). Live.
- Scanner: `attendance/page.tsx` → `components/attendance/ScanTab.tsx`; offline `src/lib/db.ts` (idb v4) + `src/lib/sync.ts` → `/api/db` `attendance_scans` (rate-limited `api/db/route.ts:362-375`). Live.
- Fee collection: `api/payments/collect/route.ts` (permission + CSRF + center-scope check + audit). Live; no dedicated student receipt route.
- Referrals: center — `api/referral/*`, `api/referrals/*`, cron `referral-automation`, admin screens; consumed at `api/signup/route.ts:282-346`. Teacher — `src/lib/teacherReferral.ts`, `api/auth/teacher/signup/route.ts:275-296`, reward in `combinedPaymentFinalize`. Both live.
- Privacy requests: `legal/privacy-request/page.tsx` → `api/privacy-request` → `admin/privacy-requests` + anonymize route. Live, manual fulfillment.
- Guardian consent: db-proxy insert gate `api/db/route.ts:320-345` (`GUARDIAN_CONSENT_REQUIRED`), stamps `guardian_consent_confirmed_at/by`; consent request `api/parents/request-consent` (template blocked, §1). Live server-side.
- Parent self-enrollment: (a) `join/[center_code]/[group_id]` → `api/join/pending-enrollment` → pending approval flow — live; (b) `join/g/[groupId]` OTP flow — **broken at delivery** (`chq_enrollment_otp` never sent, §1).

## 6. What this session could not verify (do manually)

1. Actual Vercel env values: `NEXT_PUBLIC_APP_URL`, `CSRF_SECRET`, `NUDGE_WHATSAPP_ENABLED`, `WHATSAPP_TOKEN`/phone-ids, `PAYMOB_*`, `SENTRY_*`, Upstash pair. (Vercel MCP returned no teams; outbound HTTP to prod is policy-blocked from this container.)
2. Supabase Auth URL configuration (site URL + redirect allowlist).
3. The real Meta template list/status — `wa_meta_templates` is the app's own mirror (and its `variables_count` is stale); reconcile against the WhatsApp Manager console using the code-side counts in §1.
4. Paymob dashboard: key mode, transaction + processed callback URLs, recurring integration ID request status.
