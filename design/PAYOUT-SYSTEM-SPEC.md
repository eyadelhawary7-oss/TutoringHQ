# Payout system — specification for review

**Produced 2 August 2026. Nothing here is built. No code was written.**

**✅ All nine decisions answered by Eyad, 3 August 2026, and every follow-on question closed** — each is
marked `✅ DECISION n — ANSWERED` at the point it was raised, and summarised in §11. Eight were accepted as
recommended; **Decision 8 was decided against the recommendation and then revised** — final model is
delegated approval with a cap (CEO final at any amount, optional CEO-granted manager approval below a
config-driven 10,000 EGP cap, plus a 10,000 EGP per-center rolling-7-day cap) — and its consequences are
worked through in §7. The four follow-on questions the revision opened are all now answered: the
permission's name and table (§7.1), anti-splitting (§7.2), CEO unavailability (§7.5), and the external
hash-chain sink (§7.4). The original questions and reasoning are left in place unedited as the record of
what was weighed.

**This is still not a document to build from directly**, but what blocks it is now external, not internal.
Two things remain outstanding and both gate implementation: the Paymob commercial conversation
(onboarding is manual on their side), and the seven questions in §8 that need written answers from Paymob.
Nothing else is waiting on a decision.

**One thing this spec produced that lives outside it:** the `SUPER_ADMIN_PHONES` hole surfaced in §7.5 is
logged as **S10** in `BUILD-AFTER-REDESIGN.md`, because it is a defect in the existing admin surface
independently of whether this feature is ever built.

Sources: the live production catalog (Supabase `lczmjpnbuhnsislcvzar`), the live codebase, and Paymob's
own documentation across three estates (`payouts.paymobsolutions.com/docs`, `developers.paymob.com`, the
official Postman collection). Facts sourced from Paymob are quoted. Facts about our own system come from
the live catalog, never from a migration file and never from code that merely references a column.

---

## 0. The headline finding: this is two systems, not one

The original request described "a ledger tracking what's collected per center." Verified against
production, that describes money **the platform has never held**:

| table | live rows |
|---|---|
| `payments` | **0** |
| `payout_requests` | **0** |
| `withdrawal_requests` | **0** |
| `attendance_scans` | 3 |
| `transactions` | 3 |
| `invoices` | 2 |
| `centers` | 2 |

