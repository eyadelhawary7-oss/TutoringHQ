# CenterHQ Readiness Report — 3 July 2026

**For:** Eyad
**What this is:** A read-only check of what is actually built, based on the live code and the live database — not on old notes. Nothing was changed. A technical note with exact file and table references sits next to this file (`2026-07-03-technical-note.md`).

**How to read it:** each item is marked **Built** (works end to end), **Half-wired** (some pieces exist, but a link in the chain is missing), or **Missing** (planned only).

---

## The five things to know before anything else

1. **PIN messages do not send today.** The PIN setup link and the PIN reset code are both blocked by the template-approval gate: `chq_pin_setup_link` isn't registered in the app's template table at all, and `chq_pin_delivery` is marked "in review", not approved. The code silently skips the send in both cases. New owners relying on WhatsApp PIN delivery will not receive anything.
2. **Parent self-enrollment by OTP link never delivers the code.** The join flow creates the OTP and queues the WhatsApp message, but nothing ever processes that queue job — the sender for it was never written. Parents can't complete that flow. (The other enrollment path, the center/group link with center approval, works.)
3. **The data-deletion pipeline is dead in two independent ways.** The monthly job crashed on its last run because the database is missing a column it needs (`centers.dormancy_purged_at`), and even if it ran, no code ever marks a center "dormant" anymore — so the deletion warnings and the purge can never fire. The WhatsApp messages promising deletion exist; the machinery behind them does not run. Also important: there is **no five-year financial retention rule anywhere in the code** — and the purge, if it ever ran, would **delete payment rows** after 12 months (exported to Drive first). That contradicts Adsero's five-year rule and needs a decision before go-live.
4. **The billing nudges cannot reach WhatsApp yet.** All four nudge templates are marked "pending" (not approved), and the separate environment kill switch for nudge WhatsApp is off — the live ledger shows every nudge recorded with channel "disabled". The nudge engine itself runs fine daily.
5. **Welcome messages point to the wrong website.** The code passes a hardcoded `https://tutoringhq.app` (an old domain) as the link inside the `chq_welcome` and `chq_onboarding_step1` templates, and uses it as the fallback base for other owner links. Production is `centerhq.app`.

---

## Workstream 1 — WhatsApp templates: what the code sends vs what Meta has

The app keeps its own mirror of Meta approval status in a table (`wa_meta_templates`, 46 rows) and **refuses to send any template not marked APPROVED there**. So two lists matter: what the code sends, and what that table says. You should line the table up against the real Meta console — the table is only a mirror and may be stale.

**Approved in the mirror and actually wired (should work):** welcome, daily summary, CEO briefing, weekly summary, parent welcome / absence / balance-due / term summary / announcements, scan notification, payment confirmed / failed / retry, renewal reminder / overdue, pack invoice, vendor new order, reactivation warnings (30/90), data deletion notice, dormancy notice, inactivity alert.

**Blocked today because not approved in the mirror:**
- Pending: the four billing nudges (`chq_nudge_prebill`, `chq_nudge_due_today`, `chq_nudge_locked`, `chq_nudge_card_expiry`), `chq_fee_reminder`, and all seven card-order status templates.
- In review: `chq_pin_delivery`, onboarding steps 2–4, order shipped, team invite, upgrade nudge, referral commission, withdrawal processed.

**Blocked today because the code sends a name that has no row in the mirror at all** (the gate treats "no row" as "not approved", so these silently never send): `chq_pin_setup_link`, `chq_parent_consent`, `chq_balance_reminder`, `chq_reenrollment`, `chq_inactivity_day3`, `chq_internal_churn_alert`, `chq_checkin_day3`, `chq_payments_guide`, `chq_week1_summary`, `chq_referral_intro`. If these are live in Meta, register them in the table; if not, they need submission.

**Queued but never delivered (no sender exists):** `chq_enrollment_otp` (parent join OTP — and its two variables are passed in swapped order vs the documented template) and `chq_teacher_signup_otp` (teacher signup OTP).

