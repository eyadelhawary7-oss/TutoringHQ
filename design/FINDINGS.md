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

# The pattern, which is worse than any single entry

**Four of the four consent obligations the platform owns were checked. Four were wrong.**

| | Obligation | Verified state |
|---|---|---|
| 1 | Right-to-erasure self-serve delete | No self-serve path; erasure stops at one table. Entry 3 |
| 2 | Consent check before parent alert crons | Two of three toggles ignored at send. Entry 2 |
| 3 | Per-center scoping of consent opt-outs | Consent written across centre boundaries. Entry 1 |
| 4 | Short-lived revokable parent-portal links | Minted cross-centre, never revoked on erasure. Entries 1 and 3 |

**This is not four bugs. It is a category of commitment that was written down and never checked.**
Each was recorded as something the platform owns rather than something a centre owns, which is
precisely what made them invisible: no centre could see them, no centre could report them, and
nothing in CI tests a promise. They surfaced only because they were asked about one at a time, and
the fourth was found by asking a fourth time rather than by anything flagging it.

**None has harmed anyone.** Zero parent phones at more than one centre, zero opt-out flags set to
false, zero erasure requests filed. Every one is a pre-launch fix rather than a disclosure, and each
of those three facts took one query.

**The lesson for anything else on a list like this:** a written obligation with no verification date
beside it should be read as unverified, not as done. Three of these four sat that way for weeks.

---

## 1. Consent granted to one centre is written to every centre that parent touches

**Read this one first.** It is a cross-tenant write on consent data, the category Adsero calls
sensitive, and it is the same shape as the cross-tenant hole closed in July. Entry 2 ignores a
parent's opt-out; **this one manufactures an opt-in they never gave.** That is worse, and the fix is
one line.

A parent taps the Arabic consent button in a WhatsApp thread. `src/app/api/whatsapp/webhook/route.ts:350`
then runs:

```ts
.from('students')
.select('id, center_id')
.eq('parent_phone', normalized)
.eq('parent_consent_given', false)
```

**No `center_id` filter**, although `centerId` is in scope and used two lines earlier for
`wa_conversations`. The loop at `:362` sets `parent_consent_given`, `parent_consent_at` and
`parent_phone_verified` on every row returned, **and inserts a `parent_portal_tokens` row for each**.

A parent with children at two centres who agrees in Centre A's thread has consent recorded at Centre
B, which never asked. Centre B's send gate (`src/lib/whatsapp/flows/parentNotifications.ts:174`
filters `parent_consent_given = true`) then opens, so Centre B begins sending consent-gated, billed
WhatsApp messages on the strength of an agreement given to someone else. Portal tokens cross the same
boundary.

**Nobody is affected yet.** Live catalog, 6 August 2026: **zero** parent phone numbers appear at more
than one centre. Real in code, no violation produced, which is a very different conversation with
Adsero than the alternative.

**Not remotely forgeable, checked because it would have changed the priority.** This route *is* on
`PUBLIC_WEBHOOK_PREFIXES` (`proxy.ts:32`), so it is exempt from the Origin check that entry 13
describes. That exemption is paid for: the route verifies a Meta-signed HMAC and **fails closed at
all three gates** — missing `WHATSAPP_APP_SECRET` returns 401 at `:411`, missing
`x-hub-signature-256` returns 401 at `:416`, and a mismatch returns 401 at `:428` after a
timing-safe compare. So this is reachable only by a real parent tapping the button in a genuine Meta
delivery. **Entry 1 and entry 13 do not compound**, and either can be fixed alone.

This is obligation 3 of the four the platform owns, and it touches obligation 4. Both are now
recorded in `docs/LEGAL-STATUS.md`.

*Touches consent and tenancy. Source: `SURVEY-Verification-Payouts.md` follow-through and the
consent obligations list. Verified 6 August 2026.*

---

## 2. A consent control exists, is recorded, is shown back, and is overridden

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

## 3. Erasure strips the student row and leaves the parent's phone in nine other tables

**Obligation 1 of the four the platform owns. Better built than feared, and incomplete.**

Three questions were asked of it.

**Does a self-serve delete path exist?** No. There is a public request form
(`src/app/api/privacy-request/route.ts`, service-role insert, `status` server-set to `'pending'`)
and an admin action (`src/app/api/admin/privacy-requests/anonymize/route.ts`). A subject cannot
erase anything themselves; a human has to act. No SLA, timer or escalation exists in code, so a
request sits at `pending` until someone looks.

**Does it actually erase, or set a flag?** It genuinely erases. `:89-102` sets `name` to `'[erased]'`
and nulls `phone`, `parent_phone`, `qr_code`, `qr_data`, `qr_code_data` and `grade_level`, resets
`parent_phone_verified` and `parent_consent_given`, and marks the row inactive with
`inactive_reason: 'anonymized'`. `student_notes` rows are deleted outright and
`student_group_notes.note` is blanked. A de-identified audit row is written. This is not a flag.

**Does it respect the tax retention carve-out?** Yes, deliberately. The comment at `:86` reads
*"Strip every personal/identifying field; keep the row + financial links."* Keeping the row is what
preserves referential integrity for invoices, payments and attendance, which is exactly the right
shape.

**The most dangerous thing here is the comment.** Line 86 reads *"Strip every personal/identifying
field; keep the row + financial links."* It sits directly above code that strips exactly one table
plus two notes tables. **A reviewer reads the comment, sees correct-looking code beneath it, and
signs off without counting the tables.** This is the third instance of a check that measures the wrong
thing, after the `substring(-11)` phone compare and the schema-drift gate that cannot see a REVOKE,
both recorded in `docs/WORKING-RULES.md` as the failure pattern to look for first. A wrong comment on plausible code is how a gap survives review.

**What it actually leaves behind.** It strips the `students` row and two notes tables. Verified against the catalog, **at least nine other tables
still hold that parent's phone number afterwards**: `families.parent_phone`,
`paid_parents.parent_phone`, `parent_pack_monthly_counts.parent_phone`,
`pending_enrollments.parent_phone`, `wa_conversations.contact_phone`, `wa_message_queue.to_phone`,
`wa_onboarding_schedule.to_phone`, `whatsapp_messages.to_phone`, and `whatsapp_usage.parent_phone`
plus `whatsapp_usage.to_phone`.

**`parent_portal_tokens` is not revoked either.** The route never touches that table, so a live,
unexpired portal token keyed to the erased student keeps resolving. **Obligation 4's revocation
capability exists and is not invoked at the exact moment it exists for.** Short-lived revokable links
are worth nothing if the one event that must revoke them does not.

**It handles one student per call, so partial erasure is the default.** The body is
`{ requestId, studentId }`. **A parent with three children gets one child forgotten. Nobody asked for
that.** An erasure request is made by a person about their family, and the route models it as an
operation on a row. `students.sibling_family_id` exists and is not consulted. Partial erasure is the
default outcome here, not an edge case.

**Nobody has exercised the right.** Live catalog, 6 August 2026: `privacy_requests` holds **0** rows.
So this is a pre-launch fix, not a disclosure.

**The acknowledgement is switched off, not missing, and that distinction changes the work.**
`src/lib/privacyRequestConfirmation.ts` exists and `api/privacy-request/route.ts:166` calls it on
every submission, immediately, which would satisfy the drafts' 5-business-day promise comfortably. It
is gated on `platform_config.privacy_request_confirmation_wa_template`, and **that key has no row in
the live table** (verified 6 August 2026), so it returns `template_not_configured` and never sends.
The fix is a Meta template approval plus one config row, not a build. It is the cheapest of the four
obligations to close and the only one with a written deadline already attached.

Two caveats keep it a real gap:

- **It is WhatsApp-only.** The file notes an email path as not built.
- **A requester who leaves an email and no phone gets nothing at all.** No acknowledgement by any
  channel, and the form accepts that combination.

**The route's honesty here is deliberate and should not be "tidied".** `confirmationSent` comes back
from the send attempt and drives which sentence the confirmation screen shows, with the comment at
`:162` stating it "must never be optimistic". So a parent whose acknowledgement did not send is told
the truth rather than shown a reassuring screen. **Most systems would render the confirmation
regardless.** Anyone editing that route later should know the honesty is a decision, not an
oversight, and that making the screen unconditional would turn a visible gap into a silent one.

**No false statement found in live copy**, which was the specific risk. The only data-rights
sentence in shipped content (`src/app/[locale]/legal/legalContent.ts:163`) tells the subject to go to
their centre first and use the platform form if the centre cannot help, which matches the
processor/controller split. The thirty-day erasure window quoted in older material appears nowhere in
live copy. It may still be in the Adsero drafts, which are not in this repository and therefore
cannot be checked here. **Check it at rewrite**, because promising thirty days against a queue with
no timer is how this becomes a false statement rather than a gap.

*Touches consent and privacy. Source: consent obligations list, obligation 1. Verified 6 August 2026.*

---

---

## 4. `requireSuperAdminRow` does not require a row

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

