# Legal document change ledger

**Opened 26 July 2026. This is a running list, not a finished document.**

Everything that must be added, changed or removed in the legal documents when they are rewritten.
Adsero has not started reviewing, so the rewrite happens before their review rather than after.

**Add to this file as decisions are made. Do not rewrite the policies until it is closed.**

Documents in scope:

| | |
|---|---|
| `TutoringHQ_Privacy_Policy_DRAFT.md` | the main one, most changes land here |
| `TutoringHQ_Terms_Conditions_DRAFT.md` | |
| `TutoringHQ_Cookie_Policy_DRAFT.md` | no changes identified yet |
| `TutoringHQ_Data_Processing_Agreement_DRAFT.md` | sub-processor and erasure duty |
| `TutoringHQ_Privacy_Request_Form_DRAFT.md` | routing and carve-out |
| `Merged-Public-Legal.html` | **the design that displays all of it, in both languages** |

**The design file is not optional.** It carries the same claims on screen. If the drafts are amended
and the design is not, the screen contradicts the policy it is displaying.

---

## A. Remove, because it is no longer true

### A1. "We do not process sensitive personal information"

Appears in the privacy policy **summary** and again in **section 1**. Appears once in English and
once in Arabic inside `Merged-Public-Legal`.

**Why it changes.** TutoringHQ collects the provider's national ID number. The number encodes date
of birth, governorate of birth and sex, which makes it sensitive under Law 151/2020 regardless of
how it is stored.

### A2. "We do not collect any information from third parties"

Privacy policy summary.

**Why it changes.** Valify returns a verification outcome. That is information from a third party.

### A3. The unqualified thirty day erasure promise

`Merged-Public-Legal` states erasure within 30 days, **three times in English and three times in
Arabic**, with no carve-out. This is the screen a person reads *before* making a request, so it
matters more than the draft wording does.

**Why it changes.** Financial records required by tax law cannot be erased on request. The promise
as written cannot be kept for provider financial data.

**Keep it plain.** One clear sentence, not a wall of text. The rest of that screen's voice is short
and direct and should stay that way.

---

## B. Add

### B1. A national ID section

Covering, in both languages:

- **What is collected.** The national ID number. Nothing else.
- **Why.** TutoringHQ self-bills providers for their 90% share of tuition it collects and issues the e-receipt through ETA. ETA requires the counterparty's national ID on that receipt.
- **Legal basis: compliance with a legal obligation.** Not consent. State this explicitly so it does not inherit the consent language used elsewhere in the document. Multiple lawful bases coexisting is normal and correct; what matters is that this field names its own.
- **No opt-out.** A provider who declines cannot be paid through the platform, because no lawful receipt can be issued.
- **The document is never held.** Verification is a redirect to a Valify-hosted flow. TutoringHQ never receives or stores the ID image, front or back, and therefore never holds the address, photograph, religion or marital status printed on it.
- **What is stored.** Number, verification status, timestamp, Valify provider reference.
- **Retention.** The statutory tax period.
- **Collected from providers only.** Centers and independent teachers. Never from parents or students, who are not counterparties to any receipt TutoringHQ issues.

### B2. A tax retention carve-out

On the same pattern as the existing five-year security records carve-out.

Applies to the **financial skeleton only**: national ID number, legal name as it appears on receipts,
receipt amounts, dates, receipt references and ETA submission records.

Everything else about a provider is erased on request: profile, photograph, contact preferences,
WhatsApp settings and message history.

**A provider making a request is told plainly what is kept, why, and for how long.** A refusal
without a reason is what turns a data request into a complaint.

### B3. Valify as a named sub-processor

In the Data Processing Agreement. Currently absent.

### B4. The processor erasure duty

In the DPA. When a center instructs TutoringHQ to erase student or parent data, TutoringHQ performs
it within a reasonable time and confirms it. **That duty is owed to the center, not to the parent**,
but it is real and it should be written down.

---

## C. Change

### C1. The twelve month deletion promise

Privacy policy section 7 promises deletion or anonymisation no later than twelve months after account
termination. Needs the tax carve-out from B2 applied to it.

### C2. Erasure routing, stated precisely

**Student and parent erasure is the center's or teacher's responsibility.** They are the controller
for that data; TutoringHQ is the processor. Requests go to them, and they instruct TutoringHQ.

**Two things this must not break:**

- **The existing fallback stays exactly as designed.** If the center has closed or cannot help, TutoringHQ acts directly. A parent whose center has vanished has nobody else to ask. Do not weaken this.
- **The tax carve-out is never cited to a parent or student.** It is a provider matter. They have no receipt in their name, and TutoringHQ does not answer their erasure requests in the first place. Without this distinction a center could refuse a parent's request citing tax law, which would be wrong.

---

## D. Verified as already correct, do not change

- **"We never ask for your PIN."** Appears twice in the design. True and worth keeping; a request form that asks for a secret is how people get phished.
- **"At no charge."** True for erasure requests.
- **Center as controller, platform as processor**, for student and parent data. Correct as written and consistent with the DPA.
- **The Paymob wording.** Card data handled entirely by Paymob and never stored. Still true.

---

## E. Still open, will add more here

These are not yet decided and each may add to this ledger:

- **Analytics and Benchmarks as paid add-ons.** Undecided. If they become purchases, the Terms need a section on add-on purchases.
- **The group billing basis**, per session versus monthly versus bundle-of-N. Undecided. Changes how tuition is calculated and may change what the Terms say about fees.
- **The four duplicate money surfaces.** `/billing` and `/settings/billing`, `/teacher/billing` and `/teacher/pay`, two referrals routes, two legal routes. **`/terms` carries a processing-fee disclosure that `/legal/terms` does not**, so consolidating without care drops a disclosure.
- **The two meanings of "processing fee."** Live code has a flat 20 EGP on a subscription invoice paid by the center. The design has 1.5% + 1.5 EGP on tuition paid by the parent. Both appear in the design set. The Terms must not use the phrase ambiguously.
- **Adsero's answer** on whether registration or a licence is required under Law 151/2020. The question is written out in `DECISION-national-id-2026-07-26.md` section 6.

---

## How to use this file

Add to it as decisions land. When the last item in section E is closed, rewrite all five documents
plus `Merged-Public-Legal` in one pass, in both languages, then hand the set to Adsero.

Rewriting earlier means rewriting twice.
