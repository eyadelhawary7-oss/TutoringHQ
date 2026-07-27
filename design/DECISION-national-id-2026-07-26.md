# National ID collection: purpose, basis, retention

**Decided 26 July 2026 by Eyad El-Hawary.** Design and policy specification.
Nothing here is built. It is the input to `design/VERIFICATION-SPEC.md`, to the privacy policy
amendment, and to the erasure flow.

**Status: draft for Adsero review.** The decisions are made; the question to counsel is narrow and
sits at the end.

---

## 1. Why the number is collected

TutoringHQ collects tuition from parents and passes 90% to the provider, the center or the
independent teacher, keeping 10%.

**TutoringHQ issues the e-receipt to the provider for that 90%**, self-billing through ETA. That
makes the 90% a deductible cost rather than TutoringHQ revenue, so corporate tax falls on the 10%
margin rather than on the gross fee.

**ETA requires the counterparty's national ID on that receipt.** That, and only that, is why the
number is collected.

Three consequences follow, and they matter:

- **The number is not an identity check.** Valify returns a pass or a fail; the ID number is a separate field required by tax law. They travel together for convenience, not because one implies the other.
- **It is collected from providers, never from parents.** Parents are not counterparties to any receipt TutoringHQ issues. A few hundred numbers over the life of the business, collected once at onboarding.
- **It is not optional and it cannot be hashed.** ETA needs the number itself on the receipt. A one-way hash would satisfy an identity or deduplication purpose; it does not satisfy this one.

---

## 2. Legal basis

**Compliance with a legal obligation**, not consent.

This is the stronger basis and it should be stated as such in the policy. TutoringHQ does not choose
to collect the number; Egyptian tax law requires it on the receipt. Two things follow:

- **There is no opt-out.** A provider who declines cannot be paid out through the platform, because no lawful receipt can be issued.
- **The consent language elsewhere in the privacy policy does not apply to this field**, and the amendment must make that separation clear rather than sweeping it in with everything else.

---

## 3. What is stored, and what is not

| | |
|---|---|
| **Stored** | National ID number. Verification status. Verification timestamp. Valify provider reference. |
| **Never stored** | The ID document image, front or back. Photograph. Address. Religion. Marital status. Any Valify intermediate data. |

**The document never touches TutoringHQ infrastructure.** Verification runs as a redirect to a
Valify-hosted flow, decided 26 July 2026. The user leaves the app, completes the check with Valify,
and returns with an outcome.

The front of an Egyptian national ID carries **religion and marital status**, both sensitive under
Law 151/2020 in their own right. Never capture or store that image. Where a name is needed, use the
one Valify returns.

**The number itself remains sensitive data.** Its digits encode date of birth, governorate of birth
and sex. The redirect removes the document from the risk surface; it does not make the number
ordinary personal data.

---

## 4. Retention, and the conflict it creates

**Tax records are retained for the statutory period, currently five years, and are not erased on
request.**

This conflicts with two existing commitments:

- The privacy policy promises deletion or anonymisation no later than **twelve months** after account termination.
- The PDPL right to erasure is advertised on the data rights form with a **thirty day** window.

Both need amending. The policy already carves out security records for five years, so the shape
exists; tax records need their own carve-out on the same pattern.

### How erasure actually works

**Erase everything except the financial skeleton. Retain the skeleton for the statutory period.**

| Erased on request | Retained for the statutory period |
|---|---|
| Profile, photo, contact preferences | National ID number |
| WhatsApp settings and message history | Legal name as it appears on receipts |
| Students, groups, attendance records | Receipt amounts and dates |
| Anything not on a receipt | Receipt references and ETA submission records |

**A provider making an erasure request must be told plainly which records are kept, why, and for how
long.** A refusal without a reason is what turns a data request into a complaint.

> **Flagged for Eyad.** The instruction was "do not erase any data for tax purposes." This document
> reads that as the financial skeleton, not the entire account, because tax law requires the invoice
> record and nothing more. It does not require a provider's WhatsApp preferences or their students'
> data. Refusing erasure wholesale would make the advertised PDPL right meaningless and would put
> the platform in conflict with a law it is already telling users it follows. **Overrule this if a
> broader retention was intended.**

---

## 5. What has to change in the legal documents

Five places currently contradict this and must be amended together.

1. **Privacy policy, summary.** "We do not process sensitive personal information." No longer true.
2. **Privacy policy, section 1.** Same sentence, repeated.
3. **Privacy policy, Arabic reader in `Merged-Public-Legal`.** Same claim, in Arabic.
4. **Privacy policy, summary.** "We do not collect any information from third parties." Valify returns a verification outcome. No longer true.
5. **Data Processing Agreement.** Valify is not named as a sub-processor. It must be.

A new section is needed covering: what is collected, why, the legal basis, that the document is
never held, the retention period, and the erasure carve-out. In both languages.

Two design screens also contradict the redirect decision and show an in-app upload:
`Merged-Center-Setup` and `Merged-Teacher-Setup`. Both need respecifying as a handoff.

---

## 6. The question for Adsero

One question, not a research brief:

> TutoringHQ self-bills providers, tutoring centers and independent teachers, for their 90% share of
> tuition it collects, and issues the e-receipt through ETA. ETA requires the counterparty's national
> ID number on that receipt, so the number is collected once at onboarding and retained for the
> statutory tax period. Identity verification itself runs as a redirect to Valify, a licensed
> processor; TutoringHQ never receives or stores the ID document, only the number, a status, a
> timestamp and a provider reference.
>
> **Does TutoringHQ, as controller, require registration or a licence under Law 151/2020 to process
> sensitive personal data on these facts? And what retention period applies, given the tension
> between the PDPL erasure right and the tax obligation?**

Adsero is already engaged and already reviewing these documents. This is one question, and the
answer either confirms the position or prevents twenty-one screens being built on a wrong one.

---

## 7. Open, and not decided here

- **Whether payouts can ship on bank verification alone**, IBAN and account holder name, while identity verification waits. Neither is sensitive data, so that path may not be blocked at all. Worth establishing, because it may be a shippable route in the meantime.
- **Whether ETA has a threshold** below which the counterparty ID is not required. If so, small providers may not need it at all.
- **The VAT treatment of the 90% pass-through.** Deducting it as a cost is the intent; the VAT mechanics of self-billing through ETA sit outside this document and need their own answer.