## 5. Every centre is capped at two team members and told it is on Starter

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

## 6. The scanner billing pipeline, five live faults from one vocabulary mismatch

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

## 7. Every card-order checkout returns 500, and it is the write path

Entry 10 recorded that `card_orders.card_style` does not exist and the vendor PDF 404s on read. **The
write path is broken too, and it is upstream of everything else.**

`src/app/api/card-order-cart/checkout/route.ts:189` builds the insert with
`card_style: cart.card_style` and inserts straight into `card_orders`. The column does not exist
(catalog: 0), so PostgREST errors and the route returns `500 insert_failed`. **Every checkout
attempt, for every centre, unconditionally.** There is no path around it: `:99-100` *requires* a
valid `card_style` and 400s without one, so the request cannot reach the insert with the field
omitted.

**No customer has hit it.** Live catalog, 6 August 2026: `card_orders` holds 0 rows and **0 of 2
centres have `card_orders_enabled`**. The bug is 100% reproducing and fires on the first centre
anyone flips the flag for. Card orders are parked, which is the only reason this is not an outage.

*Source: `BUILD-AFTER-REDESIGN.md` F28. Verified 6 August 2026.*

---

---

## 8. The centre all-in rate is computed five ways and three of them are wrong

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

## 9. The early-adopter badge contradicts the number beside it

**`src/app/[locale]/(dashboard)/billing/BillingPageClient.tsx:344`** renders the "Early adopter" chip
from `center.is_early_adopter`, directly beside `displayAmount` computed at `:298-301`, which never
consults the early-adopter price. **The badge and the number disagree by construction**, not by
timing or by data.

*Source: `SURVEY-Center-Money.md`. Verified 6 August 2026.*

---

## 10. `/api/settings/limits` returns 404 for every centre, always

**`src/app/api/settings/limits/route.ts:18`** selects `max_teachers, max_students, plan`. Neither
`centers.max_teachers` nor `centers.max_students` exists (catalog: 0 and 0). The select errors,
`centerError` is truthy, and the route returns 404 "Center not found" before it counts anything. The
endpoint cannot succeed under any conditions.

*Source: `BUILD-AFTER-REDESIGN.md` F26 #2. Verified 6 August 2026.*

---

## 11. Every vendor print PDF for every card order is dead

**`src/app/api/admin/card-orders/[orderId]/pdf/route.ts:33`** selects `card_style`.
**`card_orders.card_style` does not exist** (catalog: 0). The select errors and the route returns
404 unconditionally.

This one cannot be fixed by deleting the read. **The checkout path writes `card_style`**
(`api/card-order-cart/checkout/route.ts`) and five sites read it. A whole feature was built against
a column that was never added, so removing the reads means deciding the card style option does not
exist. Card orders are parked, which lowers the urgency but not the fact.

*Source: `BUILD-AFTER-REDESIGN.md` F26 #1. Verified 6 August 2026.*

---

## 12. `bosta_shipments` is queried and does not exist

**`src/lib/loadCardOrderDetail.ts:72`** runs
`admin.from('bosta_shipments').select('*').eq('card_order_id', id).maybeSingle()`.
**The table does not exist** (catalog: 0).

*Source: `BUILD-AFTER-REDESIGN.md` F26. Verified 6 August 2026.*

---

## 13. Four CEO and admin mutation routes have no CSRF check, including a platform kill switch

`POST /api/ceo/leads`, `PATCH /api/ceo/actions/[id]`, `PATCH /api/ceo/platform-config` and
`PATCH /api/admin/centers/[id]` contain **zero** `validateCSRFRequest` calls. Sibling routes have
them: `api/admin/centers/route.ts` has 4 and `.../subscription/suspend/route.ts` has 2.

`platform-config` flips `maintenance_mode`, `wa_sending_enabled`, `read_only_mode` and `cron_paused`
platform-wide. `admin/centers/[id]` handles invoices, blacklisting, plan overrides and cancellations.
`getAdminContext` falls back to a cookie session at `src/lib/admin-auth.ts:51` when no Bearer token
is present, which is precisely the situation CSRF protection exists for.

**It is not exploitable today, and the reason matters.** `src/proxy.ts:210` rejects
POST/PUT/PATCH/DELETE to `/api/*` carrying a disallowed `Origin`, and `:207` rejects the preflight.
Every browser-reachable cross-site vector against these four sends `Origin`: a cross-site `PATCH` via
fetch triggers a preflight, and a cross-site form `POST` to the one POST route sends it too. So the
middleware is currently doing the job the missing call would do.

**The risk is that one control is now load-bearing alone.** `isAllowedCorsOrigin` returns `true` for
an absent `Origin` (`proxy.ts:61`), by design for server-to-server calls, and `:211` exempts
`PUBLIC_WEBHOOK_PREFIXES` from the check entirely. **Any route added to that allowlist without its
own CSRF call is genuinely open**, which is worth holding in mind because the #322 removal edits that
same list.

**Not a trivial add.** The CEO client helper `getAuthJsonHeaders()` never sends `X-CSRF-Token` or
`X-Session-ID`, so adding server-side validation alone breaks the UI. Both sides land together.

**Do not read "exempt from the Origin check" as "unprotected".** `PUBLIC_WEBHOOK_PREFIXES` exists
because the callers have no session with us, and every entry on it pays for the exemption with a
stronger control of its own. `/api/whatsapp/webhook` verifies a Meta-signed HMAC and fails closed on
a missing secret, a missing signature header and a mismatch, all three returning 401 (`:411`, `:416`,
`:428`). `/api/webhooks/payout-provider` rejects with 503 while its secret is a placeholder. **The
danger is not the list, it is adding a route to it without that substitute control**, which is why
entry 1's cross-tenant write is not forgeable and why the #322 removal must delete the two entries it
orphans.

*Touches auth and account state. Source: `BUILD-AFTER-REDESIGN.md` S9. Verified 6 August 2026.*

---

---

## 14. `src/lib/tokens.ts` is a stale dark-theme mirror with 20 consumers

The app is light-only. This file still holds the pre-cream dark palette: `surface[0]` and
`neutral[950]` are `#080f1a`, `text.primary` and `neutral[50]` are `#f8fafc`. Its own header says
*"Source of truth is always globals.css @theme - keep in sync manually"*, and it was not kept in
sync.

**20 files import it**, so this is not a dead file to delete quietly. It matters now rather than
later because `TOKEN-SPEC.md` step 2 wires the token layer into the app in one PR, and a second,
stale, hand-maintained palette with 20 consumers is exactly the "one number with two sources" shape
that step is meant to end. Resolve it in that PR, not after. Check `chartColors` consumers first.

*Source: `BUILD-AFTER-REDESIGN.md` F8. Verified 6 August 2026.*

---

---

## 15. `center_invites.status` does not exist

Catalog: 0. Any invite flow that filters or transitions on invite status has nothing to read or
write.

*Source: `BUILD-AFTER-REDESIGN.md` F19. Verified 6 August 2026.*

---

## 16. `subjects.is_active` does not exist, and neither does any grades table

Catalog: `public.subjects` carries no `is_active` column, and no grades table exists in `public`. Any
subject on/off control and the entire grades concept have no backing schema.

*Source: `BUILD-AFTER-REDESIGN.md` F33. Verified 6 August 2026.*

---

## 17. `student_groups.teacher_split_pct` and `assign_teacher_to_group` are dead

The column exists in the catalog and has **zero** references anywhere in `src/`. The RPC
`assign_teacher_to_group` likewise has **zero** references. Dead schema carrying an implied teacher
revenue split that nothing computes.

*Source: `BUILD-AFTER-REDESIGN.md` F9. Verified 6 August 2026.*

---

## 18. `student_groups.capacity_cap` is dead

The column exists in the catalog and has **zero** references anywhere in `src/`.

*Source: `BUILD-AFTER-REDESIGN.md` F11. Verified 6 August 2026.*

---

## 19. The audit seed is unreachable, and the migration history says it ran

`scripts/audit/seed-prod.sh:7` runs `supabase db push`, but the seed lives at
`supabase/migrations_archive/20260507120000_seed_audit_accounts.sql`, outside the folder `db push`
reads. **The script is a no-op.**

Worse, and verified live: the version **is** recorded in `supabase_migrations.schema_migrations`
while `auth.users` holds **zero** `aaaaaaaa-…` ids. Bookkeeping says applied, the catalog says the
rows are gone. Moving the file back would not re-run it either, because the version is already in the
history. **This is the same trap as entry 20 from the other direction**: there, a name that did not
match a filename; here, a version present in history for rows that do not exist.

**Consequence.** Without a reachable test tenant there is no real dashboard to screenshot, which is
why at least one restyle PR shipped without one. That matters directly for the re-diff: Stage 4
compares rendered output.

**Needs a decision, not a fix.** The seed also inserts a `super_admin` on `+201111111111` with PIN
`111111`, documented in a checked-in README, which is a plausible reason the rows were torn down
deliberately. If it is re-seeded, seed the owner half only.

