# State of play

**6 August 2026.** Everything outside the design set that someone picking this up needs to know.

`design/NEW-MODEL.md` says what the product is. This says where it actually stands.

---

## Dated, and nobody owns it

**`first_charge_release` is `HELD`.** Nothing charges anyone until it flips. The floor is
**30 August 2026**.

The failure mode is silence. No error, no alert, no revenue.

**Flipping late does not lose revenue** because the condition is `>=` and invoices catch up. But
`pay_window_days` is `1` and the lock was anchored to the originally computed date, so a late flip
would have invoiced the cohort and locked them a day later on a bill they had not had time to pay.
That was fixed: `lock_at` now anchors to when the invoice was actually raised.

**Nobody is named as owning the flip.** That needs deciding before 30 August.

---

## The trial

**Free until 16 August, first invoice 30 August.** This exists in code and in `platform_config`.

`free_until` is a **floor**, not a deadline. Someone signing up on 20 July starts their 14 days on
16 August. Someone signing up on 20 August starts immediately and is invoiced on 3 September.
Nobody gets a wall.

---

## Live faults found and fixed this week

Worth knowing because each was silent and each was found by checking rather than being reported.

| | |
|---|---|
| **Cross-tenant hole** | A logged-in user could change the column deciding which center they belong to. Closed. |
| **Parent absence alerts** | Had never fired once. The query matched zero rows every run because two conventions disagreed. Fixed, and it has still never run in production. |
| **Daily summary** | Read tomorrow's timetable. Fixed. |
| **Students import** | Silently dropped rows and counted only survivors. Fixed. |
| **Payments import** | Same fault, worse, because a dropped payment is money a parent handed over that was never recorded. Fixed. |
| **Roster export** | Same shape. Fixed. |
| **Reject button** | Never touched the student row, so a rejected signup was indistinguishable from a pause forever. Fixed. |
| **`students.payment_status`** | Set once at creation, never updated, read as truth by three surfaces. Repointed. |
| **Phone matching** | Compared by trailing substring, so two different numbers could match. Now exact after normalising to `+20` E.164. |

**The pattern across all of them:** one number with two sources, or a check that measured the wrong
thing. Both are worth looking for first when something behaves oddly.

---

## The payout defects, three of seven still live

**Verified against live code on 6 August**, not against the spec that listed them. The original list
said seven; three have since been fixed and one narrowed.

**Still live:**

1. **`payout_requests` has no approval path.** A request can never leave `pending`. The live approval route operates on `withdrawal_requests`, a different table.
2. **Credit withdrawal double-pays on a double-click.** The credit spend at `admin/withdrawals/[id]:94` runs *before* the status update guarded at `:115`, so two racers both spend.
5. **Credit reservations never expire.** The only `cancel_reservation_atomic` sweep covers `combined_payment_sessions`, and no cron touches `withdrawal_requests`.

**Fixed, do not rework:**

3. `centers.instapay_number` is now in `CENTERS_PROTECTED_COLUMNS`, with a comment that payout destinations must not go through the proxy.
4. `nextProcessingQuarterStart` returns the current quarter inside an open window. Its own comment describes the old behaviour in the past tense.
6. CSRF is validated at `referrals/payout/route.ts:18`.

**Narrowed, not closed:**

7. `billing/withdrawal` is owner-only at `:22`; `referrals/payout` allows owner or delegated staff. Still different, just less so.

Also: the `SUPER_ADMIN_PHONES` path mints a CEO with **no database row and no forensic trail**.

**One collision to watch.** PR #334 is open and adds the `payout_requests` approval path. The #322
removal deletes `/api/admin/center-payouts/*`, which is the only place `payout_requests` carries
approval semantics today. If #334 builds there, the two conflict.

**And a prior question.** Defects 1, 2 and 5 all serve credit withdrawal. `NEW-MODEL` says credit
cannot be withdrawn as cash, and the cash-out question is open with the tax advisor. Fixing an
approval path for a withdrawal that may not be permitted is work that could be discarded.

---

## The sessions migration

`sessions` and `session_students`, additive, applied. No generator, no billing writes.

**Three warnings apply when a generator is eventually built.** They are recorded here and nowhere
else, so do not lose them:

- Keying on `(schedule_id, scheduled_at)` **double-charges students**. That keys an instant, but the billable unit is a Cairo class-day. A slot edit or a DST transition mints a second row, a second `session_id`, a different idempotency key, and `fee_per_class` fires twice. Reproduced live.
- `schedule_exceptions.schedule_id` FKs to `group_schedule`, not `schedule_slots`, so exception lookups from a slots generator match zero rows forever.
- A generated `status='scheduled'` row suppresses real billing.

