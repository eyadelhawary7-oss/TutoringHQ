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

### Centers-route auth refactor
- (pending) `/api/admin/centers` onto `getAdminContext` before Phase 4.