*Source: `BUILD-AFTER-REDESIGN.md` F6. Verified 6 August 2026.*

---

---

## 20. `students.payment_status` and `students.fee` are still live and still misleading

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

## 21. A migration filename is not its recorded version, so absence proves nothing

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

---

---

## 22. A literal comma is the missing-value placeholder in 127 places

`?? ','` and `|| ','` appear **127 times across 29 files**, rendering a bare comma to the user
wherever a value is absent: `{swVer ?? ','}` in `SyncStatusPanel.tsx:165`,
`String(it.student_name ?? ',')` in `AdminCardOrderDetailClient.tsx:375`, `raw ?? ','` in
`BillingPageClient.tsx:242`, and so on. Cosmetic individually, and at 127 sites it is a house style
nobody chose.

**The interaction worth knowing.** `src/lib/placeholderValue.ts` was written to fix exactly this, and
it is inside the #322 dead set: its only consumer is `valifyConfig.ts`, so **stage C of the removal
plan deletes the intended fix along with the dead model.** Either lift it out before stage C or
accept that the replacement has to be rewritten afterwards. Recorded so that is a decision rather
than a discovery.

*Source: `BUILD-AFTER-REDESIGN.md` F29. Verified 6 August 2026.*

---

---

---

## 23. `centers.status` and `centers.subscription_status` are two columns, one load-bearing

`centers` carries both. **The middleware reads `status`, not `subscription_status`.** `proxy.ts:384`
branches on `center?.status === 'suspended'`, and the separate subscription check at `:429` reads the
**`subscriptions` table**, not the similarly-named column on `centers`.

Test Center 333 has `subscription_status = 'suspended'` and `status = 'active'`, with no row in
`subscriptions`. **It is not suspended in any sense the app acts on**, despite a column saying it is.
Reading the wrong one gives the opposite answer, and both names are plausible.

I made this exact mistake mid-check while answering whether the re-diff could run against that
centre, and caught it only by opening `proxy.ts` instead of trusting the column name. **This is the
fourth check-measuring-the-wrong-thing in this pass**, after the `substring(-11)` phone compare, the
schema-drift gate that cannot see a REVOKE, and the erasure comment that claims more than the code
does. Two columns whose names are near-synonyms, one of which decides whether a centre can use the
product, is a trap that will be sprung again.

**What to establish, and it is not answered here:** whether `centers.subscription_status` has any
live reader at all, or is a third source of truth for a state already held in two places.

*Source: verification of the re-diff readiness question. Verified 6 August 2026.*

---

---

## 24. Lifecycle is earned from scan history, and two junction tables disagree about membership

**`trg_recalc_lifecycle_on_scan` recomputes `students.lifecycle_status` from scan history.** Setting
the column directly does not hold: inserting recent scans for a student promotes `enrolled` and
`at_risk` to `active`, correctly, and the only way back is to change the scan history. Confirmed on
6 August 2026 while seeding, by the trigger firing and overriding the intended states.

**Consequence for anyone constructing test data or reasoning about a state:** lifecycle is a
derived value, not a settable one. A screen showing `at_risk` is making a claim about attendance, and
changing it means changing attendance.

**Separately, student-to-group membership lives in two tables that do not agree.** Live counts for
Test Center 333 on 6 August 2026: `student_group_members` **16** rows, `enrollments` **15**, with
**2** pairs present in the first and absent from the second and **1** the other way round. They are
not a copy of each other in either direction.

They are split by subsystem rather than duplicated by accident: `enrollments` is read by 23 sites,
almost all under `api/teacher/private/*`, and `student_group_members` by 15 sites, all centre-side
(`students/print`, `parent/portal`, `term-summary`, `cron/daily-summary`, `cron/parent-absence-alerts`,
`center/group-proposals`). **The boundary is real but nothing enforces it**, so a row written to one
and not the other is invisible until two screens disagree about whether a student is in a group.

*Touches tenancy and data integrity. Verified 6 August 2026.*

---

---

## 25. Arabic typography is a product rule, not a per-file one. Twelve design files use an older shorthand

**Ruled 6 August 2026. Recorded here so it is not re-litigated on file 9 of 12.**

`tutoringhq-public-design-system.md` §7 says an Arabic frame carries `dir="rtl"` **and**
`class="ar"`, and that the `.ar` overrides are what switch the face, drop IBM Plex Mono for weight
600, and reset tracking to `0`/`.02em`. `TOKEN-SPEC.md` §2 adds the one-step size bump for
`text-xs` through `text-base`, headings unchanged.

**Twelve of the 25 files express RTL with `dir="rtl"` alone**, with an inline `font-family` and no
`.ar` class and no `.ar` CSS. Verified by counting `.ar` rule definitions in every file:

**No `.ar` rules (12):** Admin-Accounts, Admin-Money, Admin-Platform, CEO, Center-Groups,
Center-Orders, Center-Students, Center-WhatsApp, Lifecycle, Teacher-Groups, Teacher-Setup,
Teacher-Students.

**Has `.ar` rules (13):** Center-Attendance, Center-Home, Center-Insight, Center-Money, Center-Setup,
Design-Patterns, Public-App, Public-Legal, Public-Marketing, Teacher-Home, Teacher-Insight,
Teacher-Money, Teacher-WhatsApp.

The split is by age, not by intent. The twelve predate the convention; the thirteen were rebuilt with
it.

### The ruling

**Mirror from `dir="rtl"`, and apply the Arabic typography rules from `TOKEN-SPEC.md` §2 in every
case, whether or not the design file carries `class="ar"`.**

Dropping mono for weight 600, resetting tracking and the one-step size bump are rules about **the
product**. A design file that expresses RTL with `dir` alone is using an older shorthand; it is not
granting permission to skip them. **An Arabic screen rendering IBM Plex Mono digits is wrong whether
or not the drawing said so.**

This is a property of the design set, not a decision to take per file. Do not raise it again as a
per-file question.

*Source: re-diff preparation, Center-Groups and Center-Students. Verified across all 25 files
6 August 2026.*

---

---

## 26. Count `class="phone"`. Two people measured the wrapper on the same day

**The fifth check-measuring-the-wrong-thing in this pass, and the first that happened to two people
independently, in the same file set, within hours.**

| Who | Counted | Lost | Why |
|---|---|---|---|
| Eyad | `class="cap"` | **151 of 503** | The older files carry no caption element at all. `Center-Groups` and `Center-Students` have **zero** `class="cap"` between them |
| This session | `class="frame"` | **8 of 503** | `Merged-Public-Marketing` nests **12** `class="phone"` inside a single `class="phones"` container and uses only 4 `.frame` wrappers |

Both counts were of a **wrapper** that usually accompanies a frame rather than of the frame itself.
Both were wrong in the same direction, undercounting, and both looked plausible because the wrapper
is present most of the time. Neither error was detectable from its own output: 276 and 352 are both
believable frame totals. **Mine only surfaced because `Public-Marketing` produced `EN = -2`, an
impossible number** — the arithmetic broke before the assumption did.

**The rule: `class="phone"` is the frame. Count that and nothing else.** It is the one element
present exactly once per frame in all 25 files, verified. `.frame`, `.cap` and `.ar` are all optional
decoration that varies by file age.

**Why the rule exists, which matters more than the rule.** Neither of us had a number that looked
wrong. 276 and 352 are both entirely plausible frame totals for this set, so no amount of staring at
either would have exposed the selector. **A plausible total hides a bad selector. An impossible
intermediate exposes it.** Mine broke only because `Public-Marketing` yielded `EN = frames − AR = -2`,
and a negative count of English frames cannot be explained away. The arithmetic failed before the
assumption did, and that is the only reason the selector was ever questioned.

So the practical habit is not "count carefully". It is **derive a value that has a floor and check the
floor**: a subtraction that cannot go negative, a sum that must equal a known total, a ratio with a
known bound. A total you cannot sanity-check is a total you cannot trust, however carefully you
counted it.

When a count feels routine, the thing being counted is usually a proxy for the thing that matters,
and a proxy that holds in most files is the hardest kind to catch.

*Source: re-diff frame enumeration. Verified across all 25 files 6 August 2026.*

---

## 27. The room-clash guard is correct. Nothing stops a slot that ends before it starts, and such a slot switches the guard off

**The guard itself passes.** Extracted verbatim from `schedule/page.tsx` (lines 220–229 and 478–504,
sliced by line range rather than retyped) and run against the 9 live `schedule_slots` rows of Test
Center 333, plus 9 synthetic cases.

| Check | Result |
|---|---|
| Live rows: flagged set vs. independently computed overlap set | **9 of 9 rows agree.** 1 overlapping pair found, 2 slots flagged, expected 2 |
| Negative control — Wed 09:00–11:00 and Wed 14:00–16:00, both Room 3 | **Correctly not flagged.** Rules out a guard comparing only room + day |
| Room 2 appears on Sun ×2, Tue, Thu | Only the Sunday pair flags. No cross-day false positive |
| Synthetic edge cases (null rooms ×2, touching intervals, 1-minute overlap, containment, identical times, `day_of_week` as text, three-way pile-up) | **9 of 9 behave as expected** |

