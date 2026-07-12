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

## Data fixes to run at merge (NOT applied on-branch — no live-DB writes allowed)
| Item | Action | Status |
|------|--------|--------|
| ⚠️ Stale teacher trial — **REAL ACCOUNT, needs a decision** | `teacher_subscriptions` row (`teacher_id 68718be7…`, "Aly Shady", +201220601810) stuck `status='trialing'` 15 days past `trial_ends_at`=2026-06-26. **`teacher_profiles.is_test = false` — this is NOT test data**, contrary to the audit's assumption, so it was **left untouched**. It exposes the teacher trial-conversion gap (`process_due_subscriptions` has no caller). Decide the business outcome (charge 499 / convert / lapse to free baseline / extend) **before** enabling any teacher trial-expiry automation. **REQUIRES SIGN-OFF (money — real customer).** | ⛔ human decision required |

## REQUIRES SIGN-OFF (money — built, tested, NOT final until Eyad approves)
_None committed yet. The commission/loyalty rewrite (money track) and the annual-trial
billed-amount/period fix will each land as their own REQUIRES SIGN-OFF commits._

## Human click-throughs required before merge
| Area | What to verify |
|------|----------------|
| Signup happy path | `/signup` → owner provisioned → `/set-pin` → PIN → auto-login to dashboard |
| e2e | Run `tests/e2e/signup-happy.spec.ts` against a live preview (not runnable in build env) |

## Environment / config switches (go-live, not on-branch)
| Switch | Purpose |
|--------|---------|
| `PAYMOB_RECURRING_INTEGRATION_ID` (sandbox) | required for W3 saved-card save + auto-charge tests |
| `summer.first_charge_release` HELD→RELEASED | one-time money release at go-live |
