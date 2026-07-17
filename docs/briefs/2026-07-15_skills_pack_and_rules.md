# RUN THESE TWO JOBS, IN ORDER, IN THIS SESSION

Two jobs. Job 1 is docs. Job 2 is read-only investigation. Neither changes any
money code, any schema, or any production data.

## Runner rules. Read these before anything else.

1. Do Job 1 completely. Open its PR. Then do Job 2. Then stop.
2. **If Job 1 cannot be completed as written, STOP. Do not start Job 2.** Report
   what blocked you and wait. A previous session hit a wall mid-brief, could not
   ask, pressed on with the part it could prove, and produced a PR that scored
   1 pass out of 11 on audit. Stopping is correct. Improvising is not.
3. Everything you need is in this file. Do not go looking for
   BUILD_BRIEF_skills_pack_and_rules.md, "File 13", or any other project
   knowledge file. They live in Eyad's Claude.ai project and are unreachable
   from this repo. Nothing is missing.
4. Never invent content to fill a gap. If something is underspecified, say so
   and stop. Do not present reconstructed or assumed content as Eyad's.
5. An inference is not a finding. If you have not read it from disk or from the
   live catalog, label it a guess.
6. Merge nothing. Both jobs end held for Eyad's review.
7. Do not apply any migration to production. Neither job should produce one.

---

This brief is complete and self-contained. Everything you need is below. Do not
look for BUILD_BRIEF_skills_pack_and_rules.md or "File 13", they live in Eyad's
Claude.ai project and are not reachable from the repo. Nothing is missing. Run it
exactly as written.

This replaces PR #160, which is being closed. That PR applied three inline
additions and nothing else, because the session ran without the brief and could
not fetch it. An audit scored it 1 pass out of 11. Do not branch from it, do not
try to salvage it, do not repeat its shape. Start from master.

---

# BUILD BRIEF: Install skills + always-on rules
Model: Opus 4.8. Docs-only job with merge judgment, no money code touched.
Branch: new held branch. Open a PR. Do NOT merge. Eyad reviews first.

## Context
The repo already has .claude/skills/ (automated-billing-and-fees, saas-multi-tenant-architecture, client-onboarding-automation, ehg-algorithmic-asset-management) and .claude/agents/ from a recent batch. This brief replaces two of those skills with canonical content written and approved in planning chat, adds one new skill, adds four always-on working rules to CLAUDE.md, and fixes known stale or wrong lines.

Rules for this job:
- Run `git fetch origin` FIRST, before any diff. PR #160's description contained a false claim that the branch sat 40 commits above master and swept in 160 files. It was a clean 3-file diff. The cause was a stale local origin/master ref. Never describe a diff you have not refreshed.
- Read each existing skill file BEFORE overwriting. If the old version contains correct facts not present in the new content below, append them under a "Additional verified notes" section at the bottom of the new file. If anything in the old version CONTRADICTS the content below, the content below wins, and you list every contradiction in the PR description. This list is the real product of this job. It will not be empty: the current billing skill carries "base = inclusive x 0.86" and CLAUDE.md points at centerhq.app, and both contradict the content below.
- Em dashes: none in anything you write, and strip any pre-existing ones from files you are already editing under this brief. Do not go hunting through files you are not otherwise touching. CLAUDE.md currently holds 33 and the billing skill holds 19.
- Run the full unit suite before pushing even though this is docs-only.
- Green CI proves nothing here. There is no test for whether a rule is correct, and this PR would pass every gate with the files blank. Verify by reading.

---

## Task 1: Overwrite .claude/skills/automated-billing-and-fees/SKILL.md

Full new content:

---
name: automated-billing-and-fees
description: Locked financial rules for TutoringHQ. Use whenever touching pricing, billing, invoices, fees, VAT, referrals, card orders, Paymob, renewal, reactivation, signup payment, or any code that computes, stores, or displays money.
---

# Money invariants (LOCKED)
Violating any rule here is a critical bug. These override any other doc except docs/PRICING_SPEC.md, which they must match.