F38 is genuinely closed: two room-less overlapping slots do not flag, and one room-less against one
roomed does not flag.

**The hole is upstream of the guard, in what may be stored.** A slot with `end_time` before
`start_time` — 23:00–01:00 — makes `timeToMinutes(end)` *smaller* than `timeToMinutes(start)` (60 vs.
1380). The overlap test `a1 < b2 && a2 < b1` then evaluates `a2 < 60`, false for every slot starting
after 01:00. **The slot stops clashing with anything.** A 23:30–23:45 booking in the same room on the
same day is not flagged, and the room silently loses double-booking protection for that day.

Nothing rejects such a row at any of the three layers:

| Layer | What was checked | Result |
|---|---|---|
| Client | `handleAddSlot`, `schedule/page.tsx:532–548` | Requires group + room, checks `hasConflict`. **No end-after-start check.** Both inputs (`:1358`, `:1367`) are bare `<input type="time">` with no relative `min`/`max` |
| Server | `dbInsertSchemas` in `validations.ts:323` | **5 keys** — `attendance_overrides`, `students`, `student_groups`, `payments`, `card_orders`. `schedule_slots` is not one of them, so `api/db/route.ts:132` finds no schema and validates nothing. `dbProxyScope.ts:35` scopes it by `center_id` only, which is tenancy, not shape |
| Database | `pg_constraint` where `contype = 'c'` on `schedule_slots` | **0 rows.** No CHECK constraint of any kind |

**Proven by write, not by inference.** The three-layer read above was upgraded to a live probe: an
`INSERT` into `schedule_slots` for day 6, `23:00` to `01:00`, was **accepted — 1 row**. The row was
then deleted and the centre re-counted from the catalog independently of the probe: **9 slots, 0 rows
with `end_time <= start_time`, 0 rows on day 6, 0 CHECK constraints.** Clean. So every layer is now an
executed fact rather than a reading: the client has no relative `min`/`max`, the server has no
`schedule_slots` entry in `dbInsertSchemas`, and the database has no constraint. **Nothing anywhere
rejects a slot that ends before it starts.**

**The cleanup itself produced a sixth wrong-thing instance.** The first probe put the `DELETE` in a
CTE alongside the `INSERT`. Both arms of a data-modifying CTE read the **same pre-statement snapshot**,
so the `DELETE` could not see the row the `INSERT` was creating and removed nothing. The statement
reported success and the probe row survived; it took a separate `DELETE` to clear it. Same family as
the rest of this list — the statement did exactly what was written, and what was written measured a
snapshot that did not contain the target yet. A cleanup that reports success is not a cleanup that
happened; **re-count from the catalog afterwards**, which is what caught it.

**The fix needs a product decision before a constraint.** `CHECK (end_time > start_time)` is the
obvious shape and it is proposed with the Branches migration, not applied. But it only holds if this
product never supports a genuinely overnight session. **If overnight sessions are ever a thing, the
constraint is wrong and the guard is what needs changing** — it would need the wrap-around case,
comparing across a midnight boundary rather than forbidding one. Decide that first; the two fixes are
mutually exclusive.

*Source: `.rediff/build-guard.mjs` → `.rediff/run-guard.mts`, `.rediff/edge-guard.mts`, live catalog,
live insert/delete probe. 7 August 2026.*

---

## 33. BLOCKS THE INSTAPAY BUILD — the balance counts unconfirmed transfers as money in hand

**Not a screen defect. A violation of the rule the InstaPay flow exists to enforce, in the code the
flow will read on its first day.**

`design/NEW-MODEL.md:118` — *"**Never claim the platform verified a payment.** It read an image and
compared it to an invoice. **Only the provider can confirm money arrived**, by looking at their own
account. Every screen says so."*

`src/lib/studentBalance.ts:154` sums payments whose status is in `PAID_PAYMENT_STATUSES`, a set its
own comment describes as *"confirmed + pending + paid"*. **`pending` is the status of a transfer a
parent has claimed and nobody has confirmed.** It is the exact state the model forbids treating as
money, and the balance treats it as money.

This is live today and it is not theoretical. Verified across all 16 students in Test Center 333:

| Student | Truly owes | App shows | Payment row |
|---|---|---|---|
| Adam Sherif | **600 owed** | **1,800 credit** | `status='pending'`, `confirmed=false` |
| Karim Fawzy | 0, settled | **3,200 credit** | `status='pending'`, **`confirmed=true`** |

**These are two different faults, not one fault twice.** Only Adam's row is this entry: genuinely
unconfirmed, counted as collected, flipping 600 owed into an 1,800 credit. Karim's row is
`confirmed=true` with a `pending` status — a contradictory pair (see entry 35). If its boolean is the
truth, his credit is arithmetically correct and not a defect at all.

### CORRECTION — the "App shows" column is what the helper computes, NOT what the screen renders

**The screen shows neither figure. It shows `0`.** Rendering `/en/students/<id>` for both Adam Sherif
and Sara Ahmed gives `Balance 0 EGP · Paid up` and `Lifetime paid 0 EGP` — a `Paid` chip in both
cases. The 1,800 and 3,200 credits above are what `studentBalance.ts` *would* return from the catalog;
they are not on screen.

**Sara Ahmed disproves the pending explanation on her own.** She has exactly one payment — cash,
`status='paid'`, `confirmed=true`, 2,400 — against 4,800 of charges. **No pending row exists for her.**
She genuinely owes 2,400 and the screen says `Paid up · 0 EGP`. Entry 33's mechanism cannot produce
that.

So there are **two stacked defects**, and the one that reaches the user is the second:

1. `pending` counted as collected — real, verified, and it will dominate once the InstaPay flow
   creates pending rows at volume. **Still blocking.**
2. **Something zeroes the balance on the detail page for every student tested**, and `?? 0` renders
   that as a confident `0 EGP · Paid up`.

**Mechanism of the second is not yet established and is not guessed here.** What is known: every
`/api/db` call on the page returns **200**, so it is not a failed request; and `Lifetime paid` — which
sums confirmed payments and is independent of all attendance-scan logic — reads `0` for a student
holding one confirmed 2,400 payment. **That points at the payments arm of the helper rather than the
charge arm.** The roster agrees, reporting `Unpaid 0 · 0 EGP due` centre-wide.

This is the more urgent of the two: it is live now, on every student, with no InstaPay flow required,
and `?? 0` makes it indistinguishable from a settled account.

Centre-wide, outstanding reads **15,650 EGP against a true 16,250**, and Adam disappears from the
overdue list entirely.

### The stated justification is stale, so the fix is smaller than the comment implies

`studentBalance.ts:24` defends including `pending`: *"nothing auto-confirms pending, so gating on
'confirmed' would overstate debt forever."*

**That is no longer true.** `src/app/api/payments/confirm/route.ts:50–61` is a live confirmation path
and it writes `status: 'confirmed'` and `confirmed: true` together. The reason for the violation has
been gone since that route landed, and the comment has outlived it — **entry 30's shape exactly, in a
money helper: a frozen justification that nobody re-ran.**

So the remedy needs no new infrastructure. Narrow the status set. Note while doing it that **zero of
the 30 payment rows in the catalog carry `status='confirmed'`** — the status the helper lists first
and the confirm route writes matches nothing today, so the route appears never to have been exercised.

### Blast radius — 22 files, and it leaves the screen

`getStudentBalances` / `studentBalance` is consumed by **22 files**, including:

`api/cron/parent-balance-alerts` · `api/whatsapp/send-balance-reminder` · `api/students/at-risk` ·
`api/analytics/revenue` · `api/payments/stats` · `api/dashboard/stats` · `api/parent/portal` ·
`components/analytics/AgingReport.tsx` · `components/PrintStatementModal.tsx` · `lib/excel-export.ts`

So an unconfirmed transfer does not merely mis-render a card. **It suppresses the parent's balance
reminder, removes the student from at-risk detection, understates revenue and aging, and prints a
wrong statement.** A debt the centre never chases because the platform recorded an unverified claim
as money is the precise failure the model's confirmation rule exists to prevent.

**Why it blocks rather than waits.** Today only two students carry a pending payment because only two
were seeded that way. The InstaPay flow's *entire purpose* is to create that state — one row per
uploaded receipt, held unconfirmed until the centre checks its own account. **Every upload would
inflate the payer's balance the moment the flow ships**, and the more the feature is used the more
wrong the number gets. Shipping the flow onto this helper converts a two-row seeding artefact into
the normal case.

Note for the fix: **negative balances are legitimate.** Five students hold genuine credits (−500,
−1,800, −2,800, −3,600, −3,900) from real overpayment, so clamping negatives to zero is not the
remedy. `pending` must be excluded from the collected sum, not the result floored.

