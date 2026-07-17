# Job 4 money batch

Held for Eyad's merge. Every decision below is answered (Eyad, 2026-07-16) and the
scope here is final. This brief is self-contained on purpose, so a session with
none of that context can run it without opening any other file.

Model: **Fable 5** (this touches money and auth-adjacent billing code; use the
largest available model).

Scope: the follow-up work implied by sweep items 1-4 only:
- Item 1: `students.balance_due` (B2).
- Item 2: commission engine (clawback + reassignment + promo base).
- Item 3: teacher annual purchase path (C1).
- Item 4: Scale teacher overage activation (C2).

**Explicitly OUT of scope: saved-card auto-charge and the 30 August lockout (C3).**
C3 is not a batch item. The August posture is decided (Eyad, 2026-07-16): the
lockout policy is unchanged, and Job 3 carries a hard interlock so that while the
Paymob recurring credential is a placeholder the lockout refuses to lock, sends the
nudge, and leaves the account open; it widens and narrows itself automatically once
auto-charge is real. Do NOT build a separate manual grace, and do NOT put any
lockout change in this batch. Do not fold any C3 work into this PR.

## The headline you need before scoping this

When the code was actually read (not assumed), most of the work this batch was
expected to do turned out to be **already done**:
- B2 is already fixed: the app already computes student balances live and stores
  no `balance_due` column. No migration or backfill is warranted.
- Both reported commission bugs are already fixed by the recent rewrite.
- C1 (teacher annual) is code-complete; it is gated only by Paymob not being live,
  plus one small real UI bug.
- C2 (Scale overage) is code-complete and self-activates from data; no code change.

So this "money batch" is small. Do not invent work to fill it. It introduces **no
database migration at all** (see the merge procedure note). The decided scope is:
fix the C1 toast bug, add the student-detail balance card (computed live), add the
balance regression guard, add commission tests, document the manager-only
behaviour in the code, and append money invariants 16 and 17 to the billing skill.

---

## Decisions settled (Eyad, 2026-07-16)

These were open when the brief was drafted; they are now answered and baked into
the tasks below. Recorded here so the scope is not silently defaulted.

- Student-detail balance: ADD it, computed live. No column, no migration.
- Balance regression guard: ADD it.
- Promos are SIGNUP ONLY, never on a renewal. The second commission half (T2) is
  therefore correct as written: no fix, add tests that pin the assumption, and
  append money invariant 16 (Task S below).
- Manager-only reassignment: KEEP the current behaviour; document it in the code as
  intended so nobody "fixes" it later.
- Teacher annual at signup: leave it out; it belongs to the signup redesign.
- Balances stay live. Fix the false annual "saved" toast. Scale overage
  self-activates, nothing to build.

---

## Money merge procedure (follow exactly; never merge and assume)

1. All work lands on a new held branch with a PR. Do NOT merge.
2. Eyad reviews. Green CI proves nothing on its own here (CI has no live database).
3. **If, and only if, a chosen task introduces a database migration**, Eyad
   applies that migration BY HAND to production, then confirms the new columns/
   objects physically exist in the live catalog (`information_schema.columns` /
   `pg_constraint`), not in `schema_migrations` (which is bookkeeping, not proof).
   Supabase Branching auto-applies to preview branches only, never to production
   on merge, so a merged migration is NOT a deployed migration.
4. Only after the columns are confirmed present does the code get merged and
   deployed. Never merge code that reads a column before that column exists in the
   live schema (this exact gap caused the July 8 student-detail outage).
5. **As decided (Eyad, 2026-07-16), this batch introduces NO migration**: the
   balance card computes live (no column), the regression guard is a check script,
   the commission work is tests plus a code comment, C1 is a UI/route fix, C2 is no
   change, and invariant 16 is a documentation line. Step 3 is therefore a no-op
   for this batch. If any future change adds a migration, this procedure applies.

---

## Task B2 - students.balance_due (mostly confirmation)

**Verified current state (re-verify before acting; do not trust this line):**
`students.balance_due` does not exist in the live database and no migration
creates it. The app already standardised on a live-recompute helper
`src/lib/studentBalance.ts` (`getStudentBalances` / `getStudentBalance`;
balance = sum of chargeable center-group `attendance_scans.charged_fee` minus sum
of `payments.amount` in {confirmed, pending, paid}). `src/app/api/payments/confirm/route.ts`
does NOT write a balance (only a comment remains where the old decrement was).
No `.select(...)` reads the column; `src/app/[locale]/students/[id]/page.tsx`
hard-codes physical columns with a guard comment and shows no balance card.

