# Findings

**Opened 6 August 2026. Open file, added to as verification continues.**

Twelve documents were deleted because they mixed codebase facts with measurements against designs
that no longer exist. Restoring them whole would have brought the stale half back. These are the
findings extracted instead.

**Every line here was verified against live code or the live catalog on the date given, not against
any design and not against the ledger it came from.** The ledger's own "fixed" and "open" markers
were treated as claims to check, never as evidence. That mattered in both directions, and the
section at the foot records the four it killed.

**Scoping rule applied.** A finding is here only if it names a specific file, column, route or
constraint, asserts something checkable against live code or the catalog today, and is not already
recorded in `docs/STATE-OF-PLAY.md` or one of the five recovered documents.

---

## 1. `requireSuperAdminRow` does not require a row

**`src/lib/admin-access.ts`.** The function computes
`adminUser?.role === 'super_admin' || isSuperAdminPhone(sessionPhone)`.

The name promises a database-backed check. It falls back to `SUPER_ADMIN_PHONES`, **the same
environment variable the first gate already reads**. Every route that calls it believing it has
added an independent, catalog-verifiable second gate has added nothing. The name is the dangerous
part, because it invites exactly that belief.

`STATE-OF-PLAY` records the first half of this, that the phone path mints a CEO with no database row
and no forensic trail. It does not record that the second gate is not a second gate.

Live catalog: `admin_users` holds **1** `super_admin` row. Anyone else holding that authority holds
it entirely off-catalog.

*Source: `BUILD-AFTER-REDESIGN.md`. Verified 6 August 2026.*

---

## 2. Every centre is capped at two team members and told it is on Starter

**`src/app/api/invite-user/route.ts:67`.** The query selects `plan, max_teachers` from `centers`.
**`centers.max_teachers` does not exist** (catalog: 0). The error is **not destructured**:

```ts
const { data: centerPlanRow } = await supabaseAdmin
  .from('centers')
  .select('plan, max_teachers')
```

So PostgREST returns 42703, `centerPlanRow` is null, and `maxTeam = Number(undefined ?? 2)` is
**2**. Every centre on every plan is capped at two team members. `planName` reads from the same null
object and falls back to `'Starter'`, so a Business centre is told it has reached the limit *for the
Starter plan*.

**A paid feature that silently does not deliver, and fails without an error because the error is
never read.**

*Source: `BUILD-AFTER-REDESIGN.md` F26 #3. Verified 6 August 2026.*

---

## 3. `/api/settings/limits` returns 404 for every centre, always

**`src/app/api/settings/limits/route.ts:18`** selects `max_teachers, max_students, plan`. Neither
`centers.max_teachers` nor `centers.max_students` exists (catalog: 0 and 0). The select errors,
`centerError` is truthy, and the route returns 404 "Center not found" before it counts anything. The
endpoint cannot succeed under any conditions.

*Source: `BUILD-AFTER-REDESIGN.md` F26 #2. Verified 6 August 2026.*

---

## 4. Every vendor print PDF for every card order is dead

**`src/app/api/admin/card-orders/[orderId]/pdf/route.ts:33`** selects `card_style`.
**`card_orders.card_style` does not exist** (catalog: 0). The select errors and the route returns
404 unconditionally.

This one cannot be fixed by deleting the read. **The checkout path writes `card_style`**
(`api/card-order-cart/checkout/route.ts`) and five sites read it. A whole feature was built against
a column that was never added, so removing the reads means deciding the card style option does not
exist. Card orders are parked, which lowers the urgency but not the fact.

*Source: `BUILD-AFTER-REDESIGN.md` F26 #1. Verified 6 August 2026.*

---

## 5. `bosta_shipments` is queried and does not exist

**`src/lib/loadCardOrderDetail.ts:72`** runs
`admin.from('bosta_shipments').select('*').eq('card_order_id', id).maybeSingle()`.
**The table does not exist** (catalog: 0).

*Source: `BUILD-AFTER-REDESIGN.md` F26. Verified 6 August 2026.*

---

## 6. The centre all-in rate is computed five ways and three of them are wrong

`getQuarterlyAllInMonthlyRateFromCenter` (`src/lib/pricing.ts:235`) is the canonical helper and it
resolves `top_centers` then `early_adopter_price` then `all_in_price`. **It has exactly one external
caller**, `src/app/api/admin/billing/route.ts:105`.