### The second half: `?? 0` on a money field

`src/app/[locale]/students/[id]/page.tsx:329` sets the card from `b?.balance ?? 0`, and the lifetime
figure the same way, inside a `.catch`-wrapped best-effort load. **A failed load renders as a real
`0 EGP`.** A settled account and a balance that did not load are pixel-identical, and the default is
the reassuring one.

`NEW-MODEL.md:122` — *"**Never tell a parent they did not pay.** A failed read is a system problem,
not an accusation."* The same principle inverts here and is broken in the other direction: **a failed
read becomes the factual claim "nothing is owed."** A system problem is rendered as a settled account.

Both halves must be fixed before the InstaPay flow is built on this helper, not after.

### What the screen looked like when this surfaced

Found by rendering, not reading. The summary and the list on the same screen disagreed, and the list
was right.

Adam Sherif, `/en/students/6c8deb63…`, rendered at 390px:

| On screen | In the catalog |
|---|---|
| `Balance 0 EGP · Paid up` | **2,400 EGP outstanding** — one `pending`, unconfirmed InstaPay payment dated 5 Aug 2026 |
| `Lifetime paid 0 EGP since Aug 2026` | **4,800 EGP** — two `paid`, confirmed payments (instapay 22 Jul, cash 8 Jul) |
| Payments list: `2,400 EGP Unpaid`, `2,400 EGP Paid`, `2,400 EGP Paid` | **Correct.** All three rows match the catalog exactly |

The same zero propagates to the roster: `/en/students` reports **`Unpaid 0 · 0 EGP due`** for a centre
holding an outstanding 2,400.

**Two separate mechanisms, both verified in code.**

1. `src/lib/studentBalance.ts:154` sums payments whose status is in `PAID_PAYMENT_STATUSES`, and its
   own comment says that set is *"confirmed + pending + paid"*. **A `pending`, unconfirmed payment is
   therefore counted as money collected** and cancels the charge it has not yet settled.
   **Under the new model this is exactly backwards.** The platform's whole job is to *record and match*
   a parent's InstaPay transfer; an unmatched transfer is the one state that must not read as paid.
2. `src/app/[locale]/students/[id]/page.tsx:329` sets the card from `b?.balance ?? 0`, and the sibling
   lifetime figure the same way. **An absent value renders as a real `0 EGP`**, indistinguishable from
   a genuine zero. The load is `.catch`-wrapped and best-effort, so a partial failure is silent.

The second is the more dangerous shape and it is a money field: **`?? 0` turns "we do not know" into
"you are owed nothing".** A student who owes money and a student whose balance failed to load are
rendered identically, and the reassuring one is the default.

Design frame 6 draws `Lifetime paid 4,800 EGP since Sep 2025`, so the field is specified to sum
confirmed payments. It has the right shape and the wrong number.

*Source: rendered `/en/students/6c8deb63…` in both locales, checked against `payments` in the live
catalog. 7 August 2026.*

---

## 32. Design-set corrections — settled rulings, so file 9 does not re-ask them

**A divergence between a design frame and the live app is not automatically an app defect.** Six of
the first ten frames diffed turned out to be the *drawing* being stale. Ruled by Eyad 7 August 2026 on
the `Center-Groups` / `Center-Students` diff; recorded here because the same questions recur on every
remaining file.

### The design is stale. Do not change the app, do not re-raise.

| Drawn | Live | Ruling |
|---|---|---|
| `300 EGP/mo` | `650 EGP per lesson` | **Per-lesson is the locked model, monthly is dead.** Live is right |
| `Mr. Sherif · center 30%` | absent | **The percentage model is gone. Do not build the line at all** |
| Week starts Sunday | Week starts Saturday | **Saturday is correct for Egypt.** The design is wrong |
| No subject icons, no capacity bar, plain rows | icons, capacity bar, `⋮` / `›` | **Live additions that improve on the drawing. Keep them** |
| `أحد إثنين ثلاثاء …` full day names | `س ح ن ث ر خ ج` | **Keep the single letters.** Conventional, and they fit the strip. The design is impractical here |
| `الغرف` *(from the app)* | — | **`القاعات` wins.** A tutoring centre has halls, not generic rooms — the app must change to match the design on this one |

Note on the fee column: `student_groups.fee_per_class` is the live billing column and it renders.
`groups.monthly_fee` is a **different table's** column carrying the dead monthly model. Both exist in
the catalog; only the first is read by the groups list. Do not conflate them.

`center_cut_egp` is **populated on all seven groups** in Test Center 333 (45, 50, 40, 60, 10, 30, 30).
"Do not build the attribution line" therefore leaves a live, non-null column with **no reader**. That
is a loose end for the percentage-model removal, not a display question.

### The app is wrong. These are defects to fix.

| Defect | Evidence |
|---|---|
| **`Grade Grade 10`** | The UI prefixes `Grade` onto data that already contains it. Visible on every student row with a grade, both locales |
| **`across 1 branches`** | No pluralisation. English needs singular/plural |
| **`في ١ فروع`** | Worse than the English. **Arabic has dual and plural forms, not just singular and plural** — a two-form fix is not enough here |
| **`ادفع لكل درس`** | Imperative verb where a preposition belongs. `ar.json:5586` and `:6407`. Must read **`لكل حصة`** — and **`حصة`, not `درس`**, because that is the word the rest of the product uses |
| **No `At risk` filter** | Design draws `All standing / Paid / At risk / Overdue`; live has `All / Behind / Paid up`. **`lifecycle_status` carries five live states in one centre** — `active`, `at_risk`, `inactive`, `churned`, `enrolled` — and `at_risk` holds two students right now (Ali Mostafa, Sara Ahmed). The live chips filter *payment standing*, a different axis, so lifecycle has **no filter at all**. This is wider than one missing chip |
| **Import copy dropped a requirement** | The design's *"Only student name and parent phone are required"* is gone from `/students/import`. **That sentence prevents support tickets.** Put it back |

*Source: rendered diff of `Merged-Center-Groups` and `Merged-Center-Students` against the live app at
390px, plus live catalog. Ruled 7 August 2026.*

---

## 30. A live measurement written into a code comment is a number nobody re-runs

The comment at `schedule/page.tsx:485`, inside the F38 fix, reads:

> *"No such row exists live today (0 of 1 slots has a null room_id) — this is closing the hole, not
> fixing a visible number."*

The centre held one slot when that was written. It holds **nine** now. The figure is still 0, so the
claim is still true — **by luck, not by maintenance.** Nothing re-runs a count that lives in a comment,
and nothing fails when it drifts.

The sentence was doing honest work: it recorded that the fix closed a hole rather than corrected a
visible number, which is exactly the distinction worth writing down. The defect is the parenthesis.
**Say what the measurement established, not what it counted** — "no live row exercises this branch"
survives the data changing; "0 of 1" is stale the moment a tenth slot lands and stays stale silently.

Same failure as citing a count that was never run, one step removed: here the count *was* run, and
then frozen where it could rot.

*Source: read at `schedule/page.tsx:485` against a live count of 9. 7 August 2026.*

---

## 28. A fresh clone cannot `npm run dev`, and the failure points nowhere near the cause

`setup-fonts` is wired into `npm run build` only. `npm run dev` does not run it, so a clone that has
never been built has no fonts on disk and every page returns **500**. The trace names neither fonts
nor the script.

The cost is not the fix, which is one command. It is that the symptom — a blank 500 on every route —
reads as a broken environment, a bad secret or a failed migration, and all three were checked here
before fonts were. Anyone onboarding pays that same detour.

Either add `setup-fonts` to a `predev` hook, or make the font loader fail with a message naming the
script.

*Source: reproduced while bringing the app up locally. 7 August 2026.*

---

## 29. RETRACTED — the Friday empty state does signal the week's load, and I missed it by reading text

**This entry was wrong when first written and is kept as a correction rather than deleted, so it is
not raised again from an old copy.**

The claim was: on a Friday the schedule renders "No sessions on this day" and gives no indication the
week has sessions. **False.** The day chips carry a dot per session. Counted from the rendered DOM,
not by eye:

| Sat 1 | Sun 2 | Mon 3 | Tue 4 | Wed 5 | Thu 6 | Fri 7 |
|---|---|---|---|---|---|---|
| 0 | 2 | 2 | 2 | 2 | 1 | 0 |

Nine dots against the nine live slots, correct day by day. `Merged-Center-Groups` frame 15 specifies
exactly this — *"the day view now shows the week's load as dots under each"* — and the app implements
it. There is no gap. An owner opening the app on a Friday sees two bare chips and five dotted ones.

**Why it was got wrong, which is the part worth keeping.** The observation came from a text capture.
`No sessions on this day` is the whole of the visible *text*, and the signal that contradicts it is
**graphical** — it has no text node to capture, so a text-based read cannot see it and reports its
absence as a finding. The seventh wrong-thing instance in this pass and the same shape as the rest:
the measurement was sound, the thing measured was not the thing claimed.