**Do NOT** add a persisted `balance_due` column, backfill, or a decrement on
payment. That reintroduces the drift the helper was built to remove, and would 400
every students query the moment any select names the column. Keep the live
recompute.

Work:
- Add a read-only Balance card to
  `src/app/[locale]/students/[id]/page.tsx` using `getStudentBalance(supabase, id)`
  (server component; the helper is isomorphic). Format money via `formatCurrency`
  from `src/lib/formatNumber.ts`. Do not add `balance_due` to `STUDENT_SELECT`.
- Add a small check script (mirror the existing `scripts/check-*.ts`
  gates and wire it into the `build` gate chain) that greps `src/` for a students
  Supabase `.select(...)` containing `balance_due` and fails if found. Keep the two
  existing guard comments in place regardless.
- Optional tidy: `src/lib/db.ts:69` has a stale descriptive comment listing
  `balance_due` in the IndexedDB sync object; correct or remove it. Cosmetic.

No migration. No money math change.

## Task 2 - commission engine (tests only; no bug fix)

**Verified current state:** the `commissions` table has `t1_status`, `t2_status`,
`loyalty_bonus_status` with `clawed_back` and `reassigned` allowed. Both reported
bugs are already fixed:
- Clawback fires only from `finalizeInvoiceChargeback`
  (`src/lib/invoicePaymobPayment.ts`), reached only on a genuine Paymob
  `is_voided`/`is_refunded` webhook (`src/app/api/paymob/webhook/route.ts`).
  Cancellation, suspension, and blacklist explicitly do NOT claw back
  (`src/app/api/admin/centers/[id]/route.ts:532-534`).
- Reassignment is wired: `reassignCommissions` (`src/lib/commissions.ts:258-385`)
  is called on a `staff_id` change from both
  `src/app/api/admin/center-assignments/[id]/route.ts` and
  `.../teacher-assignments/[id]/route.ts`. It voids live tiers to `reassigned`,
  re-creates the new rep's rows, and transfers the payment clock.
- The first commission half (T1) base is promo-aware (post-discount price via
  `firstPaymentPromoFraction`, `src/lib/commission/ownerFinancials.ts`); the
  second half (T2) is recomputed at standing price at the 6-month mark, which is
  correct only if promos are signup-only.

Work:
- Add regression tests (unit/integration) proving: clawback fires on an
  `is_voided`/`is_refunded` webhook and does NOT fire on blacklist/cancel/suspend;
  `reassignCommissions` voids-to-`reassigned` and transfers the clock without
  double-paying a `paid`/`clawed_back` tier.
- Promos are SIGNUP ONLY (Eyad, 2026-07-16), so the T2 recompute at the standing
  price is correct as written. Make NO commission-amount change. Add tests that pin
  this assumption: prove the T2 base uses the standing price and that a signup promo
  reduces only T1, so that if a future change ever applied a promo to a renewal the
  tests break loudly. Also append money invariant 16 (see Task S below).
- Manager-only reassignment: KEEP the current behaviour (a change to only the
  manager, not the rep, does not recompute the override). Do not add a recompute
  path. Add a code comment at that branch documenting it as intended, so nobody
  "helpfully" fixes it later.

No migration. Do not change any commission amount formula.

## Task C1 - teacher annual (fix the one real bug)

**Verified current state:** the annual path is code-complete (annual toggle on the
billing and resubscribe pages; the switch-interval and resubscribe routes accept
and persist `annual`; annual price = monthly x 10 via `getAnnualChargeRounded`;
the webhook finalize persists `annual` + a 365-day period). It is not functional
today only because Paymob is not live (`PAYMOB_ENABLED` off and the recurring
integration id unset), which is C3 territory and out of scope here.

**The one genuine bug to fix (not gated):** an ACTIVE monthly teacher who clicks
"Annual" while Paymob is disabled is shown a success toast, but nothing is saved
or charged. Specifically:
- `src/app/api/teacher/subscription/switch-interval/route.ts:141-143` returns
  `{ paymob_disabled: true }` for the active monthly->annual case BEFORE writing
  `billing_interval` (the flip only happens later in the payment webhook).
- `src/components/teacher/TeacherPlanSection.tsx:67-71` responds to
  `paymob_disabled` with `toast.success(t('intervalSaved'))` and reloads, so the
  teacher is told annual was saved when the row is still `monthly`.