**Variable-count and ordering mismatches to fix or verify against Meta** (full table in the technical note):
- `chq_weekly_summary` is sent from two places with **7 variables** (owner weekly report) and **2 variables** (parent attendance summary) — same template name, incompatible payloads.
- `chq_welcome`: 3 variables from one sender, 1 from another. Onboarding steps 1–3: 2–3 variables from one sender, 0 from another.
- `chq_inactivity_alert`: 4 variables from one sender, 2 from the churn cron.
- `chq_internal_churn_alert` passes 5 named variables that get re-sorted **alphabetically** before sending — almost certainly not the order the template was registered with.
- The focus templates: **PIN setup link = 1 variable (the URL). Enrollment OTP = 2 variables (currently sent as [code, group] where the documented body is [group, code]).** Billing nudges = 4, 3, 3, 4 variables respectively (prebill, due-today, locked, card-expiry).

Master switch `wa_sending_enabled` in platform config is **on**.

## Workstream 2 — Schedule feature: real state

It's actually three separate subsystems, not one feature. Live data is nearly empty (4 schedule rows, 1 slot, 3 sessions, 0 exceptions, 0 proposals) — consistent with "built recently, barely used".

- **Center weekly timetable** (rooms/slots on the `/schedule` page): **Built.** Reachable from the sidebar, owner/admin can create and delete slots.
- **Teacher-proposes-slot → center approves** flow: **Built.** Teacher proposes from the teacher portal; center confirms/declines under My Teachers → slots tab, which books the room slot.
- **Teacher private schedule** (weekly template, exceptions, sessions): **Built, but only in the teacher portal.** A center manager has no screen to edit a teacher's schedule, exceptions, or sessions.
- **Sessions:** created manually when a teacher starts a class. **There is no automatic session generation** (no cron, no library) — sessions do not materialize from the weekly template on their own.
- **The four class-change notifications:**
  - Class cancelled, class rescheduled, schedule changed: **Half-wired.** The mutation routes do call notification functions, but every one of those functions is an empty stub that just logs a line ("Phase 4 fills the bodies when the WhatsApp templates are Meta-approved"). Nothing reaches WhatsApp.
  - Class reminder: **Planned only.** The stub exists but nothing calls it, and there is no reminder cron.
  - None of the four template names exist in the template mirror table.

## Workstream 3 — Retention and deletion

- **Dormancy/deletion pipeline: Half-wired, and currently dead.** The monthly `dormancy-warnings` cron is registered and does fire (2nd of every month), and it contains the full intended sequence: warning at month 9, final warning at month 11, export to Google Drive + purge + deletion notice at month 12. But:
  - Its last run (2 July) **crashed**: the live database has no `centers.dormancy_purged_at` column. The code and the live schema have drifted.
  - Nothing ever sets a center to "dormant" anymore — the old day-30 dormancy machinery was removed (it survives only in an archived migration). The cron's query matches zero rows by construction.
  - So: the reactivation-warning and data-deletion WhatsApp messages exist and are approved, **but the jobs behind them can never fire in practice.**
- **Five-year rule for financial records: Missing.** No numeric retention window for financial records exists anywhere in code. Protection is structural only (invoices and audit log are excluded from the purge, and foreign keys block deleting a center that has money rows). Worse, the purge **does delete `payments` rows** at the 12-month mark (after a CSV export to Drive) — that is the direct conflict with a five-year financial-records rule.
- The admin panel exposes a "data retention months" setting (currently 12), but **the cron ignores it** — 12 months is hardcoded.
- **Privacy-request handling: Built, manual.** The public request form works and alerts admins with a 30-day due note; erasure is a super-admin action that strips a student's identity while keeping the financial rows. There is no automated SLA or scheduled anonymization job — and for a deletion request that's arguably correct, but know that fulfillment is entirely manual.

## Workstream 4 — Go-live wiring and config