**The rule: a claim that a UI fails to indicate something cannot be made from extracted text.** Text
proves what a screen *says*. Only a rendered image proves what it *shows*. Absence of a string is not
absence of an affordance.

*Source: retracted after rendering `/en/schedule` at 390px and counting dot elements in the DOM.
7 August 2026.*

---

## 43. The old model survives in 11 of 25 design files, and in two of them it is whole screens

Entry 42 found dead-model notifications in one file. Sweeping all 25 for the removed vocabulary —
platform payouts, identity verification, automatic collection, the 90/10 split, the 7.5% markup, the
1.5% parent fee — shows it is not isolated.

| File | Hits | Markers |
|---|---|---|
| `Merged-Admin-Money` **(protected)** | 16 | payout |
| `Merged-Center-Money` **(protected)** | 8 | payout |
| `Merged-Center-Home` | 7 | payout ×4, verify ×1, auto-collect ×2 |
| `Merged-Teacher-Home` | 7 | payout |
| `Merged-Teacher-Setup` | 6 | payout |
| `Merged-Center-Setup` | 5 | payout |
| `Merged-Teacher-Money` **(protected)** | 5 | payout |
| `Merged-Design-Patterns` **(protected)** | 4 | payout ×3, split-90-10 ×1 |
| `Merged-Public-Marketing` | 3 | payout |
| `Merged-Admin-Accounts` | 2 | payout |
| `Merged-Admin-Platform` | 2 | payout |

**11 files of 25. 32 marker hits in non-protected files, 33 in protected ones.** These are raw
marker counts, not verified-dead instances — "payout" is live for referral and staff payouts and dead
only for tuition, so each hit needs its context. The ones checked so far are all genuinely dead:

- **`Merged-Teacher-Home`** draws a complete payout ledger — *"Your balance 4,250 EGP · Available,
  ready for your next payout"*, *"Pending 1,700 EGP · Next processed Thu"*, *"Recent payouts — Bank
  payout 25/06/2026 · CIB ••4821 · 3,400 EGP Paid"*. **The platform holding a teacher balance and
  remitting it to a bank account is the model's central deletion.**
- **`Merged-Teacher-Setup`** gates collection on identity: *"when **verified** the collect toggle is
  on and it becomes **Payout details** (where we send their money)"* and *"Collect payments for me —
  On. **We invoice parents and process your payout** straight to your account."* Its own caption
  admits *"the verified payout is draft, pending legal review."*
- **`Merged-Center-Setup`** puts *"Verify to enable payouts"* on the welcome screen and *"Only the
  owner can withdraw money or change the payout account"* on the team screen.

### Why this changes the order of the work

**These files cannot usefully be frame-diffed until they are swept.** Diffing `Merged-Teacher-Home`
against the app would report its payout ledger as an unbuilt screen and its balance card as a missing
feature — findings for a product that must not exist. The diff would generate work rather than
measure it.

`Merged-Teacher-Setup` is the sharpest case: identity verification and platform collection are not a
section of that file, they are its premise. There is no partial edit; the screens need redrawing.

Four of the eleven are **protected** (`Admin-Money`, `Center-Money`, `Teacher-Money`,
`Design-Patterns`) and carry 33 of the 65 hits, `Admin-Money` alone holding 16. Those go to Eyad
regardless.

*Source: `.rediff/sweep.mjs` over `design/Merged-*.html`, plus context reads of the three largest
non-protected files. 7 August 2026.*

---

## 42. `Merged-Center-Home` notification frames still draw payouts, auto-collection and identity verification

**The design set has not been fully swept for the old model.** Frames 3 (EN) and 4 (AR) of
`Merged-Center-Home` are the owner's notification list, and both draw events the new model deleted.

| Notification | Frame | Status under `NEW-MODEL` |
|---|---|---|
| `Payout requested` / *"Mr. Sherif Adel requested a payout"* | EN | **Dead.** Platform payouts ceased |
| `1,350 EGP sent to your InstaPay` | EN | **Dead.** The platform never holds or remits tuition |
| `Fee collected · auto` / *"Youssef Adel paid 300 EGP automatically"* | EN | **Dead.** Nothing is collected automatically |
| `تم إرسال الصرف` / *"1,350 EGP sent to InstaPay"* | AR | **Dead.** Same payout event |
| `تم تحصيل رسوم · تلقائي` | AR | **Dead.** Same auto-collection |
| **`تم تأكيد الهوية`** / *"identity confirmed · payments and fee collection activated"* | **AR only** | **Dead.** Identity verification and Valify are gone |

Both frames were **partially** updated. The English gained the new vocabulary — `Receipt uploaded`,
`Receipt confirmed`, `InstaPay collection is on`, `8 unpaid links`, `InstaPay not received, retry
sent` — and kept the payout and auto-collection rows beside it. The Arabic gained none of the receipt
rows and additionally kept the identity-verification row the English dropped, **so the two locales
are now out of sync with each other as well as with the model.**

Anyone building this screen from either frame ships notifications for events that cannot occur.

### How this was nearly got wrong, which is entry 38 repeating within the hour

The first read was **"English updated, Arabic stale"** — because entry 40 had just established exactly
that pattern in the legal corpus, and this looked like a second instance of it. It is not. The English
is stale too, in three rows.

The only reason it was caught is that a mechanical check printed `EN contains payout: true` and that
line was followed up instead of skimmed past. **A freshly-confirmed pattern is the most dangerous
possible prior**, because it makes the next observation feel already-verified. Entry 38 named this
after a false positive; this is the same failure caught on the other side, where the pattern was real
but the new instance did not fit it.

*Source: frames 3 and 4 of `design/Merged-Center-Home.html`, extracted 7 August 2026.*

---

## 41. Frame diff results — `Merged-Center-Groups` 13 of 13, `Merged-Center-Students` 12 of 13

Reported as **frames exercised out of frames drawn**, with blocked frames categorised.

| File | Drawn | Exercisable | Exercised | Blocked |
|---|---|---|---|---|
| `Merged-Center-Groups` | 18 | 13 | **13** | 3 Branches (no table) · 2 empty states (by design) |
| `Merged-Center-Students` | 14 | 13 | **12** | 1 empty state (by design) |

The one unexercised frame is Students 11 (import **Review**), which needs the `Year` column mapped
before the wizard advances. Not blocked — just not yet reached.

### Divergences ruled against the design, per entry 32 (no action needed)

Casing throughout — `RECENT SESSIONS`, `Avg Attendance`, `4 Rooms`, `Import Students`, `Next` for the
design's `Continue` — is consistent across the live app and inconsistent in the drawings. **Live
stands.** The Week grid is transposed (live puts hours on rows, days on columns); on a 390px phone
seven day-columns fit and fifteen hour-columns do not, so **live stands** there too.

### Divergences ruled against the app (logged as defects)

| Frame | Defect |
|---|---|
| Groups 2 — detail | Join link renders as a raw 60-character URL ending in a UUID (`…/join/007/d6a17d09-6425-44ee-b47d-bc1a970fa375`) where the design draws a short `thq.eg/j/PHY10`. It overflows the frame and cannot be read aloud to a parent |
| Groups 2 — detail | The **"Attendance · last 8 weeks" heatmap is absent entirely**, with its Less/More legend. The screen jumps from the average straight to recent sessions |
| Students 12/13/14 — pending | Rows carry name, group and relative time only. The design draws **grade**, an `Invite link` / `Sign-up` **source chip**, and **Approve / Decline** per row. Same gap in both locales |
| Students 14 — pending AR | `منذ ٨ ساعة` — third instance of entry 36. Arabic numerals 3–10 take the plural, so eight hours is `٨ ساعات` |

### A divergence that is neither, and is already documented

The import wizard's field list is `Name (required) · Phone · Parent Phone · Group · Skip`. **There is
no Grade option**, so a roster's `Year` column cannot be mapped and the design's `Year → Grade`
mapping — and its `Grade not recognised` skip reason — have no live equivalent.

**This is deliberate and the code says so.** `students/import/page.tsx:227`: *"The design's other
example, 'Grade not recognised', has no live equivalent: grade is not an import field. Not invented
here."* The author found the gap and declined to fabricate a field to fill a drawing, which is the
right call and the same instinct as the `/suspended` route being honest rather than optimistic.

It remains a real gap: `students` carries grade, every roster row displays it, and a centre importing
a spreadsheet loses it. **Whether grade becomes an import field is a build decision, not a design
question** — recorded here rather than resolved.

*Source: rendered diff at 390px against Test Center 333, 7 August 2026.*

---

## 40. The privacy page said "collect", the corpus said "record", and the corpus's own Arabic said "collect"

**"Record" is the model. "Collect" is the word `NEW-MODEL` removes** — the platform records and matches
a transfer, it does not collect money or gather data. A published privacy page claiming otherwise
makes the one assertion the new model exists to retract.