Fix: make the active-with-Paymob-disabled case honest. Match the resubscribe
page's pattern, which renders a "coming soon" state for `paymob_disabled` rather
than a false success. Either (a) have the client render `paymob_disabled` as an
informational "online payment coming soon" state (no success toast), or (b) if you
prefer to capture intent, persist the requested interval into
`scheduled_billing_interval` and tell the teacher it will apply at their next
charge. Do NOT report success without a state change. Keep the trialing branch as
is (it already persists via the plain-write path and is correct).

- Annual at signup: OUT of scope (Eyad, 2026-07-16). Leave annual as a post-signup
  switch; it belongs to the signup redesign, not this batch.

No migration. No pricing-number change (annual = monthly x 10 already, do not
recompute the anchors).

## Task C2 - Scale teacher overage (no code change; verify only)

**Verified current state:** the overage engine is fully built (amount math,
`teacher_overage` invoice creation, detection/charge inside the midnight cron,
tick advance). It is NOT gated by any feature flag or summer check. It is inert
only because `teacher_subscriptions.overage_next_at` is NULL everywhere, and that
column is first set only when a Scale teacher pays her first base subscription
invoice. With no Scale subscribers and the money rails not live, that never
happens yet.

Work: **none in code.** It self-activates post-summer once a real Scale subscriber
pays a first base invoice. The only thing to verify (a read, not a change) is that
the overage CHARGE itself also routes through the saved-card engine, so when the
money rails go live the overage invoice actually collects rather than only being
created on the manual surface. That verification belongs with the C3 go-live work,
not this batch. Do not add an overage feature flag; none is needed.

## Task S - append money invariants 16 and 17 to the billing skill, and note the fee-booking rule in the CFO agent

Two locked money rules the code depends on but never states. Append both as new
numbered lines at the end of the numbered "Money invariants (LOCKED)" list in
`.claude/skills/automated-billing-and-fees/SKILL.md` (that list currently ends at
invariant 15). Paste each verbatim; do not renumber or edit invariants 1 to 15.

Invariant 16 records that promotional discounts are signup-only (Eyad confirmed
2026-07-16), which is what makes the T2 commission half correct even though the
rule is invisible in the code:

16. Promotional discounts apply to the first bill only, never to a renewal. The second-half (T2) referral commission is deliberately promo-unaware, recomputed at the standing price, and is correct ONLY because of this rule. If promos are ever allowed to apply to renewals, the T2 commission base must be fixed first. Confirmed by Eyad 2026-07-16.

Invariant 17 records how the flat 20 EGP processing fee is booked, so the gap
between that flat fee and Paymob's percentage cost is never hidden:

17. The flat 20 EGP processing fee is REVENUE, not a pass-through, and must never be booked as offsetting payment processing cost. It is VAT inclusive, so it nets 17.54. Paymob's cost is separate and scales with the invoice: their published example is 2.75% plus 3 EGP per successful transaction. That rate is NOT confirmed as EHG's negotiated rate and is an assumption until Paymob confirms it. At that rate the fee covers roughly 57% of Paymob's cost on a Solo monthly invoice, 6% on Solo annual, and 0.3% on Enterprise annual, because the fee is flat while their cost is a percentage. Eyad decided 2026-07-16 that the percentage comes out of margin and that no percentage-based customer fee will be added. Never net the two. 20 EGP in as revenue, Paymob's charge out as cost of sales, always two separate lines. Netting them hides a cost that scales with every pound billed and flatters every projection built on it.

Then add the same booking rule, short, to the financial ground-truth list in
`.claude/agents/cfo-controller.md`: the 20 EGP fee is revenue, Paymob's percentage
is cost of sales, never netted, and the 2.75% is an unconfirmed assumption.

These are documentation lines only: no code, no migration.

---

## Verification before pushing this batch

- Re-verify each "verified current state" line above against the live catalog and
  the actual files BEFORE acting. Code moves; do not trust this brief's snapshot.
- Run `npm run typecheck`, `npm run lint`, and the full unit suite
  (`npm run test:unit`). The balance card and the C1 fix touch UI, so run
  `npm run verify:stabilization` (i18n + bidi + tolocale gates) too, and add any new
  i18n keys to BOTH `messages/ar.json` and `messages/en.json` (the parity gate
  breaks the build otherwise).
- Push to a held branch, open a PR, and STOP. Follow the money merge procedure
  above. Do not merge.
