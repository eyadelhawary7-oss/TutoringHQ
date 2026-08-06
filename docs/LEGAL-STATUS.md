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

**A consent control existed and did not work.** `students` carries three per-student parent
notification toggles. All three are writable and are displayed back as set, but only
`notify_on_scan` is checked before sending. `api/cron/parent-absence-alerts` does not select
`notify_on_absence` and `api/cron/parent-balance-alerts` never references `notify_on_balance`, so a
parent who opted out of either kept receiving those messages while the toggle read as off. Verified
against live code 6 August 2026; detail in `design/FINDINGS.md` entry 12.

This is a platform failure, not a center one. The toggle, its storage, its display and the crons are
all platform code, so no center could have seen or fixed it. **Adsero needs it separately from the
question of whether the control was required at all**, because the record shows a choice captured
and represented as honoured when it was not.

**No parent has actually been overridden.** Checked the live catalog 6 August 2026: 4 student rows,
of which **zero** have any of the three flags set to false. Nobody has ever exercised the opt-out, so
no message has gone out against one. The defect is real in code and has produced no violation. Fix it
before launch and there is nothing to disclose; ship it as-is and the first parent to use the toggle
creates one.

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