Surfaced by a pre-existing `Unit Tests (Vitest)` failure on `master`:
`tests/unit/legalCorpusParity.test.ts` compares `legalContent.ts` against
`design/Merged-Public-Legal.html` and had been red since before this branch.

### A blanket find-and-replace would have been wrong

Four occurrences of "collect" exist on the legal surface. **The corpus keeps two of them**, and it is
right to:

| Text | Corpus | Action |
|---|---|---|
| "What data we **collect**" (heading) | says **record** | changed |
| "We **collect** what you give us: names, phone numbers…" | says **record** | changed |
| "we do not **collect** anything from third parties" | says **collect** | **kept** |
| "We never **collect** or store your card details" (Terms / Paymob) | says **collect** | **kept** |

The distinction is precise and worth preserving: **`record` is the affirmative act the platform
performs; `collect` survives only in the denials.** Saying "we never record your card details" would
have been a *weaker* claim, since recording is exactly what the platform does elsewhere. Sweeping all
four would have broken parity in the opposite direction.

### The corpus was updated in English only

The source of truth is itself inconsistent. Its English headings read "What data we record" while its
**Arabic still read `البيانات اللي بنجمعها`** — "the data we gather". The parity test compares both
locales, so the Arabic passed only because the app carried the same stale word. **Two wrongs agreeing
is what a parity check reports as correct**, which is why the English half failed loudly and the
Arabic half was silent.

Fixed in both files together: affirmative Arabic is now `بنسجّلها` / `بنسجّل`, and the two negations
(`مابنجمعش`) are untouched in each.

Verified: `legalCorpusParity` 14 of 14 pass; full suite 211 files / 2,089 tests pass;
`i18n:check`, `check:bidi`, `check:tolocale` all OK.

*Source: `legalContent.ts`, `design/Merged-Public-Legal.html`, run 7 August 2026.*

---

## 39. The `PROPOSAL_` filename prefix protects nothing — CI and Supabase Branching both apply the file

A migration named `20260806120000_PROPOSAL_narrow_tuition_payment_methods.sql` was written to be
*proposed*, not applied: Eyad applies tuition-constraint changes to production by hand. **The prefix
is a naming convention with no enforcement anywhere.**

Opening PR #368 demonstrated both halves in under a minute:

| Consumer | What it did with the "proposal" |
|---|---|
| `schema-drift` CI check | Rebuilt a fresh database from **every** file in `supabase/migrations/`, applied it, and **failed the build** because the rebuilt constraints no longer matched `db/schema.snapshot` |
| Supabase Branching | Reported `Migrations ✅` against the preview branch — the narrowed constraint is live there |

Only production apply is manual, exactly as `CLAUDE.md` rule 5 states. Everything short of production
treats a proposal as a migration, because it *is* one — it sits in the migrations directory and the
tooling reads the directory, not the name.

**The repo's actual convention is to accept this.** Two earlier proposals already live there —
`20260804140000_verification_records_proposal.sql` and `20260804150000_PROPOSAL_payout_system_1_ledger.sql`
— and their objects are present in `db/schema.snapshot` (53 and 31 matching lines). So the established
pattern is: proposal migrations live in `supabase/migrations/` **and the snapshot is regenerated to
match them.** Drift was resolved here the same way, by rewriting the two constraint lines to exactly
what the CI rebuild produced.

**What that costs, stated plainly.** `db/schema.snapshot` now declares `payments_method_check` as
`cash | instapay`, while **production still permits all six methods** until the migration is applied
by hand. The snapshot describes what the migrations produce, not what production holds, and those two
things are already divergent for the payout-ledger and verification proposals. Anyone reading the
snapshot as a description of production will be wrong, and nothing in the file says so.

If proposals should genuinely not apply anywhere, they cannot live in `supabase/migrations/`. A
sibling directory the tooling does not scan is the only thing that would make the prefix mean what it
says.

*Source: PR #368 `schema-drift` run 31170871398 and the Supabase Branching status on the same PR.
7 August 2026.*

---

## 37. `?? 0` on money is pervasive, and 24 sites are the entry-33 shape

Entry 33's second half is not confined to the student detail card. Across `src/`:

| Pattern | Sites |
|---|---|
| `?? 0` on an identifier naming money (`balance`, `paid`, `due`, `amount`, `revenue`, `total`, `fee`, `price`) | **345** |
| …narrowed to `balance` / `owed` / `due` specifically — a *loaded* figure, not a config default | **24** |

Most of the 345 are benign: `fee_per_class ?? 0` where the fee is genuinely optional, or reduce
accumulators that must start at zero. **The 24 are not**, because each substitutes a real, reassuring
number for a value that failed to arrive. `ScanTab.tsx:276` is the clearest —
`balance_due: balanceMap.get(s.id)?.balance ?? 0` — and it feeds the door scanner, so a student whose
balance did not load is admitted as owing nothing.

The remedy is the same everywhere and the codebase already contains it. In
`groups/page.tsx:1239` the neighbouring statistic renders `'—'` when its value is null, **three lines
above** a count that renders `0`. The vocabulary for "unknown" exists; money is the place it is not
used.

*Source: `grep -rnE "\?\?\s*0"` over `src/`, filtered and counted 7 August 2026.*

---

## 38. A finding that fits the established pattern gets less scrutiny, which is backwards

While diffing `Merged-Center-Groups` frame 3, a capture showed the group detail reporting
**`Waiting 0`** beside a tab reading **`Waitlist · 1`**, with the catalog confirming 1. It looked like
a third instance of entry 33 — a summary contradicting a list on the same screen — and it was written
up as one.

**It is not a defect.** Both numbers read the same `waitlist.length`: the stat at
`groups/page.tsx:1238` and the tab at `:1331`. Re-tested at 300 ms, 1,400 ms and 6,000 ms after the
tab click, **`Waiting` reads 1 at every timing.** The original capture was an artefact of the
click sequence in that run, not a state the product reaches.

**What makes this worth recording is why it was nearly believed.** Entry 33 had just established
"summary disagrees with list" as a real, verified pattern in this codebase. The new observation
matched it exactly, so it inherited that credibility instead of earning its own. **A pattern makes
the next instance more plausible and no more likely to be true** — and it does so precisely when
scepticism is cheapest to skip, because the shape is already familiar.

Same discipline as entry 26, applied in the opposite direction: there, an impossible intermediate
exposed a bad selector; here, a *plausible* observation needed a direct test to be dismissed. The
check cost one script. Reporting it would have cost a false entry that a future reader could not
reproduce.

*Source: re-tested `/en/groups` → Chemistry A → Waitlist at three settle times. 7 August 2026.*

---

## 36. Pluralisation is a two-key idiom, and Arabic has six plural forms — the scheme cannot reach the language

The three plural bugs found in the rendered diff — `across 1 branches`, `في ١ فروع`, `منذ ٨ ساعة` —
are not three typos. They are the ceiling of the scheme.

Measured across both message files (8,518 keys each, identical count):

| | EN | AR |
|---|---|---|
| Strings interpolating a count | **263** | **261** |
| …using ICU `plural,` | **9** | **9** |
| Keys carrying a manual variant suffix (`…One`, `…Plural`, `…_other`) | **8** | **8** |

So the overwhelming majority of count-bearing strings have **no plural handling of any kind**, and the
handful that do use a hand-rolled two-key pattern: `pendingClassesCount` beside
`pendingClassesCountOne`, `cardOrderCartSelected` beside `cardOrderCartSelectedPlural`.

**A two-key scheme is sufficient for English and structurally cannot serve Arabic.** Arabic has six
CLDR plural categories — `zero`, `one`, `two`, `few`, `many`, `other` — and the noun inflects
differently in each. `منذ ٨ ساعة` is wrong because 3–10 takes `few` (`ساعات`); 11 and above takes
`many` (`ساعة`); two takes a dual form that no key in this codebase expresses at all. **A singular
key and a plural key cannot encode that no matter how carefully each is written.**

The fix is not to correct the three observed strings. It is ICU `plural` with Arabic categories, at
which point `next-intl` selects the right form from the number and the three bugs disappear together
with the ones nobody has rendered yet.

### The gate cannot catch any of this

`scripts/check-i18n.ts` flattens both files to **key sets** and compares them — `missingEn`,
`missingAr`, `onlyEn`, `onlyAr`. It never reads a string's *value*. So a translation that drops a
placeholder, inflects a noun wrongly, or hardcodes a quantity **passes the build gate**, which is why
these reached a rendered screen.

Placeholder drift specifically: exactly **2** keys present in both files carry a `{count}` in English
and none in Arabic — `students.cardOrderCartSelected` and
`teacherPortal.studentsList.pendingClassesCountOne`. **Both are correct**, because each is the "one"
half of a manual pair and Arabic's `طالب واحد` / `حصة واحدة` already carry the quantity as a word.
Recorded because the automated check flags them and a future reader will otherwise re-raise them:
**placeholder drift is a signal, not a verdict.**

*Source: `messages/en.json`, `messages/ar.json`, `scripts/check-i18n.ts`, counted 7 August 2026.*