Three paths bypass it and never consult `early_adopter_price`:

| Path | Reads |
|---|---|
| `src/app/[locale]/settings/billing/page.tsx:89-93` | `all_in_price` |
| `src/app/[locale]/(dashboard)/billing/BillingPageClient.tsx:298-301` | `billing_amount` then `all_in_price` |
| `src/app/api/ceo/dashboard/route.ts:114-115` | `all_in_price` first, though it selects `early_adopter_price` at `:37` and `:108` |

The moment a centre is made an early adopter, `all_in_price` still holds the list price written at
signup while `early_adopter_price` holds what is actually owed. **The owner is shown a renewal figure
above what they pay, on both of their billing screens, while admin MRR shows the correct lower one.**

**Latent today, not visible.** Live catalog: 2 centres, both `is_test`, 0 early adopters, 0 rows with
an `early_adopter_price`. This becomes real on the first early adopter.

*Source: `SURVEY-Center-Money.md`. Verified 6 August 2026.*

---

## 7. The early-adopter badge contradicts the number beside it

**`src/app/[locale]/(dashboard)/billing/BillingPageClient.tsx:344`** renders the "Early adopter" chip
from `center.is_early_adopter`, directly beside `displayAmount` computed at `:298-301`, which never
consults the early-adopter price. **The badge and the number disagree by construction**, not by
timing or by data.

*Source: `SURVEY-Center-Money.md`. Verified 6 August 2026.*

---

## 8. `center_invites.status` does not exist

Catalog: 0. Any invite flow that filters or transitions on invite status has nothing to read or
write.

*Source: `BUILD-AFTER-REDESIGN.md` F19. Verified 6 August 2026.*

---

## 9. `subjects.is_active` does not exist, and neither does any grades table

Catalog: `public.subjects` carries no `is_active` column, and no grades table exists in `public`. Any
subject on/off control and the entire grades concept have no backing schema.

*Source: `BUILD-AFTER-REDESIGN.md` F33. Verified 6 August 2026.*

---

## 10. `student_groups.teacher_split_pct` and `assign_teacher_to_group` are dead

The column exists in the catalog and has **zero** references anywhere in `src/`. The RPC
`assign_teacher_to_group` likewise has **zero** references. Dead schema carrying an implied teacher
revenue split that nothing computes.

*Source: `BUILD-AFTER-REDESIGN.md` F9. Verified 6 August 2026.*

---

## 11. `student_groups.capacity_cap` is dead

The column exists in the catalog and has **zero** references anywhere in `src/`.

*Source: `BUILD-AFTER-REDESIGN.md` F11. Verified 6 August 2026.*

---

## 12. A consent control exists, is recorded, is shown back, and is overridden

**This is a consent failure, not a notification bug.** The parent exercised a choice, the platform
stored it, displayed it back to them as active, and then sent the messages anyway. Under PDPL that is
a worse position than never having offered the control, because the record shows a choice was
captured and honoured when it was not.

`students` carries three per-student parent toggles, all `boolean` defaulting to `true`:
`notify_on_scan`, `notify_on_absence`, `notify_on_balance`.

**All three are writable.** `src/app/api/whatsapp-pack/student/[studentId]/route.ts:39-43` writes
`notify_on_absence` and `notify_on_balance`, `src/app/api/students/[id]/route.ts:40` accepts the
former, and `src/app/api/whatsapp-pack/settings/route.ts:50` reads all three back for display.

**Only one is honoured.** `src/lib/whatsapp/flows/parentNotifications.ts:82` gates on
`s.notify_on_scan === false`. The other two send paths do not consult their flag at all:

| Send path | Selects | Gates on its flag |
|---|---|---|
| `api/cron/parent-absence-alerts/route.ts:83` | `students(id, name, parent_phone, parent_pack_opted_in, is_active)` | **No** |
| `api/cron/parent-balance-alerts/route.ts` | no reference to `notify_on_balance` anywhere in the file | **No** |

A parent who switches off absence or balance alerts keeps receiving them, and the toggle keeps
reading as off. An opt-out that appears to work and does nothing is worse than one that is absent,
because nobody re-checks it.

