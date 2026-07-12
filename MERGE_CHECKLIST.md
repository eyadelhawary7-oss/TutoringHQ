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

## Data fixes — DONE on live DB (the one authorized correction)
| Item | Action | Status |
|------|--------|--------|
| Stale teacher trial (Eyad's test account) | Per Eyad: the `teacher_id 68718be7…` account ("Aly Shady", +201220601810) is his own test account despite `is_test=false`. **Authorized live-DB correction applied:** set `teacher_profiles.is_test=true`; deleted the stale `teacher_subscriptions` `trialing` row and its 1 unpaid invoice (no paid history). Verified: is_test=true, 0 sub rows, 0 invoices. | ✅ done (authorized) |

## REQUIRES SIGN-OFF (money — built, tested, NOT final until Eyad approves)
_None committed yet. The commission/loyalty rewrite (money track) and the annual-trial
billed-amount/period fix will each land as their own REQUIRES SIGN-OFF commits._

## Human click-throughs required before merge
| Area | What to verify |
|------|----------------|
| Signup happy path | `/signup` → owner provisioned → `/set-pin` → PIN → auto-login to dashboard |
| e2e | Run `tests/e2e/signup-happy.spec.ts` against a live preview (not runnable in build env) |
| Phase 2 — CEO home | Trials-watch widget renders on `/ceo` (super_admin) and is absent for accountant; `/admin` overview layout OK after removing the fake Security-alerts + Pending-Signups tiles; `/ceo-dashboard` and legacy `/admin?tab=ceo` land on `/ceo`; RTL of new Arabic strings |
| Phase 3 — combined screens | Centers/Teachers/All toggle on billing/renewals/finance URL-syncs (`?owner_type=`) and refetches; needs an env WITH real teacher subscriptions to see teacher rows + folded finance MRR (dev DB has none); teacher rows hide center-only actions (Mark paid / Record payment → em-dash); finance `all` north-star tiles = center + teacher |
| Phase 4a — scoping | Log in as a real `sales_manager` and `sales_rep` (staff.user_id linked, admin_users.role set, approved center_assignments): Centers/Card-Orders/Commissions/Payouts show ONLY their scope; write buttons hidden; direct mutation attempts 403; unlinked sales role sees nothing |

## Phase 4a follow-ups (UI/scope refinements — decide before merge)
| Item | Note |
|------|------|
| Manager payout salary inference | Scoped payout view still shows `total_amount` + commission tiles → a manager can subtract to infer a rep's base_salary. The manager payout VIEW should show status/commission only. (To refine in Phase 5 rep/manager views.) |
| Centers-page write buttons | suspend/delete/blacklist/change-plan buttons remain visible to sales roles (API fails closed). Decide whether to hide them for sales roles (can't gate on `role==='super_admin'` alone without stripping accountant's legitimate buttons). |

## Environment / config switches (go-live, not on-branch)
| Switch | Purpose |
|--------|---------|
| `PAYMOB_RECURRING_INTEGRATION_ID` (sandbox) | required for W3 saved-card save + auto-charge tests |
| `summer.first_charge_release` HELD→RELEASED | one-time money release at go-live |