1. Customer-visible charges are ONLY: product price + flat 20 EGP processing fee + 14% VAT. The former 6% service fee and 0.5% stamp duty were removed (PR #139) and must never reappear in code, UI, PDFs, emails, or docs.
2. VAT is inclusive. The only correct split: base = inclusive / 1.14, VAT = inclusive * 0.14 / 1.14 (src/lib/pricing/taxMath.ts). NEVER use base = inclusive * 0.86, that is the old non-compliant formula and any doc or comment still describing it is stale.
3. The flat 20 EGP processing fee applies to EVERY charge invoice: subscription, signup, PAYG, pack, teacher, upgrade, summer, reactivation, card setup_fee, announcement settlement. payment_proof mirror docs are fee-free. The fee is config-driven (platform_config) and snapshotted into invoices.metadata.processing_fee. Existing invoices always render from their snapshot, config changes never rewrite history.
4. Billing periods: monthly and annual only. Column vocabulary differs on purpose: centers.billing_period allows {monthly, annual}, centers.subscription_billing_period allows {monthly, yearly}. Always translate annual to yearly when writing the second column. Quarterly is DEAD: every reader defaults quarterly to monthly, every writer coerces it, no UI ever offers it.
5. QR cards: flat 60 EGP per card inclusive. CARD_UNIT_BASE_EGP = 60 / 1.14 kept unrounded so N cards gross to exactly N * 60. One shared 20 EGP fee per card-order invoice, split across cards for display.
6. Referral payouts: commission base uses divisor 1.14 only. Cash-out fee: 20 EGP flat deducted first, then 5% of the remainder. Minimum 1000 EGP on cash withdrawals. Net can never go negative. Server-authoritative in src/lib/referralPayout.ts.
7. Plan price anchors are hardcoded and byte-locked (Solo 999 up to Enterprise 18,499, annual = monthly * 10, Teacher 499/999/2,499). Never recompute, round, or "fix" them.
8. top_centers is custom-priced from centers.all_in_price. NULL or 0 must throw, warn Sentry, and enqueue a red CEO action. Never bill 0 EGP.
9. All billing windows use the Cairo time helpers (src/lib/cairo/). Never raw new Date() for anything user-visible or billing-related. Unit tests run TZ=UTC deliberately to expose violations.
10. Money rounds to 2 decimals. audit_log is append-only.
11. No refunds. Corrections become credit.
12. The summer engine is FROZEN. Never modify summer.* platform_config keys, the first-charge gate, or related cron logic without an explicit instruction from Eyad in the current brief.
13. The VAT base is the full VAT-inclusive total, for every invoice type and every line. There are no carve-outs. The flat 20 EGP processing fee IS subject to VAT. The card delivery fee (card_orders.delivery_fee) IS subject to VAT. Confirmed by Eyad 2026-07-15. Do not reintroduce a per-type or per-line exception.
14. Every invoice snapshots its own tax at insert time into invoices.vat_rate, invoices.vat_amount and invoices.processing_fee (live since PR #159, verified in the production catalog 2026-07-15). The per-invoice vat_rate is what makes an old invoice reprint at its original rate after a future VAT change. Never remove it, never recompute a stored invoice from current config. Legacy null rows recompute; new rows must always write the snapshot.
15. Late fees are DEAD. The five late_fee_* keys in platform_config and the late_fee_rate, late_fee_amount and days_overdue columns on invoices are legacy. They are unreachable under the billing lockout policy, which locks the account on day 1 while the first late fee triggers on day 4. Never reintroduce them.

# Verification duties
After ANY change in these areas: run the full unit suite. If the change involves database vocabulary or constraints, verify against the live catalog (information_schema, pg_constraint), never against schema_migrations, which is bookkeeping not proof.

Timezone, and this is not optional. All billing crons run on Vercel, which runs UTC only with no timezone setting. Egypt is UTC+3 during daylight saving and UTC+2 outside it. Under Law 34 of 2023, DST runs from the last Friday of April to the last Thursday of October, which for 2026 is 24 April to 29 October. Any Cairo local time in a billing rule needs the offset done by hand and must be DST aware. Two yearly edges: on spring forward day 12:00 AM does not exist, and on fall back day the 11 PM hour repeats. A job set to fire at exactly midnight can skip or fire twice. Twice means two invoices.

---

## Task 2: Overwrite .claude/skills/saas-multi-tenant-architecture/SKILL.md

Full new content:

---
name: saas-multi-tenant-architecture
description: Tenant isolation and minors' data protection rules for TutoringHQ. Use whenever touching auth, API routes, middleware, database queries, RLS, service-role code, exports, cron jobs, or anything that reads or writes center, student, or parent data.
---

# Tenant and data safety (LOCKED)
Cross-tenant leakage of minors' data is an existential risk for this business. Treat any doubt as a blocker, not a judgment call.

1. Every tenant-owned row carries center_id and RLS scopes by it. If you cannot point to the exact line where a query is scoped to the caller's center, that is a finding, not an assumption.
2. Service-role paths (supabase-admin, /api/db) bypass RLS entirely. They MUST derive center_id server-side from the authenticated user. Caller-supplied center_id in body, query, or headers is hostile input and is never trusted.
3. Model B is locked: teachers are center-less (users.center_id is NULL), linked via the teacher_center table. Do not "fix" this.
4. Any new authenticated route prefix must be added to AUTHENTICATED_ROUTE_PREFIXES in src/proxy.ts or it ships unprotected.
5. Routes under PUBLIC_WEBHOOK_PREFIXES get no middleware auth. Each must verify HMAC itself with a timing-safe comparison and re-verify amounts against expected totals. A webhook trusting its payload amount is a critical finding.
6. Mutations require CSRF (validateCSRFRequest). CSRF_SECRET unset means validation silently skips: acceptable in dev only, a production incident otherwise.
7. Admin aggregates default is_test = false. Test data (is_test, e2e_seed:v1, TEST-xxxxx numbers) must never leak into customer-facing views or finance metrics.
8. Suspension and blacklist gating lives in middleware plus resolveBillingAccess. Never create a route or payment path that reactivates or bypasses a suspended center outside the intended handlers.
9. No new callers of the legacy /api/db proxy. New domain logic lands as a narrow REST route with the right gate (requireOwnerAdminCenter, centerAuth, or admin-access).
10. Parent-facing links must be short-lived and revokable (PDPL phase 2 direction). Never mint long-lived tokens to student or parent data.
11. Known accepted state (July 2026 scan): 18 server-only tables run RLS-on with zero policies, deny-by-default on purpose. Several SECURITY DEFINER helper functions are RPC-callable; anonymous EXECUTE on them should be revoked before launch. Do not "fix" the zero-policy tables by adding permissive policies.

# Review method
For any diff touching these areas, read the actual code path end to end and state in the PR where center scoping happens for each new query. Run npm run security:audit when relevant.

---

## Task 3: Create NEW skill .claude/skills/tutoringhq-product-reference/SKILL.md

Full new content:

---
name: tutoringhq-product-reference
description: TutoringHQ design system, WhatsApp template rules, and launch sequencing. Use when building or changing any UI screen, creating or sending WhatsApp templates, or planning launch, rollout, or onboarding work.
---

# Design system (center portal is the reference implementation, PR #146)
- Light theme only. Cream background, teal primary (bg-teal-600, hover bg-teal-700), tokens from globals.css and tokens.ts. No dark: variants ever, dark mode was fully removed.
- 8 approved page patterns, classified in docs/CENTER_PORTAL_REPAINT_CLASSIFICATION.md:
  Dashboard (quick actions on top, tight 2x2 stat grid, at-risk students promoted with actions, charts hidden when empty, exports demoted to a menu).
  List (search plus ONE primary Add button leading; all secondary actions live under a "More actions" section below the list).
  Form (modals preferred for small actions; Add and Edit pairs stay visually consistent, including inline quick-create where the Edit side has one).
  Settings (category menu leading to focused sub-pages, never one long scroll).
  Detail, Billing, Scanner, Group Proposals (see the classification doc for specifics).
- Pages classified "own look" (schedule grid, analytics, benchmarks, wizards, auth and status pages, checkout steps) get colors only, never forced into a pattern.
- RTL discipline: logical properties only (ms, me, ps, pe, start, end, text-start, text-end). Physical properties only in PDF, print, email HTML, and Recharts margins, marked RTL-EXEMPT.
- Arabic-first: default locale ar. All numbers and dates through formatNumber.ts helpers. The i18n parity, bidi, and tolocale gates must stay green, they break the build on purpose.
- Any release that changes UI, assets, or branding must bump SW_VERSION in public/sw.js. The app is an offline-first PWA and its caching layer serves previously saved pages first; without the version bump, returning devices keep seeing the old UI. This exact miss caused the stale students page after the July 2026 repaint.
- Teacher portal and Admin portal are NOT yet repainted. When touched, apply these same patterns as their own dedicated passes with classification first.

# WhatsApp template rules (sync with the master checklist)
- Every customer-facing template: Utility category, Arabic (EGY), Arabic comma U+060C.
- Category fix needed (delete and resubmit as Utility): chq_welcome, chq_onboarding_step1, chq_onboarding_step2. chq_renewal_reminder is already Utility, do not refix.
- Must create: chq_nudge_prebill, chq_nudge_due_today, chq_nudge_locked, chq_nudge_card_expiry, chq_fee_reminder, chq_pin_setup_link (dynamic URL button plus 15-minute token), chq_enrollment_otp. The 4 schedule templates wait until the schedule feature ships.
- chq_pin_delivery dropped off Meta: resubmit it or remove the reset-pin code path that calls it. chq_referral_commission has a wrong language tag (says English, body is Arabic).
- Every new template needs 24 to 48 hours of Meta approval. In-app banners work without WhatsApp and are the fallback. Template sends will be gated by consent checks in the PDPL phase 2 build.

# Launch sequence (order is locked, never skip a step)
1. Adsero completes company registration.
2. Paymob live keys arrive. No real customer before this point, ever.
3. One real end-to-end test payment.
4. Flip the summer first-charge gate per the written plan.
5. WhatsApp templates approved and live.
6. First pilot center onboarded DEEP: real student data loaded, running daily operations. Then widen.
- External penetration test happens before any real tenant with student data.
- First-cohort success metric: centers running full real daily operations, not signup counts. Tight-deep onboarding beats wide-shallow outreach for a solo founder.

---

## Task 4: CLAUDE.md changes

4a. Add this section near the top, right after the "What this is" section:

## Working rules (always apply, every session)
1. Model selection: Sonnet for mechanical and inventory jobs. Opus 4.8 for medium-judgment work. Fable 5 for large batched builds and anything touching money or auth. State the chosen model at the start of substantive work.
2. Verify, do not trust: before acting on any claim about database or code state, check the live catalog (information_schema, pg_constraint, pg_proc) or read the actual file. schema_migrations is bookkeeping, not proof. Summaries, including AI-written summaries and PR descriptions, are not evidence. Before adding ANY column to a query, confirm it physically exists in the live schema (information_schema.columns); other code referencing a column is not proof it exists, and CI has no live database so a missing column passes every gate. This exact gap caused the July 8 student-detail outage.
3. Nothing merges without review: all work lands on a held branch with a PR. Eyad approves after all checks are green. Never merge to master directly, never delete a branch before review. This applies to everything including doc-only changes and side explorations.
4. Migrations are manual apply to production. Supabase Branching auto-applies to preview branches only, never to production on merge. This was tested on 2026-07-15: PR #159 merged as 80f82ba and the migration was still absent from the production catalog and from the production migration history 8 minutes later. Apply the migration by hand, confirm the columns exist in information_schema, then let the code deploy. Never merge and assume. An inference is not a finding: the earlier claim that Branching auto-applies on merge was a guess presented as an answer, and it caused a deploy that read columns which did not exist.

4b. Fix the stale VAT line (around line 82): replace "base = inclusive × 0.86" with "base = inclusive / 1.14, see src/lib/pricing/taxMath.ts". Keep the rest of that bullet intact.

4c. Fix the production URL: "Production: https://centerhq.app" becomes "Production: https://tutoringhq.app (centerhq.app is retired; the internal repo name, Vercel project name, and @centerhq.local auth emails stay as-is)".

## Task 5: Agent file fixes
5a. .claude/agents/cfo-controller.md: replace "base = inclusive × 0.86" with "base = inclusive / 1.14".
5b. .claude/agents/ceo-chief-of-staff.md: replace "live at centerhq.app" with "live at tutoringhq.app".
5c. Then grep EVERY file in .claude/agents/ and .claude/skills/ for "0.86" and for "centerhq.app". The two fixes above are the known ones, not necessarily the only ones. Fix every hit in those two directories and list them in the PR. The wrong VAT formula and the retired domain must not survive anywhere in the agent or skill files.

## Task 6: Mark the treasury skill as draft
Prepend this line at the very top of .claude/skills/ehg-algorithmic-asset-management/SKILL.md, above the frontmatter if the format allows, otherwise as the first body line:
STATUS: DRAFT. Not an active business function. Do not apply or extend without an explicit instruction from Eyad. International structure and treasury decisions are parked pending Adsero and tax-advisor review.

## Task 7: Save this brief into the repo
Briefs referenced as "project knowledge" are not reachable from this environment. This has now cost two sessions (BUILD_BRIEF_summer_pricing_invoice.md hit the same wall, documented in docs/SUMMER_2026_FINDINGS.md). Save this brief verbatim to docs/briefs/2026-07-15_skills_pack_and_rules.md so the next session can read it instead of asking for a paste.

## Task 8: Verify and hold
- Read client-onboarding-automation/SKILL.md. Do not change it, but list in the PR description anything in it that contradicts the money or tenant rules above.
- Run typecheck, lint, and the full unit suite.
- Push the branch, open a PR titled "Skills pack + always-on working rules", list all contradictions found, and STOP. Do not merge.

---
---

# JOB 2 - The read-only sweep

Start this only if Job 1 is complete and its PR is open.

Read-only investigation. No code changes, no schema changes, no migration, no PR
that touches anything but a findings document. Opus 4.8.

Answer all of the following by reading the actual code and the live catalog. Where
you cannot prove something, say so plainly and label it a guess. An inference is not
a finding. Produce ONE findings document with a section per item and a clear
recommendation for each, so Eyad can make every decision in one sitting.

Verified live state as of 2026-07-15, for you to check against rather than trust:
the invoices table now carries vat_rate, vat_amount and processing_fee with the
constraint invoices_tax_snapshot_nonneg. One invoice exists, INV-007-2026-07, at
base 1000, total 1020, vat_amount 125.26. Zero card orders exist.
summer.first_charge_release is HELD. summer.pay_window_days is 2.
subscription_dunning_max_attempts is 3. The five late_fee_* keys are still live.
Confirm any of this yourself before relying on it.

1. **students.balance_due (B2).** The column exists in no migration and not in the
   live database, yet roughly 10 routes reference it, including payments/confirm
   which writes to it. List every route that touches it. For each, say what actually
   happens today: silent failure, thrown error, or dead path. Then give both options
   with a recommendation: add the column properly, backfill, wire cash collections,
   restore the detail page Balance card; or remove the persisted-balance references
   and standardise on the live recompute the students list already uses.

2. **Commission engine.** Two bugs were reported: clawback logic fires on
   cancellations instead of chargebacks, and teacher reassignment is unwired. The
   schema now carries clawed_back and reassigned statuses on t1, t2 and loyalty
   bonus, so the migrations landed. Confirm whether the code bugs are still real or
   were fixed by the 20260713 commission_rewrite and 20260714 commission_clawback_status
   work. Also check whether the commission base is promo aware.

3. **C1. Teacher annual purchase path.** Can a teacher actually select and be charged
   annual, end to end? Schema exists, wiring unconfirmed.

4. **C2. Scale teacher overage activation post-summer.** Built gated off. Confirm what
   exists and what is missing.

5. **C3. Saved card auto-charge.** This is the real gate on 30 August. Nine blockers
   were reported. Confirm the current state precisely: what exists, what is missing,
   what is needed from Paymob, and whether the test recurring/MOTO integration ID has
   been requested. This is the single most important item in this list. The lockout
   policy Eyad has specified is only safe if the card charges itself at midnight. If
   it does not, every customer has to notice a midnight message and pay manually
   before 11:59 PM or lose access. Answer this one properly even if you have to cut
   depth elsewhere.

6. **Draft the Job 4 brief. Do NOT run it.** You will have just read all of this
   code, so you are the cheapest place to write it. Cover only what items 1 to 4
   found: the B2 balance_due fix in whichever direction you recommend, the
   commission fixes if the bugs are still real, and C1/C2 wiring if broken.

   Rules for the draft:
   - **Mark every place you assumed a decision Eyad has not made.** Do not silently
     pick. Put the open decisions in a list at the top of the brief so he can answer
     them in one pass.
   - **Write it for a session with none of your context.** Self-contained. No
     references to project knowledge, "File 13", or your findings doc. Inline
     anything it needs. A brief that points at a file the next session cannot open
     is how PR #160 happened.
   - Include the money merge procedure: PR held, Eyad checks the live database,
     migration applied by hand, columns confirmed, then merge. Never merge and assume.
   - **Leave C3 out of it entirely.** Saved card auto-charge is not a batch item. If
     item 5 shows it is large, say so as its own recommendation with a rough size.
     It may change what August looks like, and that is Eyad's call, not a task to
     fold into a cleanup PR.
   - Largest available model, since it touches money.

   Save it to docs/briefs/DRAFT_job4_money_batch.md.

Save the findings to docs/findings/2026-07-15_sweep.md. Open ONE PR containing
that file and the draft brief, and nothing else. Change nothing else. Hold for review.

---

# STOP HERE

Do not start any further work. Jobs 3, 4 and 5 need Eyad's decisions on Job 2's
findings, and Job 3 touches money and has a merge procedure that requires him in
the loop. Report both PRs and stop.