**The centre is billed for every message it should never have sent.** Each of these goes out on the
centre's paid WhatsApp pack, so the failure costs the customer money on top of overriding the
parent. Two harms from one missing `select`.

**Why this belongs to the platform and not the centre.** The centre cannot fix it, cannot see it,
and did nothing wrong. The toggle, the storage, the display and the cron are all platform code. This
sits with the consent obligations the platform owns directly rather than the ones it passes to
centres under the agreement.

**For Adsero.** They will want to know that a consent control existed and did not work, and for how
long, separately from the question of whether the control was required. Recorded as an open item in
`docs/LEGAL-STATUS.md`.

*Source: `BUILD-AFTER-REDESIGN.md` F39. Verified 6 August 2026.*

---

## 13. `students.payment_status` and `students.fee` are still live and still misleading

Both columns remain: `payment_status` is `text NOT NULL DEFAULT 'unpaid'`, `fee` is `numeric
DEFAULT 0`. Neither is maintained after insert. The authoritative values are computed by
`src/lib/studentBalance.ts` (`getStudentBalances`) and held on `student_groups.fee_per_class`.

The six known readers were repointed onto the helper, which `STATE-OF-PLAY` records. **What it does
not record is that the columns survive**, so nothing stops a seventh reader being written by someone
reaching for a flat field instead of a join-and-sum.

**Checked for a seventh instance and found none.** The scanner was the likeliest candidate and is
clean: `src/components/attendance/ScanTab.tsx:349` selects only
`id, student_number, name, is_active, center_id`, and `:578` seeds its local `fee` from the group's
`fee_per_class`, which is the authoritative source. The scanner is correct today.

This entry exists so the next instance is logged as instance seven of a known pattern rather than
written up as a new discovery. Dropping or backfilling the two columns is the only version of the
fix that makes an eighth impossible rather than merely findable.

*Source: `BUILD-AFTER-REDESIGN.md` F16. Verified 6 August 2026.*

---

## 14. The scanner billing pipeline, five live faults from one vocabulary mismatch

The scanner is the core attendance-to-billing path, not an edge screen. One item of the original
finding was fixed; **five remain live and all five were re-verified**.

**The payment method vocabulary does not agree with itself.** Live `payments_method_check` allows
exactly `cash, instapay, vodacash, orange, fawry, bank`.

**a. Late entry charges the student again every thirty seconds.** `src/lib/sync.ts:118` inserts
`method: 'late_entry'` into `payments`. That value is **not in the constraint**, so the insert always
fails. The error *is* checked here, so the queue item is never dead-lettered and retries. Each retry
re-runs the `attendance_scans` insert at `:92` first, and there is no dedup: the unique constraint is
`UNIQUE (session_id, student_id)` and the scanner never sets `session_id`, so Postgres treats every
row as distinct. **A late-entry grant left open in a busy front-desk tab inflates the student's
balance by the session fee, repeatedly, for as long as the tab stays open.**

**b. The main payment path swallows its error.** `sync.ts:182` is a bare
`await dbInsert({ table: 'payments', ... })` with no error destructured. Lines 74, 92, 112 and 156 in
the same file all check theirs, so this call is the exception rather than the pattern. `:188` then
removes the queue item regardless. The attendance row lands, the student is billed, the payment row
is never written, and staff and parent both see success.

**These two must be fixed together.** Adding an error check to (b) alone converts a silent missing
payment into (a): a retry loop that re-charges. Retry-safe dedup has to land with it.

**c. Fee-exempt admissions may not record at all.** `attendance_scans_payment_status_at_scan_check`
allows only `'paid'` and `'unpaid'`. The exempt path writes `'admitted'`, which
`studentBalance.ts` treats as load-bearing vocabulary with its own exclusion logic. The insert should
fail at the database layer. Not a typo to patch: changing the string changes balance semantics for
every exempt session.

**d. Four of the six methods lose most of their payload.** `paymentSchema`
(`src/lib/validations.ts:87-94`) declares only `student_id, amount, method, payment_date`, extended
at `:327` with `center_id`. Zod strips unknown keys, so `recorded_by`, `paid_at`, `status`,
`confirmed`, `confirmed_at` and `group_id`, all set by `sync.ts`, never reach Postgres. `group_id`
lands `NULL`, breaking per-group attribution for multi-group students; `recorded_by` lands `NULL`,
losing which staff member recorded it.