---

## 35. `payments.status` and `payments.confirmed` encode the same fact and already disagree

Two columns carry confirmation state. `status` is text (`pending` / `paid` / `confirmed`) and
`confirmed` is a boolean. Nothing reconciles them, and one row in thirty is already inconsistent:

| `status` | `confirmed` | Rows | Total |
|---|---|---|---|
| `paid` | true | 28 | 73,200 |
| `pending` | **true** | **1** | 3,200 |
| `pending` | false | 1 | 2,400 |
| `confirmed` | — | **0** | — |

The `pending`/`confirmed=true` row cannot have come from `api/payments/confirm/route.ts`, which sets
both fields in one update. Something else wrote the boolean without the status, so the pair drifts
whenever a writer touches one and not the other.

**This is load-bearing, not cosmetic.** `studentBalance.ts` reads `status` and ignores `confirmed`
entirely. Whichever column a given consumer happens to read decides whether a payment is money, and
the two answers differ for that row today. Entry 33's fix — narrowing the status set — makes this
worse before it makes it better: a `pending`/`confirmed=true` row would then be excluded from the
balance while still reading as confirmed to anything checking the boolean.

Pick one column as authoritative and derive or drop the other. Doing it in the same PR as entry 33 is
the cheaper order, because entry 33's narrowing is what turns the drift into a visible wrong number.

Note also that `status='confirmed'` matches **zero rows** while being the first entry in
`PAID_PAYMENT_STATUSES` — a third state that exists in code and in the confirm route but never in data.

*Source: `select status, confirmed, count(*) from payments group by 1,2` against the live catalog,
plus `api/payments/confirm/route.ts:50-61`. 7 August 2026.*

---

## 34. A join that fans out is a query measuring the wrong shape, and it survives by being absurd

**Logged beside entry 31 because it is the same failure in a different tool, found the same day by
the other person on this work.**

The first attempt to verify entry 33 joined `payments` and `attendance_scans` in one statement. Both
are one-to-many against `students`, so the rows multiplied: **20 payment rows for a student holding
3**, and a **44,800 EGP credit that does not exist**. The query ran clean, returned plausible column
names, and was wrong by roughly 10×.

**It was caught only because the numbers were absurd.** A 44,800 credit on a centre whose largest
genuine credit is 3,900 cannot be explained away. Had the fan-out been 2× rather than 10× — two
payments against two scans — the output would have been a believable 4,800 and it would have been
believed.

Identical in shape to the detached-clone `innerText` (entry 31): the instrument did exactly what it
was told, the thing it measured was not the thing being asked about, and the output stayed inside the
range where nobody checks. Two people, two tools, one day, same family.

**The habit that catches it, same as entry 26: derive a value with a floor and check the floor.**
Here the check is a row count — a per-student payment count from a single-table query, compared with
the count the joined query implies. Aggregating across two one-to-many joins in one statement needs
sub-selects or CTEs per branch, never a single `join … join`.

*Source: verification of entry 33, 7 August 2026. Recorded by Eyad.*

---

## 31. A detached clone's `innerText` returns hidden text, which silently inflates any rendered diff

The first frame-capture harness read page text by cloning `document.body`, stripping nav and header
from the clone, and taking `innerText`. **`innerText` is CSS-aware only for attached nodes.** A
detached clone has no layout, so it degrades to something close to `textContent` and returns every
hidden panel as though it were on screen.

The effect was not subtle. `/en/schedule` came back carrying a **full week grid** — a time axis, every
session, and the string *"Red outline marks a room clash · swipe for Fri–Sat"*. None of it was
visible. The rendered page shows the Day view and the words "No sessions on this day". Had that
capture been trusted, `Merged-Center-Groups` frame 17 (Week view) would have been recorded as
**adopted, with matching legend copy**, on the strength of markup that no user can see.

The fix is to mutate the live DOM instead of a clone — remove `nav, aside, header, script` from the
attached document and read `document.body.innerText`, which keeps layout intact and hidden things
hidden.

**Every text-derived observation in this re-diff predating the fix is void** and was re-taken. The
screenshots were never affected; they render what renders.

*Source: `.rediff/cap.mjs`, caught by comparing its output against the screenshot of the same page.
7 August 2026.*

---

---

# Six the ledger called open and verification closed

**Recorded so nobody re-opens them from an old copy of a deleted document.** Each was carried as an
open finding and each is resolved.

| Was | Now |
|---|---|
| **F44** — `centers.address` has no column, needs a migration, stopped rather than written | **The column exists.** Catalog: 1. Dead finding. |
| **F13** — `students.grade_level` has zero writers, the display will stay blank | **It has a writer.** `src/components/teachers/GroupProposalsTab.tsx:201`. Dead finding. |
| **F5** — `admin_users.custom_permissions` is dead and pending a drop | **Seven files use it**, including a live write at `admin/internal-team/page.tsx:153`. Do not drop it. |
| **F26 item 4** — `card_order_status_transitions.created_at` is read and does not exist | **Genuinely fixed.** `loadCardOrderDetail.ts:67` and `cardOrderState.ts:218` both order by `transitioned_at`, and that column exists. |
| **F38** — schedule flags a false room clash between two slots that have no room | **Fixed.** `schedule/page.tsx:487` and `:490` both guard `if (!s.room_id) continue;` before the comparison, in each of the two functions. |
| **F5b** — Tailwind scans `docs/` and `design/` | **Fixed.** `tailwind.config.ts:5` content is `["./src/**/*.{ts,tsx,js,jsx}"]` and nothing else. |

This is the same rule that found three of the seven payout defects already fixed. It cuts both ways,
which is the point: a ledger marker is a claim, not evidence, whichever direction it points.

---

# Still to verify

Not yet checked, and therefore not yet claimed either way.

**The pass is complete.** Every one of the twelve deleted documents has been worked through.

**`DATA-GAPS.md` produced nothing, as predicted.** It was a column-existence sweep, and of the 13
distinct column claims it makes, **11 now exist**. The two that do not are already recorded
elsewhere: `students.balance_due` is the canonical phantom column in `docs/WORKING-RULES.md`, and
nothing selects it today (its 30 remaining references are all computed client-side fields fed by
`getStudentBalance`), and `notifications.type` names a table that is actually `in_app_notifications`.
Zero new findings, and the file is fully superseded.

**Dropped, all for the same reason:** F12, F14, F32, F36, F37. Each asserts that a design drew
something with no backing column. Those designs are replaced, so re-establishing them is Stage 4
re-diff work against the new drawings rather than a fact about the codebase.

---

# Open decisions, carried forward

From `ASSUMPTIONS-LOG.md`. These were decided in Eyad's place because they changed behaviour rather
than whether a screen could be built, and they are recorded so any can be overturned without
archaeology. **Each underlying fact was re-verified on 6 August 2026.**

| | Decision | The fact it rests on, verified |
|---|---|---|
| **D8** | No seat add-on built | `centers.max_teachers` and `max_students` do not exist. Pricing a seat is moot while every centre is invisibly capped at 2. See entries 4 and 10 |
| **D17** | Public teacher profile stays read-only, no "add this teacher" action | `src/app/[locale]/teachers/` exists and ships the page. Adding the action changes account state |
| **D21** | Keep full-UUID join links, no short codes | `group_join_links` has 0 rows and 0 code references. Live UUID links work. See entry 17 |
| **D26** | No new notification writers | Exactly **2** writers of `in_app_notifications` exist (`privacy-request/route.ts:140`, `cardOrderNotifications.ts:83`) and the table holds 0 rows. Wiring some would read as broken rather than honestly sparse |
| **D27** | Compose notifications via i18n key + params in `metadata` jsonb | `in_app_notifications.metadata` exists. **Decide this before D26, not after** — it reverses cleanly while there are two writers and gets expensive once there are more |
| **D29** | The 5 unbacked `/pricing` add-ons stay withheld | Only `platform_config.pack_price_per_parent` has real backing, live value **12**. `NEW-MODEL.md` independently confirms analytics, benchmarks and team seats are 0 for now |
| **D34** | Drop the "withdrawals to your own account" bullet rather than reword it | **Now permanent, not provisional.** It was logged as "reinstate once V4 lands"; V4 was verification, which is dead, and `NEW-MODEL.md` says credit cannot be withdrawn as cash at all |

**D27 is the only one with a deadline.** The rest can sit.

F20 produced finding 7, F27 produced finding 20, and S9 was pulled forward out of order to become
finding 13 because a CSRF gap on a platform kill switch does not queue behind eight F-codes.
Finding 1 came out of checking consent obligation 3 while writing up entry 2.

**Entries are ordered by severity, not by when they were found.** The two consent failures lead
because they are the only ones touching data counsel treats as sensitive.

**Check the live data on anything consent-shaped.** Both consent findings are real in code and have
produced no violation, and establishing that took one query each. A defect that has harmed nobody is
a different conversation with counsel than one that has, and fixing it before launch means there is
nothing to disclose at all.

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
