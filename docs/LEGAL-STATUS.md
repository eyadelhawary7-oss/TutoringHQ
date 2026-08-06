# Legal status

**6 August 2026.** Replaces `LEGAL-CHANGE-LEDGER.md`, which tracked changes required by the national
ID decision. That decision is void, so the ledger is void with it.

---

## The short version

**Every legal document describes a model that no longer exists.** They were written when the
platform collected tuition, held it, took a percentage, and self-billed providers for a 90%
pass-through.

None of that is true now.

**Adsero has not started reviewing.** That is fortunate. They should review one clean set written
against InstaPay, not a set plus a list of amendments.

---

## The documents

| Document | Status |
|---|---|
| `TutoringHQ_Privacy_Policy_DRAFT.md` | Says the platform collects payments. Rewrite. |
| `TutoringHQ_Terms_Conditions_DRAFT.md` | Fee structure, collection and payout clauses all stale. Rewrite. |
| `TutoringHQ_Data_Processing_Agreement_DRAFT.md` | Sub-processor list needs revisiting. Valify is out. |
| `TutoringHQ_Privacy_Request_Form_DRAFT.md` | References verification. Minor rewrite. |
| `TutoringHQ_Cookie_Policy_DRAFT.md` | Unaffected. |

---

## What the model change removes from the legal surface

**The national ID requirement is gone.** It existed so the platform could self-bill providers for
their 90% share and deduct it as a cost. There is no pass-through now, so there is nothing to
self-bill and no counterparty ID to put on a receipt.

That removes, in one stroke:

- Collecting national ID numbers at all
- The sensitive-data classification question that followed from it
- The five-year tax retention conflict with the PDPL erasure right
- Valify as a sub-processor
- The e-seal certificate requirement for self-billed invoices

**Identity verification is gone entirely**, so every verification clause comes out.

**The platform never holds client money**, which removes the whole payment-facilitator licensing
question under CBE rules. Paymob remains the processor for the platform's own subscription billing,
which is ordinary merchant activity.

---

## What the model change does not remove

**Student and parent data is still held.** The platform is processor, the center is controller. That
has not changed and neither has the exposure.

**Adsero's position on child data stands:** any data relating to a minor is sensitive under Article 1
of Law 151/2020, without exception. That means, on their reading, a controller licence, a processor
licence, a separate sensitive-data permit, and a registered DPO.

**The consent burden sits with centers**, but the warranty does not. Center agreements need a
warrant and indemnity clause confirming they obtained explicit written parental consent before
entering a minor's data. **No current agreement has one.**

## The four consent obligations the platform owns directly

These are not passed to centers under the agreement. The platform builds them, and a center can
neither see nor fix them. Recorded here because they previously lived only in Eyad's notes and were
therefore uncitable.

**All four were checked on 6 August 2026. All four were wrong.** That is the finding, more than any
one of them. Each was written down as a platform obligation and none carried a verification date, so
nothing distinguished "done" from "intended". No center could see or report any of them, and nothing
in CI tests a promise. **Treat a written obligation with no verification date beside it as
unverified.**

None has harmed anyone: zero parent phones at more than one center, zero opt-out flags set to false,
zero erasure requests filed. All four are pre-launch fixes rather than disclosures.

| | Obligation | State |
|---|---|---|
| 1 | Right-to-erasure self-serve delete | **No self-serve path, and erasure is incomplete.** See below. |
| 2 | Consent check before parent alert crons | **Broken.** See below. |
| 3 | Per-center scoping of consent opt-outs | **Broken.** See below. |
| 4 | Short-lived revokable parent-portal links | Exists, but not revoked on erasure and minted across centres. See items 1 and 3. |

**A consent control existed and did not work.** `students` carries three per-student parent
notification toggles. All three are writable and are displayed back as set, but only
`notify_on_scan` is checked before sending. `api/cron/parent-absence-alerts` does not select
`notify_on_absence` and `api/cron/parent-balance-alerts` never references `notify_on_balance`, so a
parent who opted out of either kept receiving those messages while the toggle read as off. Verified
against live code 6 August 2026; detail in `design/FINDINGS.md` entry 2.

This is a platform failure, not a center one. The toggle, its storage, its display and the crons are
all platform code, so no center could have seen or fixed it. **Adsero needs it separately from the
question of whether the control was required at all**, because the record shows a choice captured
and represented as honoured when it was not.

**No parent has actually been overridden.** Checked the live catalog 6 August 2026: 4 student rows,
of which **zero** have any of the three flags set to false. Nobody has ever exercised the opt-out, so
no message has gone out against one. The defect is real in code and has produced no violation. Fix it
before launch and there is nothing to disclose; ship it as-is and the first parent to use the toggle
creates one.

**Obligation 3 is broken in the opposite direction: consent is manufactured, not ignored.** When a
parent taps the Arabic consent button in a WhatsApp thread, `api/whatsapp/webhook/route.ts:350`
selects every student row carrying that `parent_phone` **with no `center_id` filter**, although
`centerId` is in scope and used two lines earlier. The loop at `:362` then sets
`parent_consent_given`, `parent_consent_at` and `parent_phone_verified` on all of them **and mints a
`parent_portal_tokens` row for each**.