**e. No permission gate on the payments insert.** `src/lib/dbProxyScope.ts:151` gates on
`table === 'attendance_scans' && operation === 'insert'` only. There is no equivalent branch for
`payments`, so any authenticated user tied to a centre can record a payment through this route
regardless of `can_record_payments`. **This compounds with (d):** fixing the Zod stripping without
adding the gate would let an under-privileged account set `confirmed`, `status` and `recorded_by`
directly.

*Touches money and auth. Source: `BUILD-AFTER-REDESIGN.md` F20. Verified 6 August 2026.*

---

## 15. A migration filename is not its recorded version, so absence proves nothing

`supabase_migrations.schema_migrations` stamps a version at apply time that **does not match the
filename**. Verified live:

| File | Recorded as |
|---|---|
| `20260804120000_sessions_tenant_key_and_occurrence_uniqueness.sql` | `20260804094631` |
| `20260730110000_students_inactive_reason.sql` | `20260730122204` |
| `20260730090000_permissions_canonical_admin_store.sql` | `20260729184405` |

So a filename cannot be looked up in that table, and **absence from it is not evidence that a file
has not been applied.** Match on the migration *name*, or better, check the catalog for the objects
the file creates. `CLAUDE.md` already says the ledger is bookkeeping and not proof; this is the
concrete mechanism, with the drift measured rather than asserted.

**Related and already handled, recorded so it is not re-opened.** `schedule_slots.parent_slot_id` is
dropped (catalog: 0) and the rule against reviving it is carried **in the database itself** as a
`COMMENT ON TABLE public.schedule_slots`, verified present. It reads in part: *"Do NOT add a
parent/child slot pointer to build a second materialisation path."* That comment outlives any
document, so the rule needs no entry here beyond this pointer.

*Source: `BUILD-AFTER-REDESIGN.md` F27. Verified 6 August 2026.*

---

# Four the ledger called open and verification closed

**Recorded so nobody re-opens them from an old copy of a deleted document.** Each was carried as an
open finding and each is resolved.

| Was | Now |
|---|---|
| **F44** — `centers.address` has no column, needs a migration, stopped rather than written | **The column exists.** Catalog: 1. Dead finding. |
| **F13** — `students.grade_level` has zero writers, the display will stay blank | **It has a writer.** `src/components/teachers/GroupProposalsTab.tsx:201`. Dead finding. |
| **F5** — `admin_users.custom_permissions` is dead and pending a drop | **Seven files use it**, including a live write at `admin/internal-team/page.tsx:153`. Do not drop it. |
| **F26 item 4** — `card_order_status_transitions.created_at` is read and does not exist | **Genuinely fixed.** `loadCardOrderDetail.ts:67` and `cardOrderState.ts:218` both order by `transitioned_at`, and that column exists. |

This is the same rule that found three of the seven payout defects already fixed. It cuts both ways,
which is the point: a ledger marker is a claim, not evidence, whichever direction it points.

---

# Still to verify

Not yet checked, and therefore not yet claimed either way.

**8 F-codes:** F5b, F6, F8, F14, F28, F29, F32, F38. Plus **S9**, a CSRF gap on four CEO and admin
mutation routes found in the same file, which meets the scoping rule and is queued with them.

F20 produced finding 14 and F27 produced finding 15.

**Five have been worked since this file opened.** F16 yielded finding 13 and F39 yielded finding 12.
F12, F36 and F37 were **dropped**, and the reason matters: each asserts that a design drew something
with no backing column. Those designs have been replaced, so re-establishing them is Stage 4 re-diff
work against the new drawings, not a fact about the codebase. `pending_enrollments` having no origin
column is true and is not a fault.

**F16 was expected to be the largest remaining yield and was not.** Its six instances were genuinely
fixed and no seventh exists, so it produced one structural entry instead of several.

**7 standing D-codes** from `ASSUMPTIONS-LOG.md`, decisions taken in Eyad's place that are still
live and still relevant: D8, D17, D21, D26, D27, D29, D34. Each goes in as an open decision once its
underlying codebase fact is verified.

**`DATA-GAPS.md`, 79 rows, triaged last.** It is a column-existence sweep and most likely duplicates
findings 2 through 5 and 8 through 11, but that will be checked rather than assumed.