`digital_student_fee_collection.enabled` — the switch governing online tuition collection — **has no row
in `platform_config` at all**, and the module reads fail-closed (*"Default is false (dormant)... any error
→ false"*). `platform_config.lesson_commission` is `{teacher_pct: 0, customer_pct: 0, processing_flat: 0}`.

So the work splits cleanly:

- **System 1 — Referral and credit payouts.** Real money the platform genuinely owes centers today, on
  rails that already exist. **Shippable without V3.** Specced in full below.
- **System 2 — Tuition settlement payouts.** The "collected per center" ledger. **Cannot be built now** —
  it is downstream of V3 online collection. Cross-referenced in §9, deliberately not designed.

---

# SYSTEM 1 — Referral and credit payouts

## 1. What money this actually moves

Two distinct obligations, both real, both already accrued in production code:

**(a) Referral earnings.** Centers earn recurring commission (25% month 1, 10% months 2–12, 5% month 13+)
for referring other centers. Accrues into `referral_commissions` via a live monthly cron. Withdrawn via
`POST /api/referrals/payout` → `payout_requests`.

**(b) Credit cash-out.** Centers accumulate `centers.credit_balance` and convert it to cash at **2:1** —
`cashAmount = creditAmount / 2; feeAmount = creditAmount / 2`. Requested via `POST /api/billing/withdrawal`
→ `withdrawal_requests`.

Current live terms:

| | Referral (a) | Credit (b) |
|---|---|---|
| minimum | 1,000 EGP (`REFERRAL_WITHDRAWAL_MIN_EGP`) | 2,000 credits → 1,000 EGP |
| fee | flat 20 EGP, then 5% of remainder | 50% (the 2:1 rate) |
| destination | InstaPay only | InstaPay only (`centers.instapay_number`) |
| cadence | on request | quarterly window |
| approval | **none exists — see §2** | `PATCH /api/admin/withdrawals/[id]` |

**✅ DECISION 1 — ANSWERED: unify, on owner-only + step-up auth.** Do (a) and (b) become one payout pipeline with one ledger, one approval queue and one
Paymob integration, or stay two? **Recommendation: unify.** They are the same operation — move EGP to a
center's InstaPay handle — differing only in what accrued the balance. Two pipelines means two of every
control in §6, and the controls are the expensive part.

## 2. Seven blocking defects that must be fixed before anything ships

These are **live today**, found by direct code and catalog reads. Each is a prerequisite, not a nice-to-have.

**2.1 — `payout_requests` has no approval path whatsoever.** No API route and no admin page anywhere reads
`payout_requests` for approval. A center can submit a referral payout request today and **its status can
never leave `pending` through any code path in the application.** Six files reference the table; none can
approve.

**2.2 — The credit-withdrawal approval races, and double-pays on a double-click.**
`src/app/api/admin/withdrawals/[id]/route.ts` performs four separate un-transacted round trips: a
non-locking `.select` (:37), a `status !== 'pending'` check (:57), `cancel_reservation_atomic` (:74),
`spend_credits_atomic` (:84), then `.update({status:'paid'})` (:105). Two admins processing the queue
simultaneously — or one operator double-clicking — both pass the :57 check, both proceed, and **both
return `{success:true}` and both fire the "withdrawal processed" WhatsApp.** A zero-row `UPDATE` returns no
error from PostgREST, so the loser is indistinguishable from the winner. On the other branch, if
`spend_credits_atomic` raises after `cancel_reservation_atomic` already released the reservation, the
center's full balance is restored and immediately re-withdrawable **while the cash has already been sent**.
*Fix as a standalone PR before any payout work:* one `SECURITY DEFINER` RPC doing `SELECT ... FOR UPDATE`,
idempotent re-call, release + spend + status flip + `audit_log` in one transaction; plus
`UNIQUE INDEX one_pending_withdrawal_per_center ON withdrawal_requests(center_id) WHERE status='pending'`.

**2.3 — `centers.instapay_number` is writable through the `/api/db` proxy.** It is not in
`CENTERS_PROTECTED_COLUMNS`, and `centers` is a direct `TABLE_SCOPE` entry. Anyone holding a center
session can change the payout destination. The existing `/api/billing/withdrawal` route already snapshots
the number onto the request row, which limits the blast radius today — but any new design that reads a
destination at release time instead of a snapshot reintroduces it. See attack **A2**.

**2.4 — The quarterly window tells centers the wrong date.** `nextProcessingQuarterStart('2026-01-05')`
returns **`2026-04-01`** — three months away — for a request made *inside* the open January window. The
center is told to wait a quarter for money they just successfully requested.

**2.5 — Credit reservations never expire.** `credit_reserved` is set by `reserve_credits_atomic` with no
expiry, no ledger row and no sweeper. The two crons calling `cancel_reservation_atomic`
(`cleanup-expired-sessions`, `check-stuck-payments`) never look at `withdrawal_requests`. An abandoned or
errored request fences the center's credits **indefinitely** — unspendable and unwithdrawable.

**2.6 — None of the three money-movement routes validates CSRF.** Wider than the existing **S7**, which
only ever covered the referral route. Verified by direct grep — `validateCSRFRequest` appears **zero
times** in all three:

| route | what it does | CSRF |
|---|---|---|
| `POST /api/referrals/payout` | creates a referral payout request | **none** (S7) |
| `POST /api/billing/withdrawal` | creates a credit withdrawal request | **none — not previously logged** |
| `PATCH /api/admin/withdrawals/[id]` | **marks a withdrawal paid — authorises real money** | **none — not previously logged** |

The admin route is the serious one: it is the gate that releases money, and it is unprotected. S7's "low
blast radius because `available` is always 0" reasoning never applied to it at all, and stops applying to
any of them the moment this system works.

**2.7 — The two payout-initiating routes have asymmetric authorization, and unifying them could silently
widen access.** `/api/billing/withdrawal` is **owner-only** (`auth.role !== 'owner'` → reject).
`/api/referrals/payout` gates on a **delegable staff permission**, `can_request_referral_payouts` — which
is currently `true` on exactly **1 row in the entire database**. Two routes that move money out of the same
center enforce two different rules. **Decision 1 (unify the pipelines) must therefore also pick a gate**,
and picking the weaker one would hand payout initiation to staff accounts at centers that today are
owner-only, with no announcement. *Recommendation: unify on owner-only plus step-up auth, and treat
`can_request_referral_payouts` as request-only — never release.*

### 2.7.1 — Half of 2.7 is now fixed in code; the other half is still Eyad's to decide

**Landed 4 August 2026** on `claude/payout-2-7-auth-symmetry`. **The pipelines were NOT unified** — that is
Decision 1 and it is not an implementer's call. What landed is the half that needs no decision because it
can only ever *remove* access: the weaker route was raised to the stronger route's floor.

**Live re-verification, 4 August 2026, production catalog `lczmjpnbuhnsislcvzar`.** The "exactly 1 row"
figure in 2.7 above was re-checked rather than repeated, and the re-check changed the conclusion:

| fact | value |
|---|---|
| `public.users.can_request_referral_payouts` | exists — `boolean NOT NULL DEFAULT false` |
| rows with the flag `true` | **1**, out of **4** `public.users` rows total |
| the holder | `3150d66a-…`, role **`owner`**, center `fcd5c5ef-…` "Test Center 333", **`is_test = true`** |
| rows with role `admin` or `assistant` anywhere | **0** |
| functions in `pg_proc` referencing the permission | **0** — application code is the entire enforcement surface |
| `payout_requests` / `withdrawal_requests` rows | 0 / 0 |
| `admin_users` rows / of those with a `public.users` row | 2 / **0** |

**The count is still 1, but the row is an owner — so the delegable permission currently authorises nobody
who is not already an owner.** It has never granted access to a single non-owner account, because no
non-owner centre-staff account exists in the database at all. Two things follow, and they point in
opposite directions:

- **The migration risk of choosing owner-only is zero today, not merely small.** The A15 concern — "nobody
  would notice the semantics changed until it was used" — cuts the other way as well: nobody would notice
  the permission being retired either, because it is doing no work.
- **The 1-row figure should stop being cited as evidence that the delegation is in use.** It is a seed
  artefact on a test centre (`is_test = true`), not a customer configuration.

**What changed in code.** `POST /api/referrals/payout` moved off the generic `requirePermission` onto a new
`requireMoneyRequestPermission` (`src/lib/centerPermissions.ts`). The gate is now:

```
intent ≠ 'request'  ->  THROW                          -- checked first, before role or flag (see below)

pass ⇔ role = 'owner'                                  -- identical to /api/billing/withdrawal
     ∨ (role ∈ {admin, assistant} ∧ flag = true)       -- an explicit, live, owner-granted delegation
```

The `intent` precondition was added by the second commit on this branch and is described in full below —
it is the strongest control here, and it is a precondition on *every* arm, not an extra arm.

Three arms that `requirePermission` allowed are closed:

1. **`isSuperAdmin` alone.** `hasPermission` short-circuits on it, so a platform super-admin with no
   `public.users` row — ZERO_PERMISSIONS, not an owner — could initiate a centre's payout request. The
   sibling withdrawal route already rejected that identity (`auth.role` is `'super_admin'`, not `'owner'`).
   Per §7.5 a `SUPER_ADMIN_PHONES` entry mints such an identity **with no database row at all**, so this
   was a forensically anonymous initiation path. Verified live: 2 `admin_users` rows, **0** with a
   `public.users` row; and the only caller of the route in `src/` is the centre-side
   `ReferralWithdrawalPanel.tsx` — no admin or CEO surface calls it, so nothing in the product loses a
   capability it was using.
2. **Centre-less roles holding the flag.** The live `users_center_check` constraint is
   `(role ∈ {owner,admin,assistant} ∧ center_id IS NOT NULL) ∨ (role ∈ {super_admin,teacher} ∧ center_id IS NULL)`,
   so a `teacher` or `super_admin` row is never centre staff however it reached a centre context (a teacher
   reaches one via `?center_id=` plus `teacher_center` membership). A flag on such a row is not a
   delegation and no longer reads as one.
3. **Ambiguity about which arm passed.** Owner and delegate are now separate arms, so "who may request" is
   readable rather than inferred.

**Behaviour for the one live holder is unchanged** — it is an owner row and passes on the owner arm either
way.

**Request-only is now asserted in code, not just in prose.** `REQUEST_ONLY_MONEY_PERMISSIONS` lists
`can_request_referral_payouts`; `assertNotReleaseAuthority()` throws on it; and `hasPermission` /
`requirePermission` **throw** when handed it, so the specific mistake this section warns about — a future
approval path reaching for the familiar `requirePermission(auth, 'can_request_referral_payouts')` — fails
loudly on the first call in every environment instead of silently granting. The type
`ReleaseAuthorityPermission = Exclude<CenterPermission, RequestOnlyMoneyPermission>` makes it a compile
error as well. `tests/unit/payoutRequestAuthority.test.ts` pins all of it, including a source scan that
fails if any new file in `src/` references the permission or if any approval/release-shaped API path does.

**That tripwire alone was evadable, and the second commit on this branch closed the hole.** The audit
disclosed it rather than leaving it to be found later. `assertNotReleaseAuthority` fires on the *literal
permission string*, and the string scan greps for the same literal, so a release path written by
indirection —

```ts
requireMoneyRequestPermission(auth, REQUEST_ONLY_MONEY_PERMISSIONS[0])
```

— type-checked, passed every test then in the file, and **granted on the owner arm**, without a single
string literal anywhere for either control to catch. That shape is exactly §7.1's payee-self-approval
failure: the centre owner approving their own payout. Two complementary controls now close it, and both
were verified by mutation rather than by reading:

1. **A required `intent` argument, checked at runtime.** `hasMoneyRequestAuthority` and
   `requireMoneyRequestPermission` take a third parameter `intent: MoneyMovementIntent` (`'request' |
   'release'`), and `assertRequestIntent()` is the first statement in the gate — it runs *before* any
   role or flag is looked at. There is no default value. Three properties follow, and the third is the
   one that matters most:
   - Passing `'release'` **throws in every environment**, on the first call, for **every** identity shape
     — owner, delegated admin/assistant, centre-less role, `isSuperAdmin`, and a tampered role string
     alike. There is no principal a release path can find that slips through. It is a throw and not a
     403 because reaching it means a code path was wired to the wrong authority source: a programming
     error, not a user error. Fail closed and loud.
   - A release path can therefore only reach the gate by writing `'request'` next to code that approves
     money — a lie that is visible in the diff. This cannot make a determined author safe; it can only
     make the mistake impossible to commit silently.
   - **Omitting the argument entirely also throws.** TypeScript rejects the two-argument call, but a JS
     caller, an `as any` escape, or a transpiled call that drops the argument lands on `intent ===
     undefined`, which is not `'request'`, so `assertRequestIntent` throws on that too. The gate cannot
     be reached by *forgetting* about it — only by an explicit, reviewable claim. (This property was
     found by a test written to assert something weaker.)

2. **A second source scan, over the indirect handles.** The original scan matched only the literal
   permission string, so the indirect form never appeared in it at all. A second scan now fails if any
   file under `src/` mentions `REQUEST_ONLY_MONEY_PERMISSIONS`, `hasMoneyRequestAuthority`,
   `requireMoneyRequestPermission`, `assertRequestIntent` or `RequestOnlyMoneyPermission` outside a
   two-entry allowlist — the gate itself (`src/lib/centerPermissions.ts`) and the one request route
   (`src/app/api/referrals/payout/route.ts`). *Reaching the authority at all* outside the reviewed set
   is the signal, whatever string the call uses. This catches at review time what the `intent` argument
   catches at runtime, which is earlier and cheaper. The allowlist is asserted non-empty so it cannot
   rot into a no-op.

The one call site states its intent explicitly: `requireMoneyRequestPermission(auth,
'can_request_referral_payouts', 'request')`. No real caller changed behaviour.

**Blast radius, stated plainly: the `assertNotReleaseAuthority` throw sits at the top of the *shared*
`hasPermission`, so it is on the path of six other routes, not just the payout route.** Those routes are
`/api/academic`, `/api/orders/[orderId]/reorder`, `/api/paymob/create-payment-key`,
`/api/settings/billing`, `/api/card-order-cart/checkout` and `/api/centers/me`. If any of them ever
passed a request-only permission they would get an **uncaught throw — a 500 — instead of a 403**. None
can today: verified by grep that they pass only `can_manage_academic_calendar`, `can_place_card_orders`,
`can_manage_billing` and `can_edit_center_profile`, none of which is in
`REQUEST_ONLY_MONEY_PERMISSIONS`. The change can only ever deny, never grant, so the direction is safe —
but "the withdrawal route was not touched" understates the surface, and anyone adding a permission to
`REQUEST_ONLY_MONEY_PERMISSIONS` later must check these six call sites before doing so. (Client-side
`hasPermission` in `UserContext` is a different, single-argument helper and is unaffected.)

> ### ⚠ OPEN FOR EYAD — which gate survives the unification, and does the permission survive at all
>
> Decision 1's recorded answer is *"unify, on owner-only + step-up auth"*. The unification is **unbuilt**,
> so the gate choice is still live at build time and is recorded here as an explicit item rather than left
> as an implementation detail (which is exactly the failure A15 describes). Nothing above pre-empts it:
> the landed change keeps two pipelines and only removes access from the weaker one.
>
> | option | what it means | evidence for | evidence against |
> |---|---|---|---|
> | **(A) Owner-only, retire the permission** | one gate, `role = 'owner'` + step-up; drop `can_request_referral_payouts` from the staff-permissions UI and eventually from `public.users` | **0 non-owner accounts hold it today**, so retirement is a no-op for every real centre; removes a `public.users` money-adjacent flag entirely, which is the same direction §7.1 forces for the release side; one gate, one control surface | a centre with an office manager who does the paperwork must hand out the owner login — a real operational cost that shows up the first time a centre has >1 staff member |
> | **(B) Owner-only, keep the permission dormant** | ← **what is in the tree now**, extended to the unified route | preserves the delegation shape for later without granting anything today; zero migration | a dormant flag in the staff UI implies a capability that the unified route would refuse — a support ticket waiting to happen unless the UI hides it |
> | **(C) Owner OR delegate, on the unified route** | the delegable arm survives and is extended to credit withdrawals | one consistent rule across both money types; the delegation is genuinely useful for larger centres | **this is the A15 widening.** Every centre whose credit withdrawals are owner-only today silently gains a non-owner path. It is invisible in the data precisely because no delegate exists to make it visible |
>
> **Recommendation: (A), and the live evidence strengthens it rather than merely permitting it.** The spec
> already recommended owner-only plus step-up auth; the argument was risk-symmetry. The catalog now adds a
> cost argument: the delegation **has never been used by a non-owner account**, so its entire present value
> is optionality, and its cost is a money-adjacent boolean on `public.users` — the same table §7.1 rules out
> for release authority, for a reason (`PATCH /api/settings/staff/[userId]/permissions` is owner-gated with
> **no self-target check**, and `chq_prevent_user_escalation` fires on zero real grant paths because its
> body is gated on `IF NEW.id = auth.uid()`, which is NULL under a service-role connection). Keeping a
> money flag there costs a permanent exception to an invariant we are otherwise enforcing.
>
> **The one argument against (A) that is not weak** is the office-manager case, and it should be answered
> deliberately rather than dismissed: if delegated *requesting* is wanted later, it belongs on the same
> footing as delegated approval — an explicit, named, revocable grant with an audit trail — not a boolean
> on the payee's own user row. That is a decision to take when a centre actually asks for it, on evidence,
> and (A) does not foreclose it.
>
> **Not in scope for this decision, and already settled:** `can_request_referral_payouts` is request-only
> under every option. None of (A)/(B)/(C) may authorise approval or release.
>
> **If (C) is chosen anyway, it is not free.** It needs, at minimum: an announcement to existing centres
> before the semantics change, a default of `false` on every existing row (already true), and the same
> step-up auth the owner arm gets — otherwise the weaker arm becomes the attack surface for both money
> types at once.

**✅ DECISION 2 — ANSWERED: yes, all seven.** Confirm all seven are in scope as prerequisites. If any is deferred, say which — each one
independently can pay real money twice or strand it.

## 3. The ledger (spec item 1)

**Recommendation: an append-only, double-entry ledger.** This codebase has no double-entry pattern
anywhere — every balance today is either a mutable column (`centers.credit_balance`) or a running
aggregate recomputed on read (`getStudentBalances`). Both are wrong here, for one specific reason: **a
running aggregate silently changes when a historical row is amended.** For a display balance that is
tolerable. For a figure that authorises money leaving a bank account, it means the number you approved
and the number you paid can differ with no trace.

```
ledger_accounts        -- one row per (center_id, account_kind)
  id, center_id, kind, currency, created_at
  kind ∈ (referral_earnings, credit_balance, payable, paid_out,
          reserve_withheld, clawback_receivable, paymob_budget,
          platform_bank_instapay, payout_fees)

ledger_transactions    -- the journal; append-only, never UPDATEd, never DELETEd
  id, occurred_at timestamptz, cairo_date date GENERATED ALWAYS AS
      ((occurred_at AT TIME ZONE 'Africa/Cairo')::date) STORED,
  kind, center_id, payout_id nullable, reverses_id nullable,
  idempotency_key text UNIQUE NOT NULL, actor, reason_key, metadata jsonb

ledger_entries         -- the postings; every transaction's entries sum to zero
  id, transaction_id, account_id, amount_minor bigint, created_at
  -- amounts in PIASTRES (integer). Never floats. Never EGP decimals.

center_payouts         -- one row per payout attempt
  id, center_id, status, gross_minor, fee_minor, vat_minor, net_minor,
  rail ∈ (paymob_payouts, manual_instapay),
  -- IMMUTABLE DESTINATION SNAPSHOT, written at approval, UPDATE-blocked by trigger:
  snap_issuer, snap_msisdn, snap_bank_code, snap_account_or_iban, snap_full_name,
  client_reference_id uuid UNIQUE, client_reference text UNIQUE,
  provider_transaction_id text UNIQUE nullable,
  requested_at, approved_by, approved_at, submitted_at, settled_at

payout_provider_events -- raw Paymob callbacks and inquiry results, append-only
  id, source, raw_body jsonb, received_at, matched_payout_id nullable,
  processing_error nullable
```

**Payout lifecycle states.** The four you named are not enough — three more are load-bearing:

| state | money reality |
|---|---|
| `requested` | center asked; funds **held** (a `payout_hold` posting), not sent |
| `approved` | a human authorised it; destination snapshotted; still not sent |
| `submitting` | `/disburse/` call in flight — **the dangerous state** |
| `indeterminate` | **new, essential.** Call timed out or errored; we do **not** know if Paymob accepted it. Never auto-retried. |
| `settled` | Paymob *inquiry* (not a callback) confirms the money moved |
| `settled_pending_bank` | **new.** Bank Card code `8222` — *"Successful with warning, a transfer will take place once authorized by the receiver bank."* Not terminal; stays in inquiry rotation |
| `failed` | terminal per inquiry; hold released |
| `returned` | **new.** Money came back after apparent success (codes `000100/000102/000105/000108`) |
| `reversing` | a clawback is in progress against this payout |

**Non-negotiable invariants:**

1. **Every posting is in piastres, as an integer.** No floats anywhere in the money path.
2. **`ledger_transactions` and `ledger_entries` are never in `/api/db`'s `TABLE_SCOPE`.** Neither is
   `center_payouts`. A `BEFORE UPDATE OR DELETE` guard trigger on `center_payouts` blocks any change to
   amounts, status, references or destination, mirroring the existing `guard_transactions_lifecycle`
   precedent, with the only bypass being the transition RPC's transaction-local flag.
3. **`UNIQUE INDEX one_open_payout_per_center ON center_payouts(center_id) WHERE status IN
   ('requested','approved','submitting','submitted','indeterminate','reversing')`.** Without this, two
   concurrent requests each read the same available balance and both pass. See attack **A3**.
4. **The balance read and the hold insert are one transaction, serialized per center** —
   `pg_advisory_xact_lock(hashtext('payout:'||center_id))`, mirroring the `FOR UPDATE` that
   `reserve_credits_atomic` already takes.
5. **The counter-account is derived from `center_payouts.rail` inside the transition RPC, never passed by
   the caller.** `paymob_budget` for `paymob_payouts`; `platform_bank_instapay` for `manual_instapay`.
   Manual settlements require a NOT NULL bank reference. Without this, every hand-sent InstaPay silently
   under-reports the Paymob float — see attack **A6**.

**✅ DECISION 3 — ANSWERED: append-only double-entry, this subsystem only.** Append-only double-entry, or extend the existing mutable-column pattern? The alternative
is genuinely cheaper to build and consistent with the rest of the codebase; it is also how the current
withdrawal bug (§2.2) became possible. I recommend double-entry **for this subsystem only** — not a
migration of the whole product.

**✅ DECISION 4 — ANSWERED: option (a), migrate the credit-spend path in the same PR.** During transition, `centers.credit_balance` and the new ledger would both be authoritative
over the same credits. `billingEngine.ts` still calls `spend_credits_atomic` (:244) and
`earn_credits_atomic` (:261), neither of which can see the ledger. **This dual-authority window can pay the
same credits out twice** — see attack **A5**. Pick one: (a) migrate the credit-spend path in the same PR,
or (b) keep credits on the old rail and have the ledger reserve via `reserve_credits_atomic` so the
`FOR UPDATE` on `centers` still serializes both consumers. **No third option is safe.**

## 4. "Available now" and the clearing delay (spec item 2)

For System 1, "available now" is **not** a claim about money the platform is holding for a center. It is
the settled balance of an obligation the platform has accrued. That distinction should be visible in the
copy — the design's "Available now" over a big number reads as custody, and for referral commission it
isn't custody, it's a debt.

```
available_minor(center) =
    SUM(entries on the center's payable account)
  − SUM(open holds)
  − SUM(reserve_withheld)
  − SUM(clawback_receivable)
```

**Does System 1 need a clearing delay? Largely no — and that is the useful answer.** A clearing delay
exists to cover money that can be pulled back after you've paid it out. Referral commission is accrued from
a *subscription payment another center already made to TutoringHQ* — by the time it accrues, the risk
window on that payment has already run. Credits are internal scrip. Neither carries the card-chargeback
exposure that motivates a hold.

Two real exceptions:

- **Referral commission accrued from a subscription that is later refunded or charged back.** Rare, but
  it is the one case where money can reverse after accrual. Handled in §5, not by a blanket delay.
- **Accrual correctness.** A commission row written by the monthly cron could be wrong. A short hold buys
  time to notice.

**Recommendation: `clearing_days = 0` for credits, and a short configurable hold (suggest 7 days) on newly
accrued referral commission**, on the grounds of accrual correctness rather than settlement risk.

**Critical implementation note.** Clearing must attach to the **origin** of the money, not to the sign of
the ledger entry. If a payout is returned by the bank, the restoring `+` entry must inherit the
`cleared_at` of the transaction it reverses — otherwise the center's own returned money is invisible for
another 7 days and can miss the quarterly window entirely. See attack **A8**.

**✅ DECISION 5 — ANSWERED: 0 days credits / 7 days referral, config-driven.** Confirm 0 days for credits and 7 for referral, or set your own numbers. Note that
lowering the number later releases every held entry for every center **simultaneously** — a step-change in
payable liability against a fixed Paymob float, which is its own incident.

## 5. Refund or clawback after a payout has gone out (spec item 4)

**The controlling fact: outbound payouts in Egypt are irrevocable.** Across Paymob's entire Payouts
product there is exactly one cancel capability — an **undocumented** `POST /api/secure/transaction/aman/cancel/`
found only in the live Swagger, for Aman kiosk cash pickup. **There is no recall for wallets, bank card, or
instant bank.** Once sent, it is gone.

**Therefore the control must be preventative, not corrective.** Any design that assumes "we'll claw it
back" is assuming a capability that does not exist on the rail.

Mechanisms, in the order I'd apply them:

1. **Prevent** — the clearing hold in §4 exists precisely so the common case never becomes a clawback.
2. **Net against future earnings** — a `clawback_receivable` posting reduces future `available_now`. Costs
   nothing, works silently, and is what Stripe Connect does (negative balance carried forward).
3. **Block further payouts** while `clawback_receivable > 0`.
4. **Invoice the center** — falls back to the existing subscription-invoice rail, which already has
   dunning and suspension behind it. This is the only mechanism with real teeth.
5. **Write off** — an explicit, named, audited decision, never an automatic one.

**The case that has no clean answer, stated plainly:** the center's balance is zero, they have no upcoming
earnings, and they stop using the product. Options 2 and 3 do nothing. Option 4 works only while they still
care about their subscription. **The honest position is that some clawbacks will be written off**, and the
clearing hold in §4 is what keeps that number small. Every marketplace hits this; the spec should not
pretend otherwise.

**What the center sees matters as much as the mechanism.** A negative balance appearing unexplained is how
a support crisis starts. Every clawback posting carries a `reason_key` rendered bilingually, with the
originating event linked.

**✅ DECISION 6 — ANSWERED: ladder confirmed (net → block → invoice → write off); invoice threshold still to be set.** Confirm the ladder, and set the threshold above which
a clawback goes to invoice rather than sitting as a receivable.

## 6. When a payout fails partway through Paymob's side (spec item 5)

Paymob provides **no idempotency key of any kind**. This was verified exhaustively — a grep for
`idempot|duplicate|unique|retry|replay|timeout` across all 12 portal pages, all 29 GitBook pages, the live
`swagger.json` and the official Postman collection returned **zero idempotency guarantees**. The docs are
explicit that `client_reference_id` is *"generated UUID by the client to be saved as reference in case of
timeouts"* — **a reconciliation aid, not a dedup key.** A retried `/disburse/` call is accepted and
processed as an entirely independent transaction with a fresh `transaction_id`.

**Everything below follows from that one fact.**

| failure | state | policy |
|---|---|---|
| **(a) `/disburse/` times out** | `indeterminate` | **Never auto-retry.** Inquire by reference. Resend only on *positive* evidence of absence — see below. |
| **(b) Accepted, then callback says failed** | stays until **inquiry** confirms | Callbacks are advisory only. Do not move state on a callback. |
| **(c) Callback never arrives** | unchanged | The reconciliation sweep is the primary mechanism; callbacks are an optimisation. Wallets fire **no callbacks at all**. |
| **(d) Budget insufficient mid-batch** | halt the run | Detect **structurally**, not by prose — see below. |
| **(e) Terminal vs retryable code** | `indeterminate` on anything unrecognised | The docs **never classify** terminal vs retryable. Anywhere. |
| **(f) Crash between `submitting` and result** | `indeterminate` | Same as (a). |

**Three rules that prevent the specific double-pays found in review:**

1. **A callback may only enqueue an inquiry job.** It may never write a ledger entry, never call the
   transition RPC, never move a payout state. Enforce this *structurally* — give the callback handler a DB
   role with `INSERT` on `payout_provider_events` and no rights on the ledger or payout tables. **HMAC is
   off by default** and must be requested from the account manager by email; the payout HMAC algorithm,
   field order and transport are **undocumented**. Until it's on and verified, an unauthenticated public
   POST can otherwise fabricate a "failed" callback for a payout that succeeded and get the balance
   credited back. See attack **A1**.
2. **Resend requires positive evidence, not absence of evidence.** A resend is permitted only when a
   successful HTTP 200 inquiry for that specific reference completed recently and returned **zero matches**
   — and, because the inquiry endpoint's `bank_transactions` flag selects between two different stores and
   `bank_wallet` is classified **both ways across Paymob's own docs**, the sweeper must query with the flag
   **both true and false** and only conclude "not found" when both return zero. See attack **A4**.
3. **Never let an unrecognised response be terminal.** Default every unmatched `status_code` to
   `indeterminate` and escalate. In particular, insufficient-budget is an HTTP **200** with
   `status_code: "400"`, distinguishable from a generic validation error **only by substring-matching
   English prose** that contains a typo (*"exceeds you budget limit"*). If Paymob fixes the typo, a
   prose-matching implementation silently marks a whole batch permanently failed. Detect budget exhaustion
   by reading `/budget/inquire/` before the run and decrementing a local projection. See attack **A7**.

**The reconciliation job is not optional.** It sweeps `indeterminate` and non-terminal rows, inquires by
reference, and repairs state. Inquiry endpoints are throttled to **5 requests/minute, 50 objects/page** —
shared across transaction and budget inquiry — so it needs a global token bucket (Upstash is already a
dependency) and must pack pages to the limit.

## 7. Approval (spec item 6)

> ### ✅ DECIDED — 3 August 2026, Eyad · **REVISED same day. This supersedes the earlier "no delegation" answer.**
>
> **Delegated approval with a cap:**
> - **CEO can approve any amount, always final, no second approver ever.**
> - **CEO can optionally grant a manager permission to approve payouts under 10,000 EGP.** Off by
>   default; the CEO enables it explicitly per person.
> - **A manager cannot approve at or above the cap. No override, no exception.**
> - **The permission is CEO-grantable and CEO-revocable only.**
> - **Every payout is logged immutably** regardless of amount or approver: who approved, exact amount,
>   destination, timestamp, CEO-or-delegated, and outcome. Append-only, never editable, never deletable,
>   including by the CEO.
> - **The cap is config-driven and CEO-changeable.**
>
> **What this supersedes.** The earlier answer — *"no maker–checker, no threshold, no second approver at
> any amount"* — is withdrawn in part. *"No second approver ever"* survives intact: approval is still
> single-signature, and nothing here reintroduces maker–checker. What changes is that approval authority
> is no longer CEO-exclusive; it is CEO-plus-optionally-delegated-under-a-cap.

### 7.1 — Where the approve permission must live (answering the question raised with the revision)

> **✅ DECIDED — 3 August, Eyad.** A **separate permission: `can_approve_payouts`**, new and distinct from
> `can_request_referral_payouts`. Decision 1 keeps request and release apart and this must not collapse
> them.
>
> **Reading this against §7.1's invariant — they are compatible, and the implementer must not resolve the
> ambiguity the wrong way.** `can_*` is the naming convention of `public.users` *columns*, but nothing
> requires the permission to be one. The compatible shape is a **permission key** — `permission =
> 'can_approve_payouts'` — on a row in the platform-side `permissions` table, which is already FK'd to
> `admin_users`, already CEO/admin-team-gated, and already soft-revokes via `enabled = false` while
> preserving `created_at`. That satisfies the decided name *and* the disjoint-domain invariant.
>
> **⚠ Do not add a `can_approve_payouts` column to `public.users`.** If it lands there, the self-grant
> hole below applies in full: the center owner — the payee — grants it to themselves in one request.
> The name was decided; the table was not, and the two are not the same question.

**It must be a separate permission, and — more strongly — it must not live on `public.users` at all.**

Decision 1 kept *request* and *release* apart. Reusing `can_request_referral_payouts` for approval would
collapse them and reintroduce self-approval. But verification found a sharper reason, and it is decisive:

**`PATCH /api/settings/staff/[userId]/permissions` is gated only on `auth.role === 'owner'` and has no
self-target check.** `auth.userId` appears twice in that file, both times inside the `audit_log` insert,
never as a guard. It writes all eight `CenterPermission` columns — including
`can_request_referral_payouts`. So **any `can_approve_*` column added to `public.users` is self-grantable
by the center owner — who is the payee.** The payee would be granting themselves release authority over
their own money, in one request, with the CEO never in the loop. Unbounded in sub-cap increments.

**Therefore, as a spec invariant:** the **approver identity domain (`admin_users`) and the payee identity
domain (`public.users`) are disjoint by construction.** No `public.users` row may ever hold payout
approval authority. This is the natural extension of Decision 1 rather than a departure from it —
*request authority is center-side, release authority is platform-side, and they live in different tables
so that no single grant path can produce both.*

Two further reasons the boolean-permission shape is wrong here, both verified:

- **`hasPermission` cannot express a cap.** Its body is `if (isSuperAdmin) return true; if (role ===
  'owner') return true; return permissions[p] === true`. No amount parameter, no deny path. Reused as-is,
  the cap would be absent for exactly the two actors who most need bounding and enforced for nobody.
- **A new `can_*` column inherits zero protection.** The live `chq_prevent_user_escalation` trigger guards
  six columns (2 of the 17 `can_*` columns), and its whole body is gated on `IF NEW.id = auth.uid()` —
  which under a service-role connection evaluates to **NULL, not false**, so the `IF` is skipped and the
  trigger fires on **zero real grant paths**. `USERS_PROTECTED_COLUMNS` is a hardcoded 10-entry deny-list
  in a third file. The only control actually holding is the table-level `UPDATE` revoke from
  `authenticated` — which nobody designed as a payout defence.

**Recommended shape:** approval authority is a row in the platform-side `permissions` table (already
FK'd to `admin_users`, already CEO/admin-team-gated, already soft-revoked via `enabled=false` preserving
`created_at`), and the decision itself is made inside a `SECURITY DEFINER` RPC that is the **sole writer
of approval state** — reading the amount from the locked payout row rather than from a parameter,
resolving the actor's tier server-side, reading the cap in-transaction, failing closed, and writing the
log in the same transaction. `REVOKE ALL FROM anon, authenticated`; grant `service_role` only.

### 7.2 — What the cap must actually say, because as written it bounds one row and not one manager

> **✅ DECIDED — 3 August, Eyad.** Manager approval is capped at **10,000 EGP per payout**. A payout above
> the cap **goes to the CEO** — it is not split. **The check runs on the requested amount, not the released
> amount.** No splitting into smaller payouts to evade the cap.
>
> **This closes the worst of the ambiguities below and leaves one open.**
>
> **Closed — "the amount" is now defined.** Checking the *requested* figure resolves the four-to-five-way
> ambiguity in the second bullet below, and resolves it the **safe** way. The permissive reading was
> `net_minor` ("what the center receives"), which would let a gross of 10,546.31 through a 10,000 cap.
> Requested amount is the gross the center asked for, so nothing above 10,000 leaves on a delegated
> approval. Record it explicitly as: **the cap is compared against the requested gross, before any fee,
> VAT or credit-conversion arithmetic**, and store the compared figure in the log as
> `amount_compared_minor`. The piastres/EGP unit hazard still applies and the config key must name its
> unit.
>
> **✅ ANTI-SPLITTING — DECIDED 3 August, Eyad. Two checks, both enforced, either one exceeded sends the
> payout to the CEO:**
> 1. **10,000 EGP per payout** (on the requested gross, as above).
> 2. **10,000 EGP total per center per rolling 7 days.**
>
> The second closes the sequential-splitting hole: a center owed 30,000 can no longer be paid via
> 9,999 × 3, because the second and third approvals fall inside the window and the running total exceeds
> the cap. Both checks run inside the same `SECURITY DEFINER` RPC, in-transaction, against the immutable
> log.
>
> **Implementation notes, each of which is a way to get this wrong:**
> - **"Rolling 7 days" means a moving window, not a calendar week.** Compute it as
>   `approved_at > now() - interval '7 days'`, not `date_trunc('week', ...)` — a calendar week resets at a
>   known instant and hands back a fresh 10,000 every Monday, which is the same splitting hole with a
>   longer period. Cairo-time boundaries are irrelevant here for the same reason: the window is relative
>   to each approval, not to a day boundary.
> - **The window sums approvals, not settlements.** A payout that was approved and later failed or was
>   returned still consumed window capacity at approval time. Whether a failed payout should release its
>   window slot is a real question and the safe default is **no** — otherwise a manager can approve,
>   induce a failure, and re-approve. *Recorded as the safe default; say so if you want the opposite.*
> - **The check must include the payout being approved**, i.e. `SUM(existing in window) + this_amount >
>   cap → deny`, not `SUM(existing) > cap`. The off-by-one here permits 19,999.
> - **Concurrency:** both checks must be evaluated under the same per-center advisory lock as the balance
>   read (§3 invariant 4), or two simultaneous approvals each see a pre-approval total and both pass.
>
> **One residual, recorded not reopened.** Both caps are scoped **per center**, so they bound each
> relationship but not the delegate's aggregate: a manager may approve 10,000 for center A, 10,000 for
> center B, and so on. With 10 active centers that is 100,000 EGP per 7 days across the estate, all
> compliant. That is a defensible position — splitting is a per-center behaviour and the per-center cap
> is what addresses it — but the delegate's total exposure is bounded by *center count*, not by the cap.
> If a per-approver ceiling is ever wanted, it is a third check of the same shape and costs nothing extra
> to add later.
>
> The `settled_pending_bank` and resend gaps below are **not** closed by this decision and remain
> live: both let money move without a fresh capped approval.

**The original analysis, retained as the record of what the decision was made against.** Read it as the
argument, not the requirement — the decided rule is the box above. Two of its five "therefores" are now
satisfied (the amount definition, and a per-center window cap); three are not, and remain live build
requirements: the `settled_pending_bank` gap, the terminal-state enumeration, and resends.

**The stated rule caps a single payout. It does not cap the approver.** Verified evasions, each requiring
no bug and no rule violation:

- **Splitting.** Center owed 30,000. Four sub-cap approvals — 9,999 · 9,999 · 9,999 · 3 — and it is out.
  Every one individually compliant; the immutable log faithfully records four lawful approvals. Across
  ten centers in one sitting: **99,990 EGP in an afternoon**, since `one_open_payout_per_center` is
  per-center.
- **`settled_pending_bank` is missing from the open-payout index.** That state means *the bank has not
  moved this money yet and we are still asking* — yet the concurrency guard treats it as closed, so the
  slot frees while funds are in flight. Four Bank Card approvals in fifteen minutes = 39,996 EGP. If the
  §4 hold keys off the same set, it also **releases the hold**, so `available_now` returns to full and
  the same obligation can be requested again — a double-pay, not merely a cap evasion.
- **A resend is not an approval, so it is not capped.** §6 permits resend of an `indeterminate` payout.
  One 9,999 approval plus one resend = 19,998 out, with the cap never consulted on the second.
- **"The amount" is four to five different numbers** — `gross_minor`, `net_minor`, `fee_minor`,
  `vat_minor`, and on the credit rail `credits_deducted` vs `cash_amount`, which differ by exactly 2×.
  The most natural reading, *"the amount the center receives"* (`net_minor`), is the **permissive** one:
  capping net at 9,999.99 permits a gross of 10,546.31 on the referral fee formula. **More than 10,000
  EGP leaves the account on one compliant manager approval** — the sentence is false as written.
- **Piastres vs EGP.** The ledger stores `amount_minor` in piastres; every legacy table and Paymob itself
  speak EGP decimals. A cap written as `10000` compared on the wrong side of the conversion is either
  100 EGP or 1,000,000 EGP. Pin the unit in the config key name.

**Therefore the cap must be specified as:**
1. **A rolling aggregate per approver**, not per payout — daily and monthly, evaluated in-transaction over
   the immutable log, scoped to *that approver* (a global cap cannot distinguish CEO from delegate).
2. **Plus a per-center-per-window cap**, and an explicit anti-splitting rule: N approvals to the same
   center inside a window hard-blocks.
3. **Compared against `GREATEST(gross_minor, net_minor + fee_minor + vat_minor)`** — the larger of the
   liability extinguished and the float debited — with the compared figure stored in the log as
   `amount_compared_minor` beside its components, so the record shows what the check actually looked at.
4. **Terminal states enumerated, not open ones.** Define "a payout blocks until it is *terminal*" with
   terminal = `{settled, failed, returned}`, so a state added later defaults to blocking.
5. **Resends routed through the identical RPC** and subject to the same caps — and a **delegated approver
   may never authorize a resend**, at any amount. That decision requires reading ambiguous provider
   evidence against an irrevocable rail with no idempotency key. CEO-only.

### 7.3 — Three things the revision assumes that are not true today

1. **"CEO-grantable and CEO-revocable only" is not enforceable as things stand** — see 7.1. It becomes
   enforceable only once approval authority leaves `public.users`.
2. **Revocation does not reach an already-approved payout.** `approved` and `submitting` are distinct
   states with a gap the spec says may be days wide, and nothing re-checks authority at release. A
   manager approves eight payouts across eight centers at 9,500 each; the CEO revokes two hours later
   believing the exposure is closed; the release job pays all **76,000 EGP** two days on. *Fix:* re-evaluate
   authority and cap at **every transition that can still move money**, and make revocation a transaction
   that sweeps that actor's approved-but-unsubmitted payouts back to `requested` and logs the sweep.
3. **The cap is changeable through a route with no CSRF, no audit row, and no `updated_by`.**
   `PATCH /api/admin/platform-config` contains zero `validateCSRFRequest` calls and writes no audit
   record; `platform_config.updated_by` exists but is written by exactly one other route. So *"the cap
   was 10,000 at the time of approval"* is **unprovable after the fact**. Raise it to clear one large
   payout, forget to lower it, and six 95,000 approvals are all lawful and unattributable. *Fix:* cap
   changes are themselves append-only log events, and the **cap in force is snapshotted onto each
   approval row** rather than read back later.

### 7.4 — On "never deletable, including by the CEO": this cannot be delivered as stated

Reported plainly rather than recorded as met.

The CEO holds the Supabase dashboard, and therefore the `postgres` role. **Nothing that runs inside
Postgres can stop the owner of Postgres.** Verified: guard triggers work against `service_role` but are
defeated by `TRUNCATE` (row triggers do not fire, and TRUNCATE is currently granted and unblocked), by
dropping the trigger, or by re-granting privileges. **RLS is irrelevant here** — `service_role` and
`postgres` both carry `rolbypassrls = true`, and `FORCE ROW LEVEL SECURITY` is off. Event triggers that
could block a `DROP TRIGGER` require superuser, which Supabase does not grant.

Three further facts about the log path as it exists today, all worse than the storage question:

- **Audit writes fail silently and invisibly.** The dominant pattern across 33 call sites is
  `try { await supabaseAdmin.from('audit_log').insert(...) } catch { /* ignore */ }` — and supabase-js
  **returns** `{error}` rather than throwing, so the `catch` never fires and the failure is dropped
  without even being logged. An approval could pay with no log row and no alert.
- **`created_at` is caller-supplied** on at least one live writer, with no `BEFORE INSERT` trigger, so
  rows can be backdated today.
- **`auditLog()` is client-side and takes `action`/`details` from the caller** — the browser decides what
  gets recorded. Unusable as approval evidence.

**What is achievable is tamper-evident, not tamper-proof:** a hash chain (pgcrypto is installed) makes
silent *edits* detectable, but proves nothing while its head lives in the same database it protects. The
property only becomes real when the chain head is published on a cadence to a sink in a **different trust
domain whose credentials the CEO does not hold**. That is an organisational decision, not an engineering
one, and it is the only thing that makes the word "never" true.

> **✅ DECIDED — 3 August, Eyad. The chain head goes to an external sink. The CEO holds that credential,
> nobody else, and it is not stored anywhere the application can reach.**
>
> This is the answer that makes the guarantee real rather than aspirational, and it is the correct trust
> model: a credential the application could reach is a credential an application compromise reaches too,
> which would defeat the entire point.
>
> **It has one consequence that must be designed for, not discovered.** If the application cannot reach
> the sink, **the application cannot publish the chain head.** Publication is therefore an out-of-band act
> performed by the CEO — and that makes **the publication cadence the tamper-detection window.** Tampering
> between two publications is undetectable; tampering before the first publication is invisible forever.
> Three things follow:
> - **The cadence is a security parameter, not an operational preference.** Weekly publication means a
>   one-week detection window. Pick it deliberately.
> - **A missed publication silently widens the window**, and nothing inside the system can alert on it —
>   the system cannot see the sink. This is structurally the §2.1 failure shape: a control that lapses
>   quietly because the thing that would notice is the thing that stopped. The mitigation is a reminder
>   the CEO receives out-of-band, not an in-app alert.
> - **What is published should be only `seq` + `row_hash`** — no amounts, no destinations, no PII — so the
>   sink carries no data worth stealing and its exposure is limited to proving the chain.
>
> With this, the honest claim the spec can make is: **the log is tamper-evident, with a detection window
> equal to the publication interval, provided the CEO publishes on schedule.** That is materially stronger
> than "tamper-evident within the platform" and it is achievable. It is still not "impossible to alter" —
> nothing is, against the owner of the database — and the spec should not say otherwise.

**Non-negotiable regardless:** the payout log write must be **in the same transaction as the payout state
change**, so that if the log fails, the payout fails. It must be server-side only, deriving amount,
approver and destination from server state, never from the request body.

### 7.5 — Consequences that survive the revision

1. **The automated controls are still the only defence.** Single-signature approval means nothing sits
   between a wrong number and money leaving except the caps and anomaly checks below. **Every control in
   the list below is required, not recommended**, and the anomaly check must *block* with an audited
   override rather than "force manual review" — manual review is already the only mode.
2. **Delegation narrows the CEO-availability gap but does not close it.** Payouts at or above the cap
   still stop dead if the CEO is unavailable.

   > **✅ CEO UNAVAILABILITY — DECIDED 3 August, Eyad: payouts wait. No fallback approver, at any
   > amount, for any duration.**
   >
   > This is the right answer and it is the *only* one consistent with D8, because a fallback approver
   > is a second approver with extra steps. Recording what it commits to:
   > - **An above-cap payout has exactly one path to release, ever.** No break-glass, no time-based
   >   escalation, no "auto-approve after N days". A queue that grows during an absence is the intended
   >   behaviour, not a defect to engineer around later.
   > - **The system must therefore never let an unpaid queue look like a paid one.** Requests must age
   >   visibly — `requested_at` surfaced on the center's own view with an honest "awaiting approval"
   >   state, no ETA the platform cannot honour. The failure this prevents is a center believing its
   >   money was sent because the UI went quiet.
   > - **No expiry on a pending request.** Auto-cancelling an aged request would silently convert
   >   "waiting" into "denied" without anyone deciding it, which is the §2.1 shape again.
   >
   > **The one thing this decision does not survive on its own** is the ungoverned path that exists
   > today. Appending a phone to `SUPER_ADMIN_PHONES` mints a CEO with **no database row at all**, and
   > the supposedly independent second check (`requireSuperAdminRow`, `admin-access.ts:136`) calls
   > `isSuperAdminPhone` too — so both gates read the same env var. `admin-auth.ts` returns a session on
   > `adminRow || adminByPhone`; the phone alone suffices. That path is forensically anonymous: the log
   > would record an approver uuid matching no row in any table. `SUPER_ADMIN_PHONES` is also absent
   > from `scripts/check-env.ts`, so nothing warns when it is set, changed, or wrong.
   >
   > **Decided alongside:** every super-admin must have a real database row. **Payout approval must
   > require a real `admin_users.role='super_admin'` row and must not accept env-phone alone**, and the
   > log must record the authority source (`db_row` | `env_phone`) as a NOT NULL column so the
   > distinction is provable after the fact rather than inferred. Logged as **S10** in
   > `BUILD-AFTER-REDESIGN.md` — it is a hole in the existing admin surface, not only in this feature,
   > so it is tracked there and not only here.
3. **Decisions 7 and 8 govern different axes.** D7's "hybrid later" is *automatic vs. manual*; D8 is
   *who may approve, and up to what*. A future auto-release threshold does not reopen D8.

**The original recommendation, superseded, retained as the record:**

~~Recommendation: maker–checker for every payout above a threshold; nothing fully automatic in v1.~~

Two arguments carried it. First, **Paymob's own Payouts dashboard implements maker–checker with a PIN** —
the provider treating this operation as warranting two humans is a strong signal. Second, the failure modes
in §6 are all *silent*: an over-payment does not throw, it succeeds twice.

| option | when it fits | cost |
|---|---|---|
| Fully automatic on a schedule | high volume, low value, mature reconciliation | a bug pays out 100× with nobody in the loop |
| Auto below threshold, manual above | possible after v1 proves stable (per D7) | needs a trustworthy threshold |
| Always manual, single approver (CEO only) | superseded by the revision | an unstaffed queue silently stops all payouts; no second pair of eyes |
| **Always manual, CEO + capped delegate** | **← CHOSEN for v1 (revised)** | narrows the availability gap, but the cap must bound the *approver* and not the *payout* — see §7.2 |
| Maker–checker (two distinct admins) | highest value | slowest; needs two available admins |

**Controls — all now required, not optional (see consequence 1):**

- Per-payout maximum, per-run maximum, and a **daily aggregate cap**.
- An anomaly check: this payout is N× the center's trailing average → **hard block, with an explicit
  audited override.** ("Force manual review" is meaningless now that every payout is manually reviewed.)
- A **kill switch** that halts all releases, reachable without a deploy.
- **Step-up auth on approval**, reusing `verifyPasswordForSensitiveAction` — the mechanism already exists
  and is already used for permission edits. Do not invent a new one.
- Every state transition writes `audit_log` **inside the same transaction** as the state change, not
  fire-and-forget.
- **The approval queue needs a staffing answer, not just a screen.** An approval queue nobody watches is
  how payouts silently stop for a quarter — and §2.1 shows this project has already shipped exactly that
  failure once.

**✅ DECISION 7 — ANSWERED.** Always-manual for v1; hybrid considered later.

**✅ DECISION 8 — ANSWERED, then REVISED 3 August (see the block at the top of §7).** Final form:
**delegated approval with a cap** — CEO approves any amount and is always final with no second approver
ever; the CEO may optionally grant a named manager the right to approve below a config-driven 10,000 EGP
cap; that permission is CEO-grantable and CEO-revocable only; every payout is logged immutably.
*Implementation notes, all load-bearing:* the approver gate must be a real `admin_users.role='super_admin'`
row and **must not accept `SUPER_ADMIN_PHONES` env-phone alone** (§7.5); approval authority must live
outside `public.users` entirely (§7.1); the cap must be a rolling per-approver aggregate, not a
per-payout ceiling (§7.2); and step-up auth via `verifyPasswordForSensitiveAction` stays — single-signature
approval makes confirming the human at the keyboard more important, not less.

## 8. What Paymob integration actually requires (spec item 3)

A readiness checklist. Every fact below is quoted or directly sourced from Paymob documentation.

**Credentials and onboarding.** *"There are no self-signup steps. Your account is provisioned by Paymob."*
The sequence is: account manager → legal agreement → staging credentials by email → integration → test →
Paymob technical approval → production. **This is lead time that runs in parallel with everything else —
start it now.**

- Auth: `POST {ENV}/o/token/`, OAuth2, `grant_type=password`. **Four mandatory credentials**: `client_id`,
  `client_secret`, `username`, `password`.
- Access token lives **3600s**. The refresh token is **one-time-use rotating** — *"will last forever until
  the next use"* — which is a real concurrency hazard: two workers refreshing simultaneously will invalidate
  each other. Token refresh must be centralised and locked.
- Base URLs: staging `stagingpayouts.paymobsolutions.com/api/secure/`, production
  `payouts.paymobsolutions.com/api/secure/`.

**The float.** *"Every disbursement is charged from a pre-funded balance called your budget. No budget, no
disbursements."* The Payouts budget is **separate from the Accept balance**. Top-up is
`POST {ENV}/topup/request/`, `multipart/form-data`, with `type ∈ [from_bank_transfer, from_accept_balance]`.
Approval is **human by default** at Paymob's end, with no published SLA. `GET /budget/inquire/` returns
**prose, not a number**: `{"current_budget": "Your current budget is 888.25 LE"}` — the balance must be
regex-parsed out of an English sentence.

> **⚠ Regulatory warning, carried forward from the Paymob research.** The `from_accept_balance` sweep is
> clean **only** for System 1, where the money being disbursed is the platform's own obligation. If a float
> is ever funded from collections that economically belong to centers, the platform is holding third-party
> funds — which under Egyptian law is **Payment Facilitation Services**, a licensed activity (EGP 10–30m
> paid-up capital, Egyptian joint-stock company, sole-purpose requirement). Egypt has **no commercial-agent
> exemption**; "we're just an agent for the centres" has no safe harbour. This constrains System 2, not
> System 1 — but the same API call is the doorway to both, so the boundary must be explicit in code.

**Recipient KYC — the good news.** Payouts recipients are **anonymous and need no Paymob account**. The
Egypt Post response field is literally `anon_recipient`. **Arbitrary IBANs are payable.** `national_id` is
flagged mandatory in the portal's field table but is absent from every non-Egypt-Post sample, the Postman
collection and the GitBook field lists — GitBook scopes it to Egypt Post only. **Ask Paymob to confirm in
writing.** Name matching is *guidance only*; no document states it is enforced, and a name mismatch
surfaces as a `Returned`.

*(This is the sharpest contrast with Split Amount, which is a different product: recipients are identified
only by connected merchant ID and **must be onboarded Paymob merchants**. Do not conflate them.)*

**Minimums per channel:** mobile wallets **1 EGP**, Bank Card **5 EGP**, Instant Bank **112 EGP**, Egypt
Post **5 EGP**. Recipient-side wallet limits: 60,000 EGP per transaction, 60,000/day, 200,000/month —
*"these limits apply to the recipient's wallet, not your account."*

**Fees: no schedule is published anywhere.** Checked the portal docs, every GitBook payout page, Swagger,
Postman, `paymob.com/en/pricing` and `paymob.com/en/payouts`. Per-transaction `fees` and `vat` come back on
the response; VAT is 14%. **Store what is returned; never compute.** `customer_bears_fees` flips who pays —
and note the asymmetry: on a **returned** transaction with `customer_bears_fees=true`, *"the merchant is
refunded the amount minus fees and VAT (fees are penalty)."*

**What we must build that Paymob does not provide:**
- Idempotency (there is none — §6).
- The reconciliation job and its throttle budget.
- Callback capture that returns 200 unconditionally and parses asynchronously.
- A budget projection and low-float alerting.
- A period-close report (§10).

**Questions to put to Paymob in writing before building:**
1. Is `client_reference` uniqueness server-enforced, and what is returned on collision?
2. Is `national_id` genuinely required for non-Egypt-Post channels?
3. Which store does `bank_wallet` land in for inquiry — `bank_transactions` true or false?
4. What is the payout HMAC algorithm, field order and transport?
5. What is the fee schedule per channel?
6. Is disbursement-capability on the dashboard user disableable? (See attack **A9**.)
7. Bank Card final status — 2 working days or 3? The two doc estates disagree.

## 9. SYSTEM 2 — Tuition settlement payouts (cross-reference only, not specced)

**Cannot be built now.** It depends entirely on **V3 online collection**, which is dormant: the
`digital_student_fee_collection.enabled` flag has no row, `lesson_commission` is all zeros, `payments` has
0 rows, and the `transactions` fee-stack columns (`platform_gross`, `customer_commission_amt`, …) have
**no writer anywhere in `src/` or `supabase/`**.

Designing a ledger for it now would be designing against a switch that isn't wired. When V3 ships, this
section becomes real and will differ from System 1 in four ways that matter:

1. **Custody.** The platform would hold parents' money — the licensing question in §8 becomes live.
2. **A real clearing delay.** Card chargebacks create genuine post-payout exposure; §4's "largely no"
   becomes "yes, and the number matters."
3. **Settlement timing.** Paymob's Accept gateway settles **weekly** per their own Egypt pricing FAQ, so
   clearance must be gated on *confirmed receipt*, not on the capture timestamp — otherwise the platform
   funds payouts from its own working capital. See attack **A10**.
4. **Volume.** System 1 is tens of payouts per quarter. System 2 is per-center, per-cycle, continuously.

**Related open items:** `V3`, `V4`, `V1` in `BUILD-AFTER-REDESIGN.md`; `Merged-Center-Money` §04/§05 and
`Merged-Verification-Payouts` §04/§05 in `FILE-COMPLETION-TABLE.md`; `STATE-OF-THE-BUILD.md` §2.

## 10. Adversarial findings — System 1

Ten agents produced 26 attacks. These are the ones that apply to **System 1 as it would actually ship**.
Each is a concrete sequence, not a general concern.

**A1 · Callback replay drains the platform** — `loses_money`. HMAC is off by default and the callback URL
is a public POST with no event id, signature or timestamp. A center owner can see their own payout's
`transaction_id` on their own detail screen. They POST a fabricated `disbursement_status: "failed"` for a
payout that already settled; the handler credits their balance back; they repeat per historical payout.
**Unbounded, repeatable, no credentials needed beyond their own session.** *Fix:* callbacks may only
enqueue an inquiry job — enforced by DB role, not by convention.

**A2 · Destination swap inside the approve→release gap** — `loses_money`, 48,000 EGP. Approval snapshots a
destination on Jan 3; the owner changes `centers.instapay_number` on Jan 5 via `/api/db` (confirmed
writable — §2.3); release on Jan 7 reads the *live* destination. A 14-day change-cooldown does not catch
it, because the cooldown is evaluated at request time. *Fix:* immutable snapshot columns on
`center_payouts` with an UPDATE-blocking trigger, and abort at release if the live destination differs.

**A3 · Concurrent requests both pass the balance check** — `double_pays`, 10,000 EGP against a 5,000 EGP
obligation. Two submissions 40ms apart each `SELECT SUM` → 5,000 before either commits. Unique constraints
on the *reference* fields don't help — the references genuinely differ. *Fix:* the
`one_open_payout_per_center` partial index plus a per-center advisory lock.

**A4 · Resend authorised on false evidence** — `double_pays`, 50,000 EGP. A `bank_wallet` payout goes
indeterminate; the sweeper inquires with the wrong `bank_transactions` flag (the docs classify
`bank_wallet` **both ways**), gets zero matches three times, and a human — correctly reading the evidence
in front of them — authorises a resend. *Fix:* query both flags; show the operator the exact queries
issued, not a summarised verdict.

**A5 · Credits consumed twice during the dual-authority window** — `loses_money`, 4,000 EGP. The ledger
holds the credits; `centers.credit_balance` is untouched; the monthly billing run spends the same credits
against an invoice via `spend_credits_atomic`; the payout then releases the cash. *Fix:* Decision 4 — no
dual-authority window.

**A6 · Manual InstaPay corrupts the float model** — `strands_money`, 90,000 EGP immobilised. Hand-sent
payouts posted against `paymob_budget` make the modelled balance drift below reality; the low-float alarm
fires and finance tops up money that was never needed. *Fix:* counter-account derived from `rail`.

**A7 · A typo fix at Paymob strands a whole batch** — `strands_money`, ~18,600 EGP for 12 weeks. Budget
exhaustion is detectable only by matching the prose *"exceeds you budget limit"*. Paymob corrects the typo;
the matcher misses; 16 payouts are written terminally failed for a reason that never existed, and the
quarterly window closes. *Fix:* structural budget projection; unrecognised → never terminal.

**A8 · A returned payout is invisible for 7 days** — `strands_money`, 9,000 EGP. The bank returns it; the
restoring `+` entry is treated as newly-arrived money needing to clear; the center sees 0 available until
after the window closes. *Fix:* reversals inherit the `cleared_at` of what they reverse.

**A9 · A dashboard CSV upload pays 40 centers twice** — `loses_money`, 84,000 EGP. An admin clears a
backlog through Paymob's own dashboard bulk upload. Wallets fire no callbacks; **no Paymob endpoint
enumerates disbursements by date**, so our sweep — which only inquires about rows in *our* table — iterates
zero of them. The in-app requests are later approved and paid again. *Fix:* ask Paymob to disable
disbursement on the dashboard user; make the budget delta the completeness tripwire.

**A10 · Clearing from the capture timestamp funds payouts from working capital** — applies to System 2, but
listed because it constrains the shared design: Paymob Accept settles **weekly**, so a 7-day clearing
window computed from capture can release money before it has landed.

**A11 · Reconciliation findings written where nobody reads them** — `reconciliation_drift`, 26,600 EGP
unseen. Verified precedent: `src/lib/billing/reconciliation.ts` writes to `billing_reconciliation_reports`,
and a grep across all of `src/` finds **exactly two references — both writers, zero readers**. The payout
reconciler would inherit that shape. *Fix:* every mismatch must also create a `ceo_action_queue` row (that
queue has a UI) and, above a floor, WhatsApp `CEO_PHONE`. **And ship a reader for the existing dead table
as part of this work** — inheriting a dead pattern validates it.

**A12 · The reconciler is never scheduled and nothing notices** — verified: `vercel.json` schedules 42
crons while `src/app/api/cron` contains **43 route directories**. `renewal-reminders` exists and is
scheduled nowhere, and nobody has noticed. The watchdog only iterates `cron_health_log` rows that already
exist, so a cron that never ran once is invisible to it. *Fix:* seed the health row in the same migration;
assert against a declared registry; add a CI check that every cron directory appears in `vercel.json` —
which also catches the existing gap.

**A14 · CSRF on the route that authorises money to leave** — `loses_money`. `PATCH /api/admin/withdrawals/[id]`
has no CSRF validation and is the gate that marks a withdrawal paid. An admin with a live session who loads
any page that can issue a cross-origin request is one forged call away from releasing a queued withdrawal
nobody approved. Compounded by **A15**: the same route's handler double-pays on concurrent invocation
(§2.2), so a forged call racing a legitimate click produces two payments and two success responses.
*Fix:* `validateCSRFRequest` on all three routes in §2.6 before any payout work, with the client changes
landed in the same PR — the CEO/admin client helpers do not send `X-CSRF-Token` today, so server-side
validation added alone would break the UI.

**A15 · Authorization asymmetry becomes a silent privilege widening** — `operational_only`, but it is the
kind that turns into a loss. Unifying the two pipelines (Decision 1) means choosing one gate. If the
delegable `can_request_referral_payouts` wins, every center whose credit withdrawals are owner-only today
silently gains a second, non-owner path to move money — and the permission is currently set on exactly one
row, so nobody would notice the semantics changed until it was used. *Fix:* make the gate an explicit part
of Decision 1 rather than an implementation detail; separate *request* from *release* authority.
*Status 4 Aug 2026 — partially closed (§2.7.1).* The request/release separation is now asserted in code and
tested, and the referral route no longer passes on `isSuperAdmin` alone or on a centre-less role holding the
flag. The gate choice for the unification is recorded as an explicit open item in §2.7.1 rather than left to
the implementer. Re-verified live: the single flag-holding row is an **owner** on a **test** centre, so the
delegable permission authorises **zero** non-owner accounts — the widening this attack describes has no
existing user to hide behind, in either direction.

**A13 · Six months in, the question is unanswerable.** There is no per-period statement, no completeness
proof, and no way to see anything never recorded. *Fix:* a `payout_reconciliation_periods` table — one
immutable row per Cairo month holding opening/closing budget, top-ups enumerated from `/topup/inquire/`,
settled/fees/vat/returned totals, and `unexplained_delta_minor`. **A period cannot be closed while the
delta is non-zero**; closing with variance requires a named human and a written reason. This is the only
control that forces someone to look on a schedule rather than in response to an alert nobody wired up.

## 11. Decisions — all nine answered

**✅ ANSWERED IN FULL, 3 August 2026, by Eyad.** Eight decisions were accepted as recommended; **Decision 8
was decided against the recommendation** and is marked as such. This section is now a record of what was
decided, not a set of open questions.

| # | Decision | Answer |
|---|---|---|
| 1 | Unify referral + credit payouts — and, per §2.7, which authorization gate survives the merge? | ✅ **Unify, on owner-only + step-up auth.** `can_request_referral_payouts` is *request*-only, never *release*. ⚠ **The gate choice is still open at build time — see §2.7.1**, which asks whether the permission is retired (A), kept dormant (B) or extended to the unified route (C), with live evidence recommending (A) |
| 2 | Are all seven §2 defects in scope as prerequisites? | ✅ **Yes — all seven** |
| 3 | Append-only double-entry ledger, or extend the mutable-column pattern? | ✅ **Double-entry, this subsystem only** |
| 4 | How to eliminate the credit dual-authority window? | ✅ **(a) migrate the spend path in the same PR** |
| 5 | Clearing days | ✅ **0 credits / 7 referral**, config-driven |
| 6 | Clawback ladder and invoice threshold | ✅ **net → block → invoice → write off** |
| 7 | Approval model for v1 | ✅ **Always-manual for v1**, hybrid considered later |
| 8 | Who approves, and is maker–checker enforced? | ⚠️ **DECIDED AGAINST RECOMMENDATION, THEN REVISED. Final: delegated approval with a cap** — CEO approves any amount, always final, no second approver ever; CEO may optionally grant a named manager approval rights **below a config-driven 10,000 EGP cap**; CEO-grantable and CEO-revocable only; every payout logged immutably. Supersedes the earlier "no delegation at any amount" answer. See §7 — the model needs four changes before it holds, and one requirement (§7.4) cannot be delivered as stated |
| 9 | Does System 1 ship before V3 at all? | ✅ **Yes — that is the point of the split** |

**What the answers mean together.** System 1 is now fully specified: one unified payout pipeline on an
append-only double-entry ledger, owner-only to request, **CEO to approve at any amount plus an optional
CEO-granted manager delegation below a config-driven cap**, always manual in v1, credits migrated off the
old rail in the same PR, 0/7-day clearing, and a net → block → invoice → write off clawback ladder. All
seven §2 defects are prerequisites. It ships without waiting for V3.

**The revision to Decision 8 does not merely relax the model — it introduced four things that had to be
specified before it was safe.** All four are worked through in §7 and all four were verified against the
live system, not reasoned about abstractly. **Three are now settled** (1, 2, 4); **one remains a build
requirement rather than a decision** (3 — it needs code, not an answer):

1. **Approval authority must live outside `public.users`.** ✅ *Name decided: `can_approve_payouts`,
   distinct from `can_request_referral_payouts`.* ✅ *Table decided: **never** on `public.users`.* The
   reason it mattered: the existing staff-permissions route is owner-gated with **no self-target check**,
   so a `can_approve_payouts` *column on `users`* would be self-grantable by the center owner — the payee
   granting themselves release authority. Implement it as a permission **key** on the `admin_users`-side
   `permissions` table, which satisfies both the decided name and the disjoint-domain invariant. §7.1.
2. **The cap bounds one row, not one manager.** ✅ *Decided: 10,000 EGP per payout, checked on the
   **requested** amount, above-cap goes to the CEO.* Checking the requested gross **closes** the
   four-to-five-way "which amount" ambiguity, and closes it safely — the permissive `net_minor` reading
   would have let a gross of 10,546.31 through. ✅ *Anti-splitting decided: a second check of 10,000 EGP
   per center per **rolling 7 days**, either check exceeded sends the payout to the CEO.* This supplies
   the mechanism the per-payout rule alone could not — the 9,999-three-times sequence now hits the
   window cap on the second request. **Residual, recorded not reopened:** both caps are per-center, so a
   delegate holding the permission across many centers is bounded by center count rather than by the cap.
   §7.2.
3. **Revocation does not reach an already-approved payout**, and the cap in force at approval time is
   currently unprovable after the fact. §7.3.
4. **"Never deletable, including by the CEO" cannot be delivered as stated** — the CEO holds `postgres`,
   and nothing inside Postgres binds the owner of Postgres. Tamper-*evident* is achievable; tamper-*proof*
   is not. ✅ *Sink decided: the external sink credential is held by Eyad alone and is not stored anywhere
   the application can reach.* That is the correct security posture and it fixes the claim the spec may
   make: **the log is tamper-evident with a detection window equal to the publication interval**, and
   because the application cannot reach the sink, publication is an out-of-band act whose cadence *is*
   that window — a missed publication silently widens it and nothing in-system can alert on it. §7.4.

**Both remaining questions are now answered.**
- **✅ CEO unavailability: payouts wait. No fallback approver, at any amount, for any duration.** An
  above-cap payout has exactly one path to release. Requests must age visibly rather than expire. The
  ungoverned path that exists today — editing `SUPER_ADMIN_PHONES` to mint a CEO with no database row —
  is closed by requiring a real `admin_users` row for payout approval, and is logged as **S10** because
  it is a hole in the existing admin surface independently of this feature. §7.5.
- **✅ Sink: Eyad holds the credential, unreachable by the application.** See item 4 above and §7.4 for
  what the spec may and may not claim as a result.

**Two implementation traps, agreed and settled, recorded so they cannot be re-litigated into the code:**
`can_approve_payouts` **never** lives on `public.users` (item 1 — the staff-permissions route has no
self-target check, so a column there is self-grantable by the payee), and the cap config key **names its
unit explicitly** (`payout_delegate_cap_minor`, piastres — not a bare `..._cap` that reads as EGP to the
next person who touches it, per §2's amount-unit defect).

**Not decisions — facts to act on, both still outstanding:** start the Paymob commercial conversation now
(onboarding is manual and gates the whole integration), and get written answers to the seven questions in
§8.
