# MERGE_CHECKLIST — Portal Rebuild

Everything a human must do/verify before merging this branch to `master`. Nothing here
has been applied to the live database; migrations are repo files only.

## Migrations to apply at merge (in order)
_None new yet. The two already-applied migrations were renamed on-branch to match the
live ledger versions (`20260710194333`, `20260711095712`) — they are ALREADY LIVE; do
not re-run._

| Order | File | Applied to live? | Notes |
|------:|------|:---:|-------|
| — | `20260710194333_phase1_staff_user_link_and_manager_role.sql` | ✅ yes (renamed to match ledger) | do not re-run |
| — | `20260711095712_trial_claims.sql` | ✅ yes (renamed to match ledger) | do not re-run |
| 1 | `20260712120000_two_level_assignment.sql` | ❌ NOT applied (repo only) | **NEW DATA** — `center_assignments.manager_staff_id` (FK staff) + relaxed `sourced_by_eyad_no_staff` CHECK; new `teacher_assignments` table (service-role-only RLS). Apply before the Phase-4b code runs. Idempotent. |
| 2 | `20260712130000_promo_code_requests.sql` | ❌ NOT applied (repo only) | **NEW DATA** — new `promo_code_requests` table (service-role-only RLS): manager promo requests + CEO approve/reject. Apply before Phase-4c code runs. Idempotent. |
| 3 | `20260712140000_commission_rewrite.sql` | ❌ NOT applied (repo only) | **NEW DATA + SCHEMA — ⚠️ REQUIRES SIGN-OFF (money).** Adds 'solo' + teacher plan keys to `plan_at_signing` CHECK (fixes the solo insert crash); owner polymorphism on `commissions` (`owner_type` + `teacher_id` FK, `center_id` nullable, exactly-one-owner CHECK); teacher partial unique indexes + tightened center ones; 'reassigned' added to tier status CHECKs. Safe on the live dataset (0 commission rows). Apply before the commission-rewrite code runs. Idempotent. |

