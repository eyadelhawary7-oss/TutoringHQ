# PIN-set Cleanup — Findings Note

Branch: `claude/pin-code-cleanup` (off latest `master`). Live catalog introspected
first (Supabase project `lczmjpnbuhnsislcvzar`, Postgres 17).

## 1. How "PIN is set" is derived today, and every reader

The **real** login credential is the Supabase Auth password (`auth.users.encrypted_password`).
`public.users.pin_code` is a dead bcrypt/sha256 mirror that was *intended* to be the
"has the owner set their PIN yet" flag (`NULL` = not yet, non-NULL = set).

**Readers of `pin_code` (the "has PIN" gate) — must move to the new signal:**

1. `src/app/[locale]/set-pin/page.tsx` — `select('id, pin_code')` for the owner; `if (ow.pin_code)` → owner already finished, redirect to login.
2. `src/app/api/auth/set-initial-pin/route.ts` (cookie path) — owner lookup; `if (owner.pin_code)` → `pin_already_set` (double-set guard).
3. `src/app/api/auth/set-initial-pin/route.ts` (pre-claim) — user lookup by id; `if (userRow.pin_code)` → `pin_already_set` (double-set guard).
4. `src/app/api/auth/request-pin-setup-link/route.ts` — owner lookup by phone; `if (user.pin_code)` → don't issue the Set-PIN link.
5. `src/app/api/signup/pin-setup-readiness/route.ts` — owner lookup; `if (owner.pin_code)` → readiness reports PIN set.

**Writers of `pin_code` (mirror) — become dead once the column is dropped; removed:**

6. `src/app/api/signup/complete/route.ts` — `pin_code: hashedPin` in the owner INSERT (auth password set separately via `updateUserById` just above).
7. `src/app/api/admin/centers/route.ts` — `pin_code: hashedPin` in the owner INSERT (auth password set via `createUser` just above).
8. `src/app/api/accept-invite/complete/route.ts` — `pin_code: hashedPin` in the user INSERT (auth password set via `updateUserById` just above).
9. `src/app/api/auth/set-initial-pin/route.ts` — best-effort mirror after the real password is set.
10. `src/app/api/auth/change-pin/route.ts` — mirror after password change.
11. `src/app/api/auth/verify-pin-reset/route.ts` — mirror before password reset.
12. `src/app/api/teacher/settings/change-pin/route.ts` — mirror after password change.
13. `src/lib/signupPaymobAutoApprove.ts` — `pin_code: null` at owner creation (placeholder-password stage).

Comment-only mentions updated for accuracy: `reset-pin`, `verify-pin-reset`,
`request-pin-setup-link`, `set-initial-pin`, `change-pin`, `teacher/settings/change-pin`,
`signupPaymobAutoApprove`. `src/lib/waTemplatePreviewSamples.ts` uses a WhatsApp
template variable literally named `pin_code` — unrelated, left as-is.

## 2. Chosen authoritative signal: `public.users.pin_set_at timestamptz`

The brief prefers deriving from the real source of truth (the auth password) if one
exists. **It does not work here**, because of the actual signup design:

- `signupPaymobAutoApprove` creates the auth user with a **256-bit random placeholder
  password** and `pin_code = NULL`; the owner later replaces it via `set-initial-pin`.
- So `auth.users.encrypted_password` is **non-NULL before any PIN is chosen** — it cannot
  distinguish "placeholder, no PIN yet" from "real PIN set."

Introspection confirmed the fallout: **all 6 real users have `encrypted_password` set but
`pin_code IS NULL`** — the mirror never populated, so the double-set guard is effectively
already bypassed today.

Therefore the authoritative signal is a dedicated **`pin_set_at timestamptz`** on
`public.users`: `NULL` = no PIN set, non-NULL = PIN set (value = when it was set). It is a
plain `public.users` column, so every reader keeps its existing `.from('users').select(...)`
— **no RPC / no auth-schema coupling.** It is set atomically in the creation INSERTs and
written in every real-PIN-set path; `signupPaymobAutoApprove` leaves it NULL (placeholder).

## 3. Backfill (authoritative, NOT from `pin_code`)

`pin_code` is NULL for everyone, so backfilling from it would wrongly mark all existing
users as "no PIN." Backfill instead from `auth.users.last_sign_in_at IS NOT NULL` — a user
who has authenticated must possess a real credential (you cannot sign in with an unknown
placeholder). All 6 current users have `last_sign_in_at` set and are backfilled; the one
`owner` (`+201533333333`) included, so no real owner is left incorrectly "unset."

## 4. Migration ordering / prod safety (important)

- **Migration `20260701...add_pin_set_at` (add column + backfill): applied to prod now** —
  additive; old code ignores it. Backfill verified with a follow-up query.
- **Migration `20260701...drop_pin_code` (drop column): tracked but NOT applied to prod in
  this session.** Prod currently runs `master`, which still INSERTs `pin_code`
  (`signup/complete`, `admin/centers`, `accept-invite`, `signupPaymobAutoApprove`); dropping
  the column before this branch deploys would break live signup/invite. Per the brief ("only
  after no code reads `pin_code`, drop"), it must run at deploy time, once this branch is
  live. `db/schema.snapshot` is regenerated to the post-drop end state (matching the tracked
  migrations), so the rebuild drift gate is green; the live-vs-prod gate will show `pin_code`
  as an expected pending drop until the deploy applies it.

## 5. Supporting changes

- `scripts/schema/test-shim.sql`: the bare-Postgres `auth.users` stand-in gained a
  `last_sign_in_at timestamptz` column so the backfill migration parses/runs on a rebuild
  (0 rows there). This is test/CI infra only and does not affect the public-schema snapshot.
- Unit tests `auth-set-initial-pin` / `auth-request-pin-setup-link` were moved from mocking
  `pin_code` to `pin_set_at` (the field the routes now read); both pass.
- Lint: `master` already had 37 pre-existing lint errors (vendored `public/workbox/**` +
  two test files) unrelated to this change. To satisfy the lint gate on this branch, the
  same minimal fixes were applied (ignore `public/workbox/**`; drop two `any`s in
  `tests/e2e/setup/seed.ts`; stop aliasing `this` in `tests/unit/redeemPromoCode.test.ts`).

## 6. Login / PIN-set verification

- **Login (phone + PIN) is unchanged**: it authenticates against the Supabase Auth password;
  no login route or password-setting call was touched. `pin_set_at` is only a flag.
- **PIN-set flow**: `set-initial-pin` still sets the auth password (the credential) and now
  stamps `pin_set_at`. A fresh owner (placeholder, `pin_set_at` NULL) sees the set-PIN form,
  sets the PIN, and a second attempt is correctly refused with `pin_already_set` — the
  double-set guard, previously inert because `pin_code` was NULL for everyone, now actually
  fires. Covered by the two updated unit tests. `request-pin-setup-link` and readiness read
  the same flag.
</content>
