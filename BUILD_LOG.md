# BUILD_LOG — Portal Rebuild (branch `claude/tutoring-portal-rebuild-2qfql1`)

Chronological log of every phase shipped and every routine default chosen. Money-track
items are cross-referenced in `MERGE_CHECKLIST.md` under REQUIRES SIGN-OFF.

**Model split (per build prompt):** product feature phases (2–6, W3/W4) authored by
Opus 4.8 subagents; the money track authored by Fable 5; foundational CI/infra/ledger
fixes, orchestration, and verification driven by the Fable 5 orchestrator.

---

## Pre-work (gate: CI must be green before any phase)

### CI trustworthiness
- **`server-only` under vitest** — added `resolve.alias` in `vitest.config.ts` mapping
  `server-only` → `tests/stubs/empty.ts` so server libs (`supabase-admin`, `centerNotify`)
  can be imported by unit tests. Root cause of the `signup-consent` suite failing to load
  after slice 1 imported `centerOwnerProvision`.
  - _Default chosen:_ global alias (fixes all suites) over per-test mocks.
- **`tests/unit/api/signup-consent.test.ts`** — rewritten for the trial-first route:
  mocks `@/lib/centerOwnerProvision` (no-op) and `@/lib/summer/config` (defaults),
  routes `trial_claims` vs `centers` inserts to separate builders, asserts 200 +
  `pinSetup` + billing-neutral trial center; added a one-per-phone (23505) case.
- **`tests/e2e/signup-happy.spec.ts`** — updated selectors to the new flow
  (consent-terms/consent-privacy, "Start free trial", redirect to `/set-pin`).
  _Not runnable in this environment (needs `tests/e2e/.env.local` + live);_ updated for
  correctness, flagged for a human e2e run in MERGE_CHECKLIST.

### Migration ledger reconciliation
- Renamed repo migration files to match the live ledger versions (git-only, **no DB
  write**), so a future `supabase db push` treats them as applied and does not re-run:
  - `20260710120000_phase1_staff_user_link_and_manager_role.sql` → `20260710194333_…`
  - `20260710130000_trial_claims.sql` → `20260711095712_trial_claims.sql`

