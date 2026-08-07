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
