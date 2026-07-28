# Legal change ledger

**Opened 26 July 2026. Replaces `LEGAL-AMENDMENTS-2026-07-26.md`, which is deleted.**

**No draft edits. Every change is an entry here until the ledger is closed.**

## Standing note — I cannot read the drafts

The Privacy Policy, Terms, Cookie Policy and DPA full texts are **not in this repository**. `/legal/dpa`
renders section headings with `[This section will be completed upon legal review]` placeholders, and a
search for "retention obligation" returns zero files. `Merged-Public-Legal.html` is a **reader sample**
— its own lede says *"Wording follows the Adsero drafts"* — showing three of six DPA sections and
three of seven Privacy sections.

**Every clause reference below is from Eyad's reading, not mine.** Where I assess wording I say so
explicitly and mark it as reasoning about a quoted phrase, not a reading of the clause in context.

### Correction, 26 July

I read the truncated design as an incomplete legal document and wrote DPA bodies for §4
Sub-processors and §6 Deletion. **Those clauses already exist** — §8 lists ten sub-processors, §9
covers retention and deletion, §11 covers assisting the controller with data-subject requests.
**Both additions have been reverted from the design**; the DPA reader is back to its original three
rendered sections. Duplicate clauses in one agreement are worse than a gap.

---

# Open entries

## L-01 · DPA 9.1 — twelve-month deletion promise needs a provider-limb carve-out

**Status:** open · **Type:** amendment · **Decides:** Adsero

9.1 promises deletion twelve months after termination, **for everybody**. The provider tax retention
has no exception attached to it.

**The carve-out must attach to the provider limb only.** A center or teacher has a payout record; a
student or parent does not, so nothing in the retained skeleton could ever be about them. Citing a tax
carve-out to a parent would be both wrong and alarming.

**Proposed sub-clause, provider limb only:**

> …except the financial skeleton of any payout made to the Provider, which Egyptian tax law requires
> us to retain for **[statutory period — pending Adsero]**. That skeleton is the Provider's National
> ID number, legal name, the amounts, the dates and the receipt references, and nothing else.

**⚠ If 9.1 is written once, for everybody, it needs splitting** so the exception cannot be read as
applying to student or parent data. That is the substantive drafting question here.

## L-02 · DPA 9.2 — does "subject to any legal retention obligations" already cover it?

**Status:** open · **Type:** question · **Decides:** Adsero

9.2 promises early deletion within thirty days *"subject to any legal retention obligations"*.

**I cannot read the clause — the DPA is not in the repo.** What follows is reasoning about the quoted
phrase alone, and should be checked against the actual wording.

**My read: it probably covers the *permission* and probably fails the *disclosure*.**

| | |
|---|---|
| **Does it permit us to retain?** | **Almost certainly yes.** That is exactly what a saving clause of that form does. We would not be in breach of 9.2 by keeping the skeleton. |
| **Does it tell the provider what is kept?** | **No.** It names no fields. A provider reading it cannot tell whether we keep their ID, their bank account, or their whole roster. |
| **Does it tell them how long?** | **No.** No period, no anchor, no end date. |
| **Does it create a duty to inform them what was retained?** | **No.** |

Under Law 151 of 2020 the data subject has a right to know what is held and why. A generic saving
clause protects the *contract*; it does not discharge the *transparency* duty. And commercially, a
provider who asks for deletion and is told "some things may be kept" without being told which will
assume the worst.

**Recommendation: keep 9.2's phrase and add a specific sub-clause under it** naming the five fields
and the clock, rather than rewriting 9.2. The general saving clause still does useful work for
everything that is not the tax skeleton.

**Question for Adsero:** is the generic phrase sufficient on its own, or does the specific retention
need naming? My assessment is that it is legally sufficient and practically insufficient — but that is
a judgement about drafting, not about Egyptian law, and it is yours and Adsero's to make.

## L-03 · DPA 8.1 — Valify is not listed as a sub-processor

**Status:** open · **Type:** gap · **Decides:** Eyad, then Adsero

8.1 lists ten sub-processors. **Valify is not among them.** This is a real gap, not a design artefact.

Valify receives a National ID and a selfie from a center owner or teacher who turns on online
collection. That is processing on our behalf, by a party outside our organisation, and it must be
disclosed before the processing starts.

**Proposed addition to the 8.1 schedule:**

> **Valify** — identity verification (e-KYC). Egypt. Receives the National ID and a selfie of a center
> owner or teacher who enables online collection, submitted by them directly on Valify's own hosted
> page. **Never receives student or parent data.**

Three things that line is doing: it names what Valify gets, it records that the submission is
**direct from the provider on Valify's page** rather than relayed by us, and it states the negative —
which is what the center actually cares about, since the DPA is their agreement about their students.

**Sequencing:** this must be in place **before** the first verification runs in production. A
sub-processor not on the schedule is a disclosure failure from the first transaction.

## L-04 · DPA 11 — proposed amendment, confirm erasure in writing

**Status:** open · **Type:** proposed amendment, not a gap · **Decides:** Adsero

**11 already covers the processor duty adequately** — we do not respond to data-subject requests
directly and instead assist the controller. **No new clause is needed and none is proposed.**

What is proposed is a small addition:

> When the Controller instructs us to erase Personal Data, **we confirm completion to the Controller in
> writing**, so the Controller holds a record it can provide to the data subject.

**Why it is worth adding:** the center is answerable to the parent within its own thirty-day window,
and right now it has nothing to show that we acted. A written confirmation is the artefact that closes
the loop. It costs us nothing and it is the difference between a center saying "I asked them" and a
center holding proof.

**Explicitly not proposed:** anything restating that we act only on instruction, that we do not judge
validity, or that we do not charge. 11 covers those.

