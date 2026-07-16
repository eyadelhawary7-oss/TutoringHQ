# DRAFT - Job 4 money batch (DO NOT RUN YET)

Status: DRAFT. Held for Eyad's decisions. Do not start until the open decisions
below are answered. This brief was drafted by the read-only sweep session that
investigated the code; it is self-contained on purpose, so a session with none of
that context can run it without opening any other file.

Model: **Fable 5** (this touches money and auth-adjacent billing code; use the
largest available model).

Scope: the follow-up work implied by sweep items 1-4 only:
- Item 1: `students.balance_due` (B2).
- Item 2: commission engine (clawback + reassignment + promo base).
- Item 3: teacher annual purchase path (C1).
- Item 4: Scale teacher overage activation (C2).

**Explicitly OUT of scope: saved-card auto-charge (C3).** C3 is not a batch item.
It is blocked on an external Paymob RECURRING/MOTO integration credential that the
docs say has not been requested yet, and it needs its own track and its own
decision about the 30 August lockout posture. Do not fold any C3 work into this
PR.

## The headline you need before scoping this

When the code was actually read (not assumed), most of the work this batch was
expected to do turned out to be **already done**:
- B2 is already fixed: the app already computes student balances live and stores
  no `balance_due` column. No migration or backfill is warranted.
- Both reported commission bugs are already fixed by the recent rewrite.
- C1 (teacher annual) is code-complete; it is gated only by Paymob not being live,
  plus one small real UI bug.
- C2 (Scale overage) is code-complete and self-activates from data; no code change.

So this "money batch" is small. Do not invent work to fill it. As currently
scoped it introduces **no database migration at all** (see the merge procedure
note). The one genuine code fix is the C1 toast bug (Task C1 below). Everything
else is optional and decision-gated.

---

## OPEN DECISIONS (answer these first; the tasks reference them by number)

The drafting session did NOT make these calls. Each changes what gets built.

- **D1 (B2 detail-page balance).** The student DETAIL page currently shows no
  balance at all (only "visits" and "last seen"). Do you want a Balance card added
  there, computed live via the existing helper? YES adds a small read-only UI card.
  NO leaves the detail page as is. (Default assumption if unanswered: NO.)
- **D2 (B2 regression guard).** Add a build-time gate that fails the build if a
  students `.select(...)` string ever contains `balance_due` (which would 400 the
  whole query and surface as "student not found")? YES adds one small check script
  wired into the existing gates. (Default assumption if unanswered: YES, it is
  cheap insurance.)
- **D3 (commission promo scope).** Confirm: are pricing promos strictly
  signup-only (never applied to a renewal)? If YES, the commission code is correct
  as written and Task 2 is tests only. If promos can ever apply beyond signup, the
  second commission half (T2) is computed at full standing price and would need a
  fix; flag it back for a separate decision. (No safe default; must be answered.)
- **D4 (commission manager-only reassignment).** When an admin changes ONLY the
  manager/reports-to on an assignment (not the rep), the existing override is not
  recomputed to the new manager. Is that intended? YES = leave it and document it.
  NO = Task 2 adds a recompute path. (Default assumption if unanswered: YES,
  leave as is, since no commissions exist yet and this is an edge case.)
- **D5 (C1 annual at signup).** Today a new teacher can only pick annual AFTER a
  subscription exists (via the billing page or resubscribe), never at initial
  signup. Add an annual choice to the teacher signup flow? YES adds a signup UI +
  wiring change. NO leaves annual as a post-signup switch. (Default assumption if
  unanswered: NO for this batch; revisit with the launch UI pass.)

Tasks below are written so that, with the default assumptions, this batch is just
"Task C1 (the toast bug) + Task 2 tests + Task B2 regression gate." Anything a
decision turns on is marked DECISION-GATED.

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
5. **As currently scoped, this batch introduces NO migration** (B2 needs none;
   commission needs none; C1 is a UI/route fix; C2 is config/data). If every
   decision takes its default, step 3 is a no-op. The only way this batch would
   need a migration is if D1/D2/etc. were expanded into schema changes, which is
   not recommended. If that changes, this procedure applies.

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

Work, decision-gated:
- If **D1 = YES**: add a read-only Balance card to
  `src/app/[locale]/students/[id]/page.tsx` using `getStudentBalance(supabase, id)`
  (server component; the helper is isomorphic). Format money via `formatCurrency`
  from `src/lib/formatNumber.ts`. Do not add `balance_due` to `STUDENT_SELECT`.
- If **D2 = YES**: add a small check script (mirror the existing `scripts/check-*.ts`
  gates and wire it into the `build` gate chain) that greps `src/` for a students
  Supabase `.select(...)` containing `balance_due` and fails if found. Keep the two
  existing guard comments in place regardless.
- Optional tidy: `src/lib/db.ts:69` has a stale descriptive comment listing
  `balance_due` in the IndexedDB sync object; correct or remove it. Cosmetic.

No migration. No money math change.

## Task 2 - commission engine (tests + decisions; no bug fix)

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
- **D3-GATED:** if promos are confirmed signup-only, no code change; document the
  assumption in a comment near the T2 recompute. If NOT signup-only, STOP and flag
  a separate decision for the T2 base (do not silently change money math).
- **D4-GATED:** if manager-only reassignment should recompute the override, add
  that path; otherwise document the current behaviour.

No migration. Do not change any commission amount formula without an explicit
decision (D3).

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

- **D5-GATED:** if annual-at-signup is approved, add the interval choice to the
  teacher signup flow and wire it through provisioning. Otherwise leave annual as a
  post-signup switch.

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

---

## Verification before pushing this batch

- Re-verify each "verified current state" line above against the live catalog and
  the actual files BEFORE acting. Code moves; do not trust this brief's snapshot.
- Run `npm run typecheck`, `npm run lint`, and the full unit suite
  (`npm run test:unit`). If D1/C1 touch UI, run `npm run verify:stabilization`
  (i18n + bidi + tolocale gates) too, and add any new i18n keys to BOTH
  `messages/ar.json` and `messages/en.json` (the parity gate breaks the build
  otherwise).
- Push to a held branch, open a PR, and STOP. Follow the money merge procedure
  above. Do not merge.