So a parent with children at two centers who consents in Center A's thread silently grants consent at
Center B, and Center B's send gate (`parentNotifications.ts:174` filters on
`parent_consent_given = true`) opens for a parent who never agreed to hear from them. Obligation 4's
tokens are minted across that same boundary.

**Nobody has been affected yet.** Live catalog, 6 August 2026: **zero** parent phone numbers appear
at more than one center. Same position as obligation 2, real in code and no violation produced.
Detail in `design/FINDINGS.md` entry 1.

**Obligation 1: better built than expected, and incomplete.** There is no self-serve delete. A public
request form files a `privacy_requests` row at `status='pending'`, and an admin then runs
`api/admin/privacy-requests/anonymize`, which genuinely strips the student's identifying fields
rather than setting a flag, and deliberately keeps the row so invoices and payments retain their
links. That is the retention carve-out done correctly.

What it misses is everything outside `students`. Verified against the catalog 6 August 2026: **at
least nine other tables still hold that parent's phone number afterwards**, including
`whatsapp_messages`, `wa_conversations`, `families`, `paid_parents` and `pending_enrollments`.
`parent_portal_tokens` is not revoked either, so a live token keyed to the erased student keeps
resolving. The route also handles one student per call, so a parent with three children gets partial
erasure by default.

**Nobody has exercised the right.** `privacy_requests` holds **0** rows. Pre-launch fix, not a
disclosure. Detail in `design/FINDINGS.md` entry 3.

## Five promised deadlines, none implemented

**Confirmed 6 August 2026 by reading the drafts.** Five commitments are in writing. Not one has any
implementation behind it. The request queue is a `privacy_requests` row at `status='pending'` with
**no timer, no SLA field, no escalation and no due-date column of any kind**.

| Source | Line | Promise |
|---|---|---|
| `TutoringHQ_Privacy_Request_Form_DRAFT.md` | 13 | Respond to all verified requests within 30 calendar days |
| `TutoringHQ_Privacy_Request_Form_DRAFT.md` | 14 | Extendable by a further 30 where necessary |
| `TutoringHQ_Privacy_Request_Form_DRAFT.md` | 99 | Acknowledge receipt within 5 business days |
| `TutoringHQ_Privacy_Request_Form_DRAFT.md` | 101 | Complete within 30 calendar days of identity verification |
| `TutoringHQ_Data_Processing_Agreement_DRAFT.md` | 250 | Process such requests within thirty (30) days |

**The DPA line is the serious one.** It is a contractual commitment to centers, not a policy
statement to parents. A center can sue on it. The other four are undertakings to data subjects, which
is a regulator problem rather than a contract one.

**The acknowledgement, precisely.** The step is not missing from the code, it is switched off.
`src/lib/privacyRequestConfirmation.ts` exists and `api/privacy-request/route.ts:166` calls it on
every submission, immediately, which would satisfy five business days comfortably. It is gated on
`platform_config.privacy_request_confirmation_wa_template`, and **that key has no row in the live
table** (verified 6 August 2026), so it returns `template_not_configured` and never sends. The
comment says to leave it unset until Meta approves the template and Adsero reviews it. So the work is
a template approval plus one config row, not a build. The route is honest about the outcome:
`confirmationSent` drives the confirmation screen and the comment says it "must never be optimistic."

It is also WhatsApp-only. A requester who gives an email and no phone gets nothing at all.

**The same conflict on a different clause.** The drafts promise deletion of *all copies*. Erasure
strips the `students` row and two notes tables, and **at least nine other tables still hold that
parent's phone afterwards**. Whatever the deadline clauses resolve to, the completeness clause has
the identical problem: a promise wider than the implementation.

**Resolve it in one direction or the other.** Either the code implements these deadlines, with a due
date on the row, an acknowledgement that actually sends, and an escalation when it lapses, or the
drafts stop promising them. Both are defensible. **Shipping the current pair is not**, because a
signed DPA promising thirty days against a queue with no timer is a breach the first time anyone
counts.

---

## Open questions

| Question | With | Since |
|---|---|---|
| Do the PDPC licences apply, how long do they take, and can we operate while pending? | Legal advisor | 26 July |
| Can referral credit be cashed out, or must it stay credit-only? | Tax advisor | 5 August |
| Do platform sales invoices need to go through ETA, and is an e-seal needed for that? | Tax advisor | Unasked |
| Does moving credit between registered accounts constitute money transmission? | Legal advisor | Unasked |

**The last one matters more than it looks.** Credit-only is what keeps it outside money
transmission. If cash-out is permitted, the answer may change.

---

## The rewrite, when it happens

**Write against the new model first, then send Adsero one clean set.** Not the old set plus
amendments.

The privacy policy needs, at minimum: the platform never receives tuition, no identity verification,
no national ID collection, what is actually stored from a receipt, and the retention position now
that the tax conflict is gone.

The terms need: the 10 EGP service fee and who funds it, the 20 EGP processing fee on platform
invoices, that credit cannot be withdrawn as cash, and the parental consent warranty.

**Nothing in the drafts should survive unread.** The model changed at the root, so the documents
change at the root.