## Data fixes — DONE on live DB (the one authorized correction)
| Item | Action | Status |
|------|--------|--------|
| Stale teacher trial (Eyad's test account) | Per Eyad: the `teacher_id 68718be7…` account ("Aly Shady", +201220601810) is his own test account despite `is_test=false`. **Authorized live-DB correction applied:** set `teacher_profiles.is_test=true`; deleted the stale `teacher_subscriptions` `trialing` row and its 1 unpaid invoice (no paid history). Verified: is_test=true, 0 sub rows, 0 invoices. | ✅ done (authorized) |

## REQUIRES SIGN-OFF (money — built, tested, NOT final until Eyad approves)

### 1. Commission/loyalty rewrite (commit "Money track: commission/loyalty rewrite")
Replaces the fixed-EGP engine. **Every commission amount changes.** Built + green (typecheck,
1299 tests) + adversarially reviewed, but NOT to be merged until Eyad signs off the rules below.
- **rep = 20% of the customer's MONTHLY plan price**, split into two equal halves: T1 at conversion,
  T2 at 180 active days **recomputed at the price in force then** (up/downgrades move the 2nd half).
- **loyalty = 1% of realized first-12-months revenue** (Σ paid invoices in the 12mo window), at 365 days.
- **manager override = 20% of the rep's commission AND 20% of the rep's loyalty.**
- Applies to centers AND teachers; once per customer.
- **Interpretation decisions that change payout amounts — confirm each:**
  1. "monthly plan price" = the implied **monthly** figure (quarterly all-in ÷ period / teacher
     `price_gross`), NOT the full quarterly/annual amount charged that cycle. A quarterly customer
     pays 3 months up front; the rep earns 20% of ONE month. **← biggest lever; confirm.**
  2. Each rep half = 10% of monthly; override halves = 2% of monthly; override loyalty = 0.2% of 12mo revenue.
  3. `delta_upgrade` commission rows are left UNPAID (not auto-eligible).
  4. Reassigning BACK to a rep who was previously voided leaves their old 'reassigned' row (insert
     dedups on 23505) → they would not be re-paid. Rare; decide whether to handle.
  5. **Eyad-sourced → rep handover pays the rep NO acquisition commission** (the eyad zero-row is
     'paid at 0'; once-per-customer means the acquisition was already consumed). Confirm intended.
  6. **Adjustment carryover removed:** a manual payout adjustment now affects exactly the payout it
     is applied to (it was previously ALSO re-added to the next payout → paid twice). Cross-period
     corrections = adjust the next payout directly.
- **Adversarially reviewed:** a 12-agent refute-style workflow confirmed 6 money defects
  (reassignment double-pay ×3 lenses, same-manager override orphaned, adjustment double-pay,
  double-sweep of eligible tiers) — ALL FIXED + regression-tested (see BUILD_LOG). Payouts now
  claim swept tiers at generation; mark-paid has status guards.
- **Apply migration `20260712140000` before this code runs.** Nothing is applied to live yet.

### 2. Annual-trial billed-amount/period alignment (commit "Money track: annual-trial alignment")
The summer trial's first invoice now uses the same period-aware helpers as the normal renewal
(`centerRenewalBaseAmount` + `centerRenewalPeriodMonths`): an **annual** trial center is billed
`all_in × annualMultiplier (=10)` over a **12-month** period (not a monthly amount over a hardcoded
30-day window); monthly is unchanged. **Changes the billed amount + period for annual trial
centers → confirm before merge.** (No live annual trial centers exist yet.)

## Human click-throughs required before merge
| Area | What to verify |
|------|----------------|
| Signup happy path | `/signup` → owner provisioned → `/set-pin` → PIN → auto-login to dashboard |
| e2e | Run `tests/e2e/signup-happy.spec.ts` against a live preview (not runnable in build env) |
| Phase 2 — CEO home | Trials-watch widget renders on `/ceo` (super_admin) and is absent for accountant; `/admin` overview layout OK after removing the fake Security-alerts + Pending-Signups tiles; `/ceo-dashboard` and legacy `/admin?tab=ceo` land on `/ceo`; RTL of new Arabic strings |
| Phase 3 — combined screens | Centers/Teachers/All toggle on billing/renewals/finance URL-syncs (`?owner_type=`) and refetches; needs an env WITH real teacher subscriptions to see teacher rows + folded finance MRR (dev DB has none); teacher rows hide center-only actions (Mark paid / Record payment → em-dash); finance `all` north-star tiles = center + teacher |
| Phase 4a — scoping | Log in as a real `sales_manager` and `sales_rep` (staff.user_id linked, admin_users.role set, approved center_assignments): Centers/Card-Orders/Commissions/Payouts show ONLY their scope; write buttons hidden; direct mutation attempts 403; unlinked sales role sees nothing |
| Phase 5 — rep lockout + salary privacy | As a `sales_rep`: `/admin/orders` (card orders) redirects/403s — reps must not see the fulfilment queue. As a `sales_manager`: the Payouts view shows commission tiles + status only, **no total-pay / base-salary column** (so a rep's base_salary cannot be inferred by subtraction). CEO still sees full totals. |
| W3 — saved-card opt-in (sandbox) | On `/pay` and `/teacher/pay`, the "save my card for automatic renewal" checkbox is present and **OFF by default**; paying with it OFF behaves exactly as before (no card saved). Requires sandbox `PAYMOB_RECURRING_INTEGRATION_ID` to actually tokenize + auto-charge; without it the engine stays INERT (nothing saved/charged). Verify a first payment with the box TICKED produces a Paymob TOKEN callback and a `saved_cards` row (teacher + center). |
| W4 — export paid-only gate | As a **trial** customer (center `summer_status='enrolled'`, or teacher `status='trialing'`) with no paid invoice: dashboard Excel / payments CSV / analytics P&L CSV buttons show the "upgrade to export" upsell (disabled); the teacher income CSV endpoint returns **402**. As a **paid** customer (or one with any paid invoice — incl. an existing payer swept into the free runway): all four export. **MUST still work for everyone (never gated):** invoice/receipt/payout PDFs and the `/legal/privacy-request` (PDPL) form. Fallback: while `summer.promo.enabled=true` (current live value) new signups still get the trial; only if the switch is turned OFF do new signups fall to normal billing (no trial) — verify that branch if you flip it. |

## Phase 4a follow-ups (UI/scope refinements — decide before merge)
| Item | Note |
|------|------|
| Manager payout salary inference | ✅ RESOLVED in Phase 5 — scoped (non-CEO) payout view is now commission-only (no `total_amount`/`base_salary`). |
| Centers-page write buttons | suspend/delete/blacklist/change-plan buttons remain visible to sales roles (API fails closed). Decide whether to hide them for sales roles (can't gate on `role==='super_admin'` alone without stripping accountant's legitimate buttons). |

## Environment / config switches (go-live, not on-branch)
| Switch | Purpose |
|--------|---------|
| `PAYMOB_RECURRING_INTEGRATION_ID` (sandbox) | required for W3 saved-card save + auto-charge tests |
| `summer.first_charge_release` HELD→RELEASED | one-time money release at go-live |

## Cron schedule change (ships in vercel.json — auto-applies on deploy)
| Cron | Change | Why |
|------|--------|-----|
| `subscription-autocharge` | `0 22 * * *` → `30 23 * * *` (W3) | Run AFTER `summer-billing` (`0 23`) so a same-night first invoice is collected immediately; pairs with the `.lte('due_date')` straggler widening. No `maxDuration` change. |