---

## Paymob's role, which changed

**Paymob no longer touches tuition.** Under the InstaPay model parents transfer directly to the
provider.

Paymob still handles **the platform's own billing**: subscriptions, WhatsApp packs, card orders.
That is TutoringHQ charging its customers, and it is legitimate wherever it appears in a design.

Paymob is still in **test mode**. The recurring integration ID is a placeholder.

---

## Language

**All customer-facing content is Egyptian colloquial Arabic**, not Modern Standard. The exception is
legal acceptance copy, which stays plain formal.

Arabic frames mirror in RTL, use Eastern Arabic numerals, and drop IBM Plex Mono in favour of weight
600. Arabic body text sits one step up the type scale from English, because Plex Sans Arabic reads
smaller at the same pixel size.

**The two languages are separate screens, not a toggle.** Do not build one and flip it.

---

## WhatsApp

Templates need Meta approval, 24 to 48 hours each. In-app banners work without them.

Verified against the live Meta list: three templates are Marketing and should be Utility. Seven need
creating and submitting. One dropped off Meta entirely and the code still calls it.

The detail, since it exists nowhere else:

- **Category fix, delete and resubmit as Utility:** `chq_welcome`, `chq_onboarding_step1`, `chq_onboarding_step2`. `chq_renewal_reminder` is already Utility, do not refix it.
- **Create and submit, all Utility, Arabic EGY:** `chq_nudge_prebill`, `chq_nudge_due_today`, `chq_nudge_locked`, `chq_nudge_card_expiry`, `chq_fee_reminder`, `chq_pin_setup_link`, `chq_enrollment_otp`.
- **Phase 4, can wait for the schedule feature:** `chq_class_cancelled`, `chq_class_rescheduled`, `chq_schedule_changed`, `chq_class_reminder`.
- **Cleanup:** `chq_pin_delivery` dropped off Meta and reset-pin code still calls it.
- **Minor:** `chq_referral_commission` is tagged English with an Arabic body. `chq_upgrade_nudge` is Marketing and in review, acceptable for an upsell.

A new template is needed for the InstaPay invoice link, and it does not exist yet.

**A parent pack is billed per message and priced differently from a reminder pack**, so a reminder
pack can never be spent on marketing.

---

## Cash

**Cash costs nothing.** No service fee, no processing fee, no charge of any kind.

This matters more than it sounds. Most Egyptian tuition is cash, and charging for money the platform
never touches would drive centers to under-report. Cash recording is free deliberately, as an
acquisition wedge.

---

## ETA e-invoicing

**Largely moot under the new model.** The old design had TutoringHQ self-billing providers for a 90%
pass-through, which required the provider's national ID on the receipt and an e-seal certificate.

That is gone. There is no pass-through, so there is nothing to self-bill.

**What remains:** TutoringHQ still invoices its own customers for subscriptions and fees, and those
are ordinary sales invoices. Whether they must go through ETA, and whether an e-seal certificate is
needed for that, has not been confirmed.

---

## Legal, and it is stale

**Every legal document describes the old model.** Privacy policy, terms, DPA, data rights form.

The old `LEGAL-CHANGE-LEDGER` tracked changes required by the national ID decision. That decision is
void, so the ledger is void with it.

**Two items the model change adds:**

- **Gemini Flash-Lite is a new sub-processor.** The receipt reader sends parents' names and banking details to it. Paid tier only, never free, because the free tier's data terms would put personal financial data into training. It needs adding to the DPA.
- **The upload-link expiry is undefined.** It was left following the child safety decision. Stage 1.3 cannot finish until someone sets the number.

**What is genuinely still open:**

- Whether referral credit can be **cashed out**. With the tax advisor. If it can, the lock copy changes and sending credit becomes a different regulatory question.
- **PDPC licensing under Law 151/2020.** The platform still holds student and parent data as processor for centers. Adsero's position was that child data is sensitive and requires a permit. That does not change under InstaPay.
- **Adsero has not started reviewing** the drafts. They should be rewritten against the new model first, so they review one clean set.

---

## Not started

- **Valify** meeting, and it may no longer be needed at all now that verification is gone.
- **Paymob** live credentials.
- **VAT registration**, overdue since March.
- **External penetration test**, before any real center loads student data.
- **Bosta** merchant account, for card orders, which are parked anyway.

---

## Plan prices, live

Centers: 999, 1,999, 4,499, 7,999, 12,999, 18,499 per month.
Teachers: 499, 999, 2,499 per month.
Branch add-on: 199 per month.
All VAT-inclusive. Every platform invoice carries 20 EGP processing, VAT inclusive.