## L-05 · Privacy — remove two false claims

**Status:** **applied to the design**, pending in the drafts · **Decides:** Adsero

| Where | Remove |
|---|---|
| Summary | the sentence containing *"We do not process sensitive personal information"* |
| Section 1 | the same claim, and *"We do not collect any information from third parties."* |

Both became false the moment verification was specified. Valify is a third party that returns data to
us, and a national identifier is sensitive under any reasonable reading of Law 151.

**Design status:** removed from `Merged-Public-Legal.html`, both languages. The Paymob sentence that
followed is kept.

## L-06 · Privacy — new section on the National ID

**Status:** **applied to the design**, pending in the drafts · **Decides:** Adsero

Placed immediately after "What data we collect", so a reader meets it where they are told what is
collected. Design renumbered to seven sections, both languages.

> If you are a center or a teacher who turns on online collection, we verify your identity through
> **Valify**, our identity-verification partner. You are taken to Valify's own page to present your
> National ID and a selfie. **The document never reaches us.** Valify tells us the outcome, and we keep
> your **National ID number**, your **legal name** and the **date you were verified**.
>
> We keep it because Egyptian tax law requires the payee's National ID on the electronic receipt we
> issue to the Tax Authority each time we pay you your share. Our legal basis is **compliance with a
> legal obligation**, not your consent — which means you cannot withdraw it while the obligation
> stands, and we cannot delete it on request. We keep it for **[statutory period — pending Adsero]**
> after your last payout, then erase it.

Four deliberate choices: the purpose is named **narrowly** (the ETA e-receipt, not "compliance"); the
basis is **legal obligation, not consent**, and says plainly what that means for withdrawal; the
document is stated **never held**; and the retention has a **start point**, because a period without
an anchor is unenforceable.

## L-07 · Privacy — erasure carve-out, provider-scoped

**Status:** **applied to the design**, pending in the drafts · **Decides:** Adsero

Closes the National ID section (L-06), which is already gated on *"if you are a center or a teacher
who turns on online collection"*.

> **So if you close your account, this one part stays.** We erase everything else and keep only the
> **financial skeleton** of what we paid you: your National ID number, your legal name, the amounts,
> the dates and the receipt references. Not your payout account, not your tax card, nothing else. We
> tell you what was kept and the exact date it goes.

**It was first placed in "Your rights under the PDPL" and moved.** That section is read by parents and
students, and the carve-out does not apply to them. That section is back to its original text.

**The financial skeleton:** ID number, legal name, amounts, dates, receipt references. The minimum
that makes a tax record legible to an inspector — who was paid, how much, when, against which receipt.
**The payout destination is erased.** We must show we paid Aly Shady 1,200 EGP on 12/07 against
receipt EX-1187; we do not need his bank account to prove it.

## L-08 · The fallback stays exactly as designed

**Status:** verified unchanged · **Decides:** nobody, this is settled

> *"For access, correction or deletion, contact your center first. **If your center has closed or
> cannot help, you may contact us directly using the data rights form.**"*

Untouched and unweakened. A parent whose center vanished has nobody else to ask. Logged so that no
later pass trims it as redundant.

## L-09 · Version bump on both documents

**Status:** open · **Type:** housekeeping · **Decides:** Eyad

The design carries **Version 2.0 · 22 June 2026** on every document header. L-05 through L-07 are
material changes to what is collected and on what basis, so both documents need a new version and
date, and existing customers need telling. The design renders the version string, so it changes too.

---

# Product decisions logged here for the record

Not legal changes, recorded so the ledger is the single dated trail of what was settled on 26 July.

| | Decision |
|---|---|
| **Analytics** | Stays on the `canViewRevenue` permission gate. Not a paid add-on. Paid add-ons **return when AI features ship** — parked, not killed. No purchase flow. |
| **Benchmarks** | Stays free. Existing data-sufficiency gate stands. Same parking note. |
| **Group billing basis** | `fee_per_class` only. Where a design shows per-session, monthly or bundle-of-N, build the `fee_per_class` equivalent and record the difference. **Deferred, not rejected.** |
| **The 22 undesigned routes** | Keep every one, delete none, flag each for design → `design/NEEDS-DESIGN.md`. |
| **The four duplicate pairs** | No merge. Facts gathered → `design/DUPLICATE-ROUTES.md`. Two carry something that must move first: the lapsed-teacher payment path on `/teacher/pay`, and the processing-fee disclosure on `/terms`. |
| **Verification** | Stays blocked on Adsero. Where a screen has a Verified variant, **build the unverified one and leave the variant.** |

---

# Open questions

| | Decides |
|---|---|
| **The statutory retention period.** Every entry says `[statutory period — pending Adsero]`. No number invented. | Adsero / accountant |
| **L-02** — is the generic saving clause sufficient, or does the retention need naming? | Adsero |
| **L-01** — is 9.1 written once for everybody, and does it need splitting? | Adsero |
| **Can the skeleton be pseudonymised?** Hash the ID for storage, hold plaintext only in the issued receipt PDFs. | Adsero |
| **Should provider "erasure with a carve-out" be framed as restriction of processing** rather than erasure? A record keyed to an ID, a name and amounts remains personal data for the whole period. | Adsero |
| **Is the 8.1 list of ten still accurate** beyond the Valify gap? | Eyad |

---

# Undrawn screens this implies

Not legal text, but they follow from it and exist nowhere in the 105 designs:

- **Provider deletion confirmation** — what was kept, why, and the exact date it goes. A date, not a duration: "14 March 2033" is a fact; "seven years" is a sum someone has to do.
- **Student / parent deletion confirmation** — a different screen that says none of the above, and where the request came via the fallback, notes the center was unreachable.