### Stale teacher trial row
- Read-only check: the row is a **REAL account** (`teacher_profiles.is_test = false`,
  "Aly Shady"), NOT test data as the audit assumed. **Left untouched** (money-safety:
  never reset a real customer's subscription automatically). Flagged REQUIRES SIGN-OFF
  in MERGE_CHECKLIST as a business decision. No live-DB write performed.

### Dead pay-first machinery — DONE
- Removed the 3 callers (Paymob webhook, `invoicePaymobPayment` signup_first_payment
  branch + its import, `check-stuck-payments`) and the 3 `vi.mock` test stubs, then
  deleted `src/lib/signupPaymobAutoApprove.ts`. Verified no remaining code references
  (only stale comments in 4 files, harmless). Green: typecheck + 1181 unit tests.

### CI gate — GREEN
- `typecheck` clean; `test:unit` 145 files / 1181 tests pass (was 1 failing suite).

### Centers-route auth refactor — DONE
- `/api/admin/centers` GET refactored off its bespoke inline cookie/bearer +
  admin_users lookup onto the shared `getAdminContext(request)` resolver, exposing a
  `ctx: AdminContext` that Phase 4 will pass to `getInternalScope()` for center
  scoping. Access semantics preserved (super_admin OR canApproveSignups OR `centers`
  perm; `!ctx` → 403 to match the client's `/dashboard` redirect). Removed the now-dead
  `createServerClient`/`cookies`/`customPermissionsToKeys` imports.
  - _Scoped to GET (the list — the scoped read path). POST/DELETE mutations retain
    their own auth (not scoped reads); noted for a later cleanup._
  - _Model note: authored by the Fable orchestrator as foundational/pre-Phase-4
    refactor; product feature phases (2–6) will use Opus 4.8 subagents._

### Live-DB correction (authorized by Eyad — the single permitted write)
- Eyad confirmed the stale `trialing` teacher (`68718be7…`) is his own test account
  despite `is_test=false`. Applied: `teacher_profiles.is_test=true`; deleted the stale
  `teacher_subscriptions` row + its 1 unpaid invoice. Verified 0/0. (See MERGE_CHECKLIST.)

## PRE-WORK GATE COMPLETE ✅ (typecheck + 1181 unit tests + verify:stabilization green)

### Revised build order (per Eyad)
Phase 2 CEO home → Phase 3 combined screens → Phase 4 manager scope + two-level
assignment + promo request → Phase 5 rep scope → W3 saved-card sandbox → W4 export gate
→ **Money track (REQUIRES SIGN-OFF, Fable 5)** → **Phase 6 HR/commission views (Fable 5,
built on the finalized commission engine)**.

---

## Phase 2 — CEO home (Opus 4.8) — DONE ✅
- **Trials watch:** new `src/app/api/ceo/trials-watch/route.ts` (super_admin-only via
  requireSuperAdminApi) counting centers in trial (`summer_status='enrolled'`),
  teachers in trial (`teacher_subscriptions.status='trialing'`), converted
  (`summer_status='paid'`), and trials ending within 7 Cairo days
  (`summer_first_invoice_at`). Excludes test rows (`centers.is_test` — verified
  NOT NULL default false, so `.eq(is_test,false)` is complete; teacher test excluded
  via `teacher_profiles.is_test`). Widget rendered on `/ceo` in the existing 30s poll.
  Read-only-verified against live DB: 0/0/0/0 (greenfield). `CeoTrialsWatch` type added.
- **Removed the fakes:** deleted the hard-coded "Security alerts" tiles
  (`failedLogins24h`, `flaggedActivity`, always-0 `newRegistrations7d`, static
  systemStatus) and the dead Pending Signups KPI + its retired-page links from
  `admin/page.tsx` (grid tightened 5→4). Real revenue/health KPIs kept.
- **Dedup:** `/ceo-dashboard` now server-redirects to `/{locale}/ceo` (canonical CEO
  home). All platform controls preserved on `/ceo` (kill-switches, announcement editor,
  Section H emergency panel).
- i18n `ceo.trialsWatch.*` added (ar+en); SW_VERSION v9→v10.
- Verified by orchestrator: typecheck exit 0, 1181 unit tests, i18n/bidi/tolocale OK.
- _Human click-through needed (see MERGE_CHECKLIST): widget render on /ceo, /admin
  overview layout after removals, /ceo-dashboard redirect, RTL of new strings._

## Phase 3 — combined center+teacher screens (Opus 4.8) — DONE ✅
- **`src/lib/ownerNormalizer.ts`** (new, pure, 17 unit tests): `UnifiedAccount` +
  `normalizeCenter`/`normalizeTeacher`, `centerUnifiedStatus`/`teacherUnifiedStatus`
  (trial/active/overdue/suspended/churned/inactive), Cairo-day date normalization,
  and the canonical **`invoiceAmount()` = payment_amount ?? total_amount ?? 0** (0
  stays 0). Reuses existing MRR helpers (getImpliedMonthlyMrr / teacherMonthlyGross) —
  pricing ladders kept distinct. `parseOwnerFilter`/`ownerMatchesFilter`.
- **Centers/Teachers/All filter** (`?owner_type=center|teacher|all`, default `center`
  = regression-safe) wired into `/api/admin/{billing,renewals,finance}` GET + their
  pages (URL-synced control). Teacher subs folded into renewals/finance; teacher
  invoices resolved with names + canonical amount. Finance `center` path calls the
  original `getFinanceData` verbatim (byte-identical); canonical amount applied only to
  teacher rows so center numbers don't move.
- **No money-engine changes** — POST/PUT mutation handlers + auth gates untouched.
- Read-only DB check confirmed the bug class: an engine invoice with
  `payment_amount=NULL, total_amount=1020` reads 0 today vs 1020 canonical.
- i18n +5 admin keys (ar+en); SW_VERSION v10→v11.
- Verified by orchestrator: typecheck exit 0, 1198 unit tests, i18n/bidi/tolocale OK.

## Phase 4a — access scoping + salary privacy (Opus 4.8) — DONE ✅
- **base_salary is CEO-only** — stripped from GET responses for non-super_admin in
  `payouts/route.ts`, `payouts/[id]/route.ts`, `staff/route.ts`, `staff/[id]/route.ts`
  (conditional select on the joined embed + post-fetch delete of the row column).
- **getInternalScope wired (fail-closed)** into 4 GET routes; empty scope → sentinel
  uuid matching nothing:
  - `centers` GET — scope by `allowedCenterIds` (`.in('id', …)`), main + pending queries.
  - `card-orders` GET — gate relaxed to super_admin OR sales_manager/sales_rep; scope by
    `center_id`. PUT/PATCH **tightened to CEO-only** (was any-admin — a security fix).
  - `commissions` GET — gate relaxed to super_admin OR sales roles; scope by `staff_id`
    (an explicit `?staff_id=` param ANDs with the scope, so it can't widen). Unlock stays CEO.
  - `payouts` GET — scope by `staff_id`. Generate/mark-paid/adjust stay CEO-only.
- **Frontend gates relaxed in lockstep** (commissions/payouts/orders/staff pages) so
  sales roles render their scoped view; CEO-only write buttons hidden for non-CEO.
- New `tests/unit/api/phase4aScopeSalary.test.ts` (17 cases) proving per-role scope
  filters, the empty-scope sentinel, and base_salary stripping.
- Verified by orchestrator: typecheck exit 0, 1215 unit tests, stabilization OK; manual
  review of commissions + card-orders GET confirms fail-closed. SW_VERSION v11→v12.
- **Known follow-ups (flagged, see MERGE_CHECKLIST):** (1) a manager can still infer a
  rep's base_salary by subtracting commission tiles from the payout `total_amount` —
  the scoped manager payout VIEW should show status/commission only (refine in Phase 5);
  (2) Centers-page suspend/delete/blacklist buttons stay visible to sales roles though
  the API fails closed — hide-or-keep is a UI decision.

## Phase 4b — two-level CEO→Manager→Rep assignment (Opus 4.8) — DONE ✅
- **Migration (repo only)** `20260712120000_two_level_assignment.sql`: adds
  `center_assignments.manager_staff_id` (FK staff) + relaxes `sourced_by_eyad_no_staff`
  (a non-eyad row may carry manager_staff_id with staff_id NULL); new **`teacher_assignments`**
  table (service-role-only RLS, mirrors center concept). **NEW DATA — flagged.**
- **Scope extended (fail-closed)**: `allowedCenterIds` — a manager (`team`) unions
  `staff_id ∈ staffIds` + `manager_staff_id ∈ staffIds`; a rep (`own`) matches `staff_id`
  only (never manager_staff_id — proven by test). New `allowedTeacherIds` (same shape over
  `teacher_assignments`). 27 scope/assignment tests pass.
- **Two-level API**: CEO batch-assign centers/teachers to a manager (POST, super_admin,
  validates target is a staff `sm`, writes manager_staff_id + `pending_sm_approval`);
  manager sub-assign to rep (PATCH, gated: caller's `staff.id === row.manager_staff_id`
  AND rep's `reports_to === caller` — else 403; sets staff_id + `approved`); CEO override.
  New `/api/admin/teacher-assignments` + `[id]`. **Commission calc untouched** (money track).
- **UI**: center-assignments page gets Centers/Teachers tabs, CEO batch/override, manager
  sub-assign view; sidebar link now visible to `sales_manager`.
- Verified by orchestrator: typecheck exit 0, 1232 unit tests, stabilization OK; manual
  review of the manager sub-assign gate + migration confirms fail-closed. SW_VERSION v12→v13.

## Phase 4c — manager promo-code request flow (Opus 4.8) — DONE ✅ (Phase 4 complete)
- **Migration (repo only)** `20260712130000_promo_code_requests.sql`: new
  `promo_code_requests` table (service-role-only RLS). **NEW DATA — flagged.**
- Manager requests a code (discount/max-uses/expiry/target) → **pending**; CEO approves
  (creates the live `promo_codes` row, idempotent-safe) or rejects **with a reason**.
- Gates: POST `sales_manager` (or super_admin) + CSRF; GET managers see only their own
  (`.eq requested_by`), full-admin sees all; PATCH approve/reject **super_admin-only** + CSRF.
- **Caps** (no 100%-off unlimited): `DEFAULT_MAX_DISCOUNT_PCT=30`, `DEFAULT_MAX_USES=500`
  in `src/lib/promoCodeRequests.ts`, overridable via `platform_config`
  `promo_request.max_discount_pct` / `promo_request.max_uses`; an unbounded max-uses
  request is rejected 400. Reps get nothing (403; nav hidden).
- 16 new tests; verified by orchestrator: typecheck exit 0, 1248 unit tests, stabilization
  OK; approve/reject gate reviewed (CEO-only). SW_VERSION v13→v14.

## Phase 5 — rep card-order lockout + manager payout salary-privacy (Opus 4.8) — DONE ✅
- **Card-orders is Manager+ only.** `card-orders/route.ts` GET gate is now `isCEO ||
  isManager`; a `sales_rep` gets **403** (was allowed in 4a). Reps never see the fulfilment
  queue. `AdminOrdersClient.tsx` bounces a stray sales_rep client-side too.
- **Closes the 4a salary-inference leak.** The scoped (non-CEO) payout view no longer
  returns figures a manager could subtract to back out a rep's `base_salary`:
  - `payouts/route.ts` + `[id]/route.ts` — non-CEO branch builds a **NEW whitelisted
    object** with only `staff{id,name,role}` (no base_salary), `period`, `status`,
    the commission tiles (`t1/t2/loyalty/override`), `commission_count`, `paid_at`, and a
    derived `commission_total`. It **omits** `total_amount`, `base_salary`, `adjustment`,
    and `breakdown`. The CEO branch is unchanged (full `total_amount` + `base_salary`).
  - Verified by grep: `isCEO = ctx.internalRole === 'super_admin'`; staff embed select is
    `base_salary`-free for non-CEO; the whitelist object literal carries no salary/total.
- Frontend `payouts/page.tsx` + `commissions/page.tsx` render the commission-only view for
  managers (total-pay column hidden when the field is absent).
- i18n +5 admin keys (ar+en); SW_VERSION v14→v15.
- Verified by orchestrator: typecheck exit 0, **1250 unit tests pass**, i18n/bidi/tolocale
  OK. Manual review confirms the non-CEO payout object cannot leak base_salary.
- Resolves both Phase-4a follow-ups: (1) manager payout salary inference — CLOSED (view is
  commission-only); (2) card-order rep access — CLOSED (reps 403).

## W3 — saved-card auto-charge testable in Paymob sandbox (Opus 4.8) — DONE ✅
Fixed the three concrete gaps that made the (already-built) saved-card engine unreachable.
Orchestrator pre-verified all three against the code + live DB before dispatch.
- **Gap 1 — nothing ever set `requestToken: true`.** New `optInToCardTokenization(store, …)`
  in `savedCard/consent.ts`: returns false (records nothing) unless the customer ticked
  "save my card"; when ticked, records consent via the canonical `recordConsent` path and
  gates on `consentIsSufficient(getLatestConsent())`. Wired into BOTH first-invoice pay
  routes (`invoices/[id]/pay`, `teacher/invoices/[id]/pay`) — they set
  `request_token=true` + `token_agreement='recurring'` (same fields as `paymob.ts`
  `createPaymentKey`) ONLY when the gate returns true. Cached-iframe reuse guarded with
  `!saveCard` so an opt-in always mints a fresh tokenizing key. **Card-less stays the
  default** (product decision A) — a missing/false `saveCard` behaves exactly as before.
- **Gap 2 — token callback resolved centers only.** `resolveOwnerForOrder` now selects
  `owner_type, center_id, teacher_id` and returns a teacher owner ref for
  `owner_type='teacher'` invoices (teachers now share the `invoices` machinery), so a
  teacher's first-payment token is saved to her own owner. Center + combined-session paths
  preserved.
- **Gap 3 — autocharge `due_date` filter was exact `.eq`.** Widened the center
  "initial subscription due" query to `.lte('due_date', todayCairo)` so a summer-billing
  straggler (issued 23:00 UTC, after autocharge's old 22:00 UTC slot) is collected the
  next night. Idempotent: status stays `pending/overdue` (a `failed` invoice is the
  separate retry query), `applyCharged` guards `.neq('status','paid')`, finalize no-ops if
  paid. Also **reordered crons** in `vercel.json`: `subscription-autocharge` 22:00 →
  **23:30 UTC** so it runs AFTER `summer-billing` (23:00) — belt-and-suspenders with the
  `.lte`.
- **UI**: one opt-in checkbox on the shared `CustomerInvoicesView` (default OFF), reusing
  existing `savedCard.consent.title/body` i18n keys — **no new i18n keys**. SW_VERSION v15→v16.
- **INERT preserved**: requesting a token is benign; `saveCardFromFirstPayment` /
  `chargeSavedCard` still return `recurring_integration_not_configured` until
  `PAYMOB_RECURRING_INTEGRATION_ID` is set — no real customer saved/charged in prod.
- **No charge AMOUNT touched** — only whether/when a due invoice is collected and whether a
  card is saved. NOT a REQUIRES SIGN-OFF item.
- New tests: `savedCardOptIn.test.ts` (4), `tokenCallbackOwnerResolution.test.ts` (4),
  `autochargeDueWidening.test.ts` (2) + `lte` added to a stub in `teacherInvoiceParity.test.ts`.
- Verified by orchestrator (independent run): typecheck exit 0, **1260 unit tests pass**,
  i18n parity OK (3854 keys), bidi/tolocale OK. Reviewed line-by-line: consent gate,
  teacher owner resolution, `.lte` idempotency, Paymob field parity with `paymob.ts`.

## W4 — export = paid-only during trial (never gate legal/financial) (Opus 4.8) — DONE ✅
Recon-first: an Explore pass mapped every customer export + never-gate surface before the build.
- **Shared entitlement helper** `src/lib/exportEntitlement.ts` (pure + fail-OPEN to access):
  `centerHasExportAccess({summer_status,hasEverPaid})` = access unless `summer_status ∈
  {enrolled,invoiced}` and never paid; `teacherHasExportAccess({subscriptionStatus,hasEverPaid})`
  = access unless `trialing` and never paid. `ownerHasEverPaidInvoice` probes one paid `invoices`
  row and **fails open (grants) on a DB error** — a blip never gates a payer. The `hasEverPaid`
  OR-clause is the safety margin so an existing payer swept into the Aug-16 free runway
  (momentarily `enrolled`) is NEVER gated. Chosen safe default (logged): fail toward access.
- **4 gated exports**: dashboard Excel (`dashboard/page.tsx`), payments CSV (`payments/page.tsx`),
  analytics P&L CSV (`components/analytics/PnLCard.tsx`) — all three **client-side soft-gate**
  (button → disabled + "upgrade to export" upsell; data already in the browser); teacher income
  CSV (`api/teacher/private/income/export`) — **hard server 402** `{error:'export_requires_paid',
  upsell:true}` (a NEW `active||hasEverPaid` check, since `requireTeacherPrivateAccess` passes BOTH
  trialing and active). Client `IncomeView` also hides the button + maps 402 back to gated.
- **Never-gated (verified: not in the diff, helper not imported)**: PDPL `privacy-request` route +
  form; invoice/receipt/payout PDFs (center invoice, teacher invoice, order receipt, referral payout).
- **Entitlement surfaced**: `/api/me` adds `center.summer_status` + `center.export_access` (computes
  `hasEverPaid` only when in a trial state); teacher `subscription/status` adds `export_access`;
  `UserContext` center shape extended. Typed end-to-end.
- **Signup summer-off fallback** (`api/signup/route.ts`): forks on live `summerModeActive` (reads
  `platform_config` via service-role). Summer ON → unchanged 14-day trial enrollment. Summer OFF →
  normal billing (`next_payment_due ≈ +1mo`, single-day lock, `summer_status` NULL) mirroring the
  admin-approve activation. **No charge AMOUNT changes.** Consistent with the summer cron, which
  already no-ops when `!enabled` (`summerBillingCron.ts:87`), so an OFF signup is never swept.
  **Live check:** `summer.promo.enabled=true` (release HELD) → the fallback is DORMANT in prod;
  current signups still get the trial (zero behavior change), the guard only fires if the switch flips.
- i18n +4 keys (ar+en parity): `common.exportRequiresPaid(+Note)`,
  `teacherPortal.income.exportRequiresPaid(+Note)`. SW_VERSION v16→v17.
- Verified by orchestrator (independent): typecheck exit 0, **1274 unit tests**, i18n parity OK
  (3858 keys), bidi/tolocale OK. Reviewed line-by-line: helper (fail-open), teacher 402 gate,
  `/api/me` surface, signup fork (live-config + cron consistency + live master switch value).

## Money track — commission/loyalty rewrite (Fable 5) — DONE ✅ ⚠️ REQUIRES SIGN-OFF
Replaces the fixed-EGP `COMMISSION_TABLE` with the 20%/1% model. **Amounts change → this
lands as a REQUIRES SIGN-OFF commit and is NOT merged until Eyad approves.** Live-DB preflight
(read-only) confirmed GREENFIELD: 0 commissions / 0 payouts / 0 staff / 0 assignments / 0 real
centers — no data migration or reconciliation, pure forward behavior.
- **Pure core** `src/lib/commission/rates.ts`: rep = 20% of monthly price split into two EQUAL
  halves (t1+t2===total, no drift); T2 recomputed at CURRENT price; override = 20% of rep halves;
  loyalty = 1% of revenue; override-on-loyalty = 20%. Fully unit-tested (exact amounts + edges).
- **Owner financials** `ownerFinancials.ts`: `resolveOwnerMonthlyPrice` (center = getImpliedMonthlyMrr,
  teacher = price_gross) and `firstTwelveMonthsRevenue` (Σ COALESCE(payment_amount,total_amount)
  over paid invoices in [firstPaymentDate,+12mo)).
- **Engine** `commissions.ts`: owner-polymorphic `createCommissionsForOwner` (center+teacher),
  explicit INSERT + 23505-catch dedup (kills the partial-index double-insert), eyad zero-row,
  referred-by short-circuit, manager override; `reassignCommissions` (voids ONLY unearned tiers →
  'reassigned', never a paid one; transfers center_first_payment_date; recreates for the new rep +
  override; never double-pays); center back-compat wrappers preserved.
- **Conversion trigger** moved into the unified `finalizeInvoicePaymentSuccess` (`runOwnerConversion`,
  center+teacher, idempotent, wrapped so a commission failure NEVER blocks the payment) — so
  saved-card autocharge + summer first-payment + webhook all convert. Webhook's center call left
  (idempotent, also covers combined sessions).
- **Crons** `commission-t2-check` (recompute T2 at current price at 180 days) and `loyalty-bonus-check`
  (compute loyalty = 1% of realized 12mo revenue at 365 days), both extended to teachers via the
  shared `tierUnlock.ts` loader (centers embed billing state; teachers loaded in a second pass).
- **Payout** `admin/payouts/{route,[id]}`: the manager's LOYALTY override is now AGGREGATED into the
  payout total AND marked paid on confirm (was neither → the override loyalty would never pay).
- **Migration (repo-only, NEW DATA)** `20260712140000_commission_rewrite.sql`: add 'solo' + teacher
  plan keys to `plan_at_signing` CHECK; owner polymorphism (owner_type + teacher_id FK
  teacher_profiles.user_id, center_id nullable, exactly-one-owner CHECK); teacher partial unique
  indexes + tightened center ones; 'reassigned' added to t1/t2/loyalty status CHECKs.
- 25 new unit tests (rates/ownerFinancials/tierUnlock/engine). Verified by orchestrator: typecheck
  exit 0, 1299 unit tests, stabilization OK. **Adversarial review workflow run separately.**
- **Interpretation choices flagged for sign-off** (see MERGE_CHECKLIST): 20% base = implied MONTHLY
  price (not the quarterly/annual charge); delta_upgrade left unpaid; reassign-back-to-a-voided-rep
  edge left as a known limitation.

## Money track — annual-trial billed-amount/period alignment (Fable 5) — DONE ✅ ⚠️ REQUIRES SIGN-OFF
Separate money commit. The summer trial's first invoice (`summerBillingCron.runCenters`
issue_invoice) hardcoded `billing_period_end = firstInvoiceAt + 30 days` and `centerBase`
(quarterly fallback) regardless of the center's cadence — so an annual/quarterly trial center
was charged a full cycle amount over a 30-day window (next-billing + amount both misaligned).
Now uses the SAME period-aware helpers as the normal renewal cron: `centerRenewalBaseAmount`
(annual = all_in × annualMultiplier=10; monthly = stored billing_amount) + `centerRenewalPeriodMonths`
(annual = 12, else 1). Added `billing_period, all_in_price` to the runCenters select; removed the
dead `centerBase`. **Changes billed amount + period for annual trial centers → REQUIRES SIGN-OFF**
(no live annual trial centers exist yet). Verified: typecheck exit 0, 1299 unit tests, stabilization OK.

## Money track — adversarial review + fixes (Fable 5) — DONE ✅ ⚠️ part of the SIGN-OFF scope
Ran a 12-agent adversarial workflow over the commission rewrite (5 independent review lenses →
every finding independently re-verified by a skeptic instructed to refute it). **6 confirmed
money defects** (3 were the same root cause found by different lenses); all fixed + tested:
1. **Double-pay on reassignment (CRITICAL — the root finding, confirmed 3×):** reassigning a
   customer whose T1/T2 was already PAID to the old rep re-created the tiers payable for the
   new rep (T1 flipped eligible immediately; T2 unlocked via the cron on the inherited clock)
   → up to 2× the acquisition commission per reassigned-after-paid customer. **Fix:** per-tier
   ONCE-PER-CUSTOMER guard in `reassignCommissions` — a tier already 'paid' to any prior
   rep/manager is suppressed to 'reassigned' on the fresh row (per family: rep vs override);
   only genuinely unearned tiers transfer as earnable.
2. **Same-manager reassignment orphaned the manager's override (missed pay):** rep A → rep B
   under the SAME manager M voided M's override, and the re-insert collided (23505) with no
   revival — M permanently lost the override on that customer. **Fix:** the void loop now skips
   the override row belonging to the incoming rep's own manager.
3. **Manual adjustment paid twice:** the adjust action bumps the payout it's applied to AND the
   next generation re-added `prevPayout.adjustment_amount` as carryover. **Fix:** carryover
   removed from generation; an adjustment affects exactly the payout it is applied to.
4. **Same eligible tier sweepable into two payouts:** generation aggregated purely by status and
   only mark-paid flipped it — two drafts (different periods) could both include and disburse
   the same tier. **Fix:** payouts now CLAIM swept tiers at generation (`<tier>_payout_id`, with
   `.is(null)` guards so a claim can't be stolen), aggregation excludes claimed tiers, the
   DELETE/void release (already present) un-claims, mark-paid gained `.eq(status,'eligible')`
   guards, and `override_details` records only the tiers THIS payout swept.
- New `tests/unit/commission/reassign.test.ts` (4 tests: paid-tier suppression, unearned-tier
  transfer, same-manager override preserved, cross-manager override voided). Suite: **1303 pass**,
  typecheck 0, stabilization OK.
- Workflow stats: 12 agents, 1 verifier errored (structured-output cap) — its finding lens had
  redundant coverage; all 6 confirmed findings carried high-confidence refutation-resistant proofs.
- **New interpretation flagged for sign-off:** the eyad zero-row is 'paid at 0', so an
  eyad-sourced customer later handed to a rep pays that rep NO acquisition commission
  (once-per-customer: the acquisition was Eyad's). Confirm this is intended.
- **Known edges (documented, not bugs):** reassigning BACK to a previously-voided rep does not
  revive their old row; a draft payout generated before a reassignment keeps its frozen total
  (the status guards keep the commission ledger truthful; the draft→confirm→paid flow is a
  human-reviewed surface).

## Phase 6 — HR/commission views on the finalized engine (Fable 5) — DONE ✅
Built directly on the money-track engine (after its adversarial review), per the revised order.
Role model was already wired (4a: scoped GETs; 5: salary privacy) — Phase 6 makes the views
speak the FINAL engine's language (owner-polymorphic rows, computed-at-unlock amounts,
'reassigned' status) and adds the scoped export:
- **Commissions API** (`admin/commissions` GET): teacher-owned rows (owner_type='teacher')
  now carry a `teacher {id,name}` embed (batch-loaded from `users`) so the views can show
  the owner — the centers join is null for them. Scoping unchanged (CEO all / manager
  team+own-override / rep own; fail-closed sentinel).
- **Commissions page**: owner cell renders teacher name + "teacher" badge for teacher rows;
  `reassigned` added to the T1/T2/loyalty status colors (struck-through neutral); the loyalty
  cell now shows the AMOUNT once it exists (v2: computed at unlock = 1% of 12-mo revenue —
  a locked 0 just means "not yet"). Header gains a scoped **Export CSV** button (safe for all
  three roles — the API scopes rows server-side).
- **Commissions export** (`admin/export/commissions`): gate relaxed from super_admin-only to
  the SAME gate as the list API — CEO exports all; sales_manager/sales_rep export ONLY their
  scoped rows (getInternalScope, fail-closed sentinel); all other roles 403. Columns now
  owner-polymorphic: `owner_type / owner_code / owner_name` (teacher names batch-loaded).
  Gate-matrix test updated from superAdminOnly → commissionsScopedCases (dead helper removed).
- **Payouts views**: no change needed — Phase 4a scoping + Phase 5 commission-only whitelist
  already give rep=own / manager=team-commission-only / CEO=full.
- i18n +5 keys each locale (t1/t2/loyalty_reassigned, owner_teacher, export_csv). SW v17→v18.
- Verified: typecheck exit 0, **1303 unit tests pass**, i18n parity (3860 keys), bidi/tolocale OK.

## Post-report verification — "can anyone be billed quarterly?" (Fable 5) — ANSWERED ✅
Eyad asked whether `quarterlyAllIn` implies a live quarterly billing path. Verified in code AND
live DB: **quarterly billing is fully retired; no customer can be billed quarterly today.**
- Live `centers` CHECKs: `billing_period ∈ {monthly, annual}`, `subscription_billing_period ∈
  {monthly, yearly}` — 'quarterly' cannot be stored. Live data: all centers monthly.
- Signup UI offers only `['monthly','annual']`; renewal engine has NO 3-month clock
  (`centerRenewalPeriodMonths` → 12 or 1) and bills non-annual at the stored monthly amount.
- `getChargeFromQuarterlyAllIn`'s `'quarterly' → ×3` branch is unreachable from any live path
  (all callers derive the period from the CHECK-constrained center row); it survives only for
  legacy/normalization of historical labels.
- **`quarterlyAllIn` is NOT dead code but a legacy NAME**: it holds the per-month list rate
  (docs in pricing.ts: "Same as DB all_in_price - the per-month rate"; annual = ×10 confirms).
- **Commission base has zero quarterly dependency**: `getImpliedMonthlyMrr` returns the same
  per-month rate for 'monthly' AND legacy 'quarterly' labels (no ×3/÷3 anywhere in the path).
- Corrected the sign-off framing accordingly (rates.ts header + MERGE_CHECKLIST item 1): the
  up-front-payment case is ANNUAL (monthly×10 up front, rep earns 20% of one implied month) —
  the earlier "quarterly customer pays 3 months up front" wording was wrong and is removed.

## SIGN-OFF GRANTED (Eyad, 2026-07-13) — branch ready for merge
Eyad confirmed the two open money interpretations and approved all sign-off items:
- **Eyad-sourced → rep handover pays the rep NO acquisition commission** — CONFIRMED intended
  (eyad zero-row is 'paid at 0'; once-per-customer). No change.
- **20% base = per-month rate; quarterly billing retired** — verified in code + live DB, framing
  corrected (annual is the only up-front-payment case). No change to amounts.
- Commission/loyalty rewrite + annual-trial alignment: **SIGNED OFF.** MERGE_CHECKLIST §REQUIRES
  SIGN-OFF marked ✅.
Final state: 15 feature commits + 2 doc-correction commits on `claude/tutoring-portal-rebuild-2qfql1`,
pushed. typecheck 0, **1303 unit tests pass**, i18n/bidi/tolocale OK. Not merged (Eyad merges).
Remaining at merge = mechanical human steps only (apply 3 repo-only migrations in order; per-role
click-throughs; go-live env switches PAYMOB_RECURRING_INTEGRATION_ID + summer.first_charge_release).

## Migrations applied to live + merge (Opus 4.8, 2026-07-13) — authorized by Eyad
Eyad authorized applying the three migrations then merging to master.
- Applied in order via Supabase MCP (project lczmjpnbuhnsislcvzar), each verified:
  1. `two_level_assignment` → ledger `20260713094002` (center_assignments.manager_staff_id +
     teacher_assignments table — both confirmed present)
  2. `promo_code_requests` → ledger `20260713094018` (table confirmed present)
  3. `commission_rewrite` → ledger `20260713094037` (owner_type + teacher_id + nullable center_id
     + solo/teacher plan_at_signing CHECK + exactly-one-owner + teacher unique indexes — all
     confirmed; commissions row count still 0, greenfield preserved)
- Repo migration files renamed to their assigned ledger versions (filename prefix = ledger
  version) so a future `supabase db push` never re-runs them. SQL content unchanged.

## Fix — Internal Team add-manager/add-rep provisions the login directly (Opus 4.8, 2026-07-13)
Bug (predates the rebuild): `POST /api/admin/team` looked the person up in the customer
`users` table by phone and returned "must sign up at TutoringHQ first" if absent — forcing
employees through customer signup — and never linked a `staff` row. Fixed per Eyad's chosen
approach (relax the PIN rail + extend /set-pin):
- **Migration `20260713112808_pin_setup_tokens_auth_users_fk`** (APPLIED live): repoint
  `pin_setup_tokens.user_id` FK from `public.users(id)` → `auth.users(id)` so a center-less
  internal admin (no `public.users` row — documented invariant) can hold a set-PIN grant.
- **`src/lib/staffLoginProvision.ts`** (new): mirrors `provisionCenterOwner` for an employee —
  `auth.admin.createUser` (`<digits>@centerhq.local`), a `mintForFallback` set-PIN grant, and a
  best-effort WhatsApp link. No `users` row, no center/billing.
- **`POST /api/admin/team`**: if no login exists for the phone, provision directly; insert
  `admin_users` (chosen role; super_admin still blocked, self-add blocked); link the `staff` row's
  `user_id` by phone (only when currently NULL); return the one-time set-PIN link. Rolls back a
  freshly provisioned auth user if the `admin_users` insert fails (no orphans). Existing-customer
  reuse preserved.
- **`/api/auth/set-initial-pin`**: added an internal-admin branch to the token path — a user with
  an `admin_users` row and NO `users` row skips the users-row + center-paid gates; the single-use
  token claim + `invalidateSiblingTokens` is the double-set guard. **Center-owner path unchanged.**
- **Internal Team UI**: surfaces the returned set-PIN link in a copyable modal (i18n +5 keys ar/en).
- **Verified end to end (live, read-only proofs + unit):** FK now → auth.users (live); a
  pin_setup_tokens insert for a center-less internal admin is ACCEPTED (was impossible pre-migration);
  `/api/login` resolves a center-less admin to `<digits>@centerhq.local` (live). set-initial-pin
  internal-admin branch: +2 unit tests (sets PIN skipping the center gate; rejects a token whose
  user has neither a users nor an admin_users row). typecheck 0, 1305 tests, i18n/bidi/tolocale OK.
  (The live `auth.admin.createUser` primitive itself is the same one `provisionCenterOwner` uses in
  prod; not re-exercised here since no service key is exposed to the session.)
