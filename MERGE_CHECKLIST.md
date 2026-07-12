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

## Environment / config switches (go-live, not on-branch)
| Switch | Purpose |
|--------|---------|
| `PAYMOB_RECURRING_INTEGRATION_ID` (sandbox) | required for W3 saved-card save + auto-charge tests |
| `summer.first_charge_release` HELD→RELEASED | one-time money release at go-live |