- **Cron secret: Present and working.** Proven from live data: 40+ Vercel crons ran successfully in the last 24 hours (they all require the secret).
- **Read-only drift key: Empty.** The daily live schema check (`SCHEMA_DRIFT_DATABASE_URL` repo secret) last succeeded 26 June and has failed every day since 27 June with "not configured". This is the same class of problem that just bit the dormancy cron (live DB missing a column the code expects) — re-adding the key would have caught it.
- **App URL, web side:** the app is answering on its configured URL (the self-health ping succeeds ~99% over 24h). The env value itself isn't readable from this session — but the code-side fallbacks are inconsistent: most link builders fall back to `centerhq.app`, while the owner-notification module falls back to **`tutoringhq.app`** and even passes that literal into two templates regardless of env (item 5 up top).
- **App URL, Supabase side (auth redirect/site URL):** not readable with the access this session has. Verify manually in Supabase Dashboard → Authentication → URL Configuration; the code expects the callback at `{app origin}/auth/callback`.
- **Paymob:** keys live only in Vercel env, which this session cannot read — **live-vs-test cannot be confirmed from here.** What the live system shows: **zero Paymob webhooks have ever been received** (the inbox table is empty) and zero payments exist, so the callback URL has never been exercised; and the **recurring/auto-charge integration ID is documented in code as not yet issued by Paymob** — saved-card auto-charge cannot work until it's added. The production boot guard would crash the app if keys *looked* like sandbox keys, and the app boots — but empty keys also pass that guard, so this is not proof of live keys.
- **Summer engine:** master switch **ON**, first-charge gate **HELD** (no money can move), free-until 16 Aug 2026, first-charge floor 30 Aug 2026, 14-day trial, 2-day pay window. Set 28 June. Exactly the "on but held" launch posture.
- **Two crons are erroring and worth fixing:** `payment-alert` fails on every run (ambiguous database relationship between invoices and centers — it has never completed since the FK change), and `dormancy-warnings` as above. The status page's scanner probe also reports "degraded" continuously (the edge function answers with a non-OK status to the probe).

## Workstream 5 — Broad build truth, one line each

- **Center portal** (dashboard, students, groups, payments, schedule): **Live and wired.** All pages linked in the sidebar, full write paths, tenancy enforced.
- **Teacher portal:** **Live and wired.** Separate namespace with its own server-side auth, signup, groups/sessions/income/billing, and a large dedicated API surface.
- **Attendance scanner:** **Live and wired.** QR tab on the attendance page, offline IndexedDB queue, sync into the rate-limited DB proxy.
- **Fee collection:** **Live** for recording payments (permissioned, CSRF, audited). **Partial** on the edges: no dedicated student-payment receipt, and the fee-reminder template is still pending approval.
- **Referrals:** **Both live.** Center program (codes, rewards, payouts, admin screens, monthly cron) and the separate teacher program (code on profile, +1 free month to both sides on first cleared charge).
- **Privacy requests:** **Live** (public intake + admin queue + anonymize action); fulfillment is manual.
- **Guardian consent:** **Live and server-enforced** — student inserts are rejected without the consent flag, consent proof is stamped, and the parent-facing consent request exists — but its WhatsApp template (`chq_parent_consent`) is not in the approval mirror, so that message doesn't send today.
- **Parent self-enrollment:** **Half-wired.** The center/group link + center approval path works end to end. The OTP link path is broken at the last step: the OTP WhatsApp message queues and is never sent.
- One security footnote: the `/invoices` page prefix is **not** in the middleware's authenticated-prefixes list, so the login wall doesn't cover it. Worth registering regardless of any page-level checks.

---

## Suggested order of fixes (smallest first)

1. Register/submit the missing WhatsApp templates and reconcile the mirror table with the real Meta console — that alone unblocks PIN setup, PIN reset, parent consent, and (with the env switch) billing nudges.
2. Write the missing outbox handlers for the two OTP messages (and fix the enrollment OTP's swapped variables).
3. Replace `tutoringhq.app` with the correct base URL in the notification module.
4. Fix the two failing crons (`payment-alert` embed ambiguity; add the missing `dormancy_purged_at` column or park the dormancy cron deliberately).
5. Re-add the read-only drift key so live schema drift is caught daily.
6. Decide the retention question with Adsero in hand: exclude `payments` from any purge for five years, wire the "retention months" setting up, and rebuild the dormancy trigger — or explicitly retire the deletion messages until the pipeline is real.
7. Before go-live: confirm Paymob live keys + callback URL in the Paymob dashboard, request the recurring integration ID, and verify the Supabase auth URL configuration.
