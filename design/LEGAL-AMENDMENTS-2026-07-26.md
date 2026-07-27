# Legal amendments — national ID, Valify, erasure

**Written 26 July 2026. Design and legal text only. No code.**
Companion to `VERIFICATION-SPEC.md`. Amend before Adsero reads, not after.

## Two things I could not find

**1. `design/DECISION-national-id-2026-07-26.md` does not exist.** Not in the working tree, and not in
any commit on any branch — I checked the full history. Everything below is written from the
instructions in your message plus `VERIFICATION-SPEC.md`. **If that decision document exists
elsewhere, this needs re-checking against it**, particularly the retention period.

**2. The legal drafts are not in this repository.** The only file containing the sensitive-data
sentence is `Merged-Public-Legal.html`, the design. Your quotes differ slightly from it —

| You quoted | The design says |
|---|---|
| "We do not process sensitive personal information" | *"We do not process sensitive data"* |
| "We do not collect any information from third parties." | *"we do not collect anything from third parties"* |

— which suggests the drafts are a separate document. **I have amended the design. §2 below is
drop-in text for the drafts, for you to apply.**

Also absent from the repo: the **twelve-month deletion promise** and the **five-year security records
carve-out**. Neither phrase appears in the design, the docs, or the message catalogues. In the design,
Privacy §"How long we keep it" is **a heading with no body** — the retention promise lives only in the
drafts. So §3 below gives the carve-out **pattern** rather than editing text I cannot see.

**Every retention period below is written as `[statutory period — pending Adsero]`. I have not
invented a number.**

---

# 1. What was amended in the design — done

`design/Merged-Public-Legal.html`, both languages.

## 1.1 Removed

| Where | Removed |
|---|---|
| Privacy §1, EN | *"We do <b>not</b> process sensitive data, and we do <b>not</b> collect anything from third parties."* |
| Privacy §1, AR | *"إحنا <b>مابنعالجش</b> بيانات حسّاسة، و<b>مابنجمعش</b> أي حاجة من أطراف تانية."* |

The Paymob sentence that followed is kept — it is true and still useful.

## 1.2 Added — Privacy, new §2 "Your National ID, if you collect online"

Inserted as **§2**, pushing the existing §2–§6 down one. Both TOCs and both sets of body headings
renumbered to seven sections.

> **EN.** If you are a center or a teacher who turns on online collection, we verify your identity
> through **Valify**, our identity-verification partner. You are taken to Valify's own page to present
> your National ID and a selfie. **The document never reaches us.** Valify tells us the outcome, and we
> keep your **National ID number**, your **legal name** and the **date you were verified**.
>
> We keep it because Egyptian tax law requires the payee's National ID on the electronic receipt we
> issue to the Tax Authority each time we pay you your share. Our legal basis is **compliance with a
> legal obligation**, not your consent — which means you cannot withdraw it while the obligation
> stands, and we cannot delete it on request. We keep it for **[statutory period — pending Adsero]**
> after your last payout, then erase it.

The Arabic is written, not translated, in the same register as the rest of that screen.

**Four things that sentence set is doing deliberately:**

1. **Names the purpose narrowly** — the ETA e-receipt for the provider's own 90% share. Not "for compliance", not "for security".
2. **Names the legal basis as a legal obligation, not consent.** This is the load-bearing part. Consent is withdrawable; a legal obligation is not, and the text says so plainly rather than leaving the user to discover it at erasure time.
3. **States the document is never held**, which is what makes the redirect architecture a privacy claim rather than an implementation detail.
4. **Gives the retention a start point** — "after your last payout" — because a period with no anchor is unenforceable.

## 1.3 Added — DPA §4 Sub-processors

The heading existed in the contents list with **no body**. Now populated, both languages:

> We use these sub-processors, each under a written agreement no weaker than this one. We tell you
> before we add or replace one, and you may object.
>
> - **Paymob** — payment processing. Egypt.
> - **Valify** — identity verification. Egypt. Receives the National ID and selfie of a center owner or teacher who turns on online collection, directly from them on Valify's own page. **Never receives student or parent data.**
> - **Supabase** — database and authentication hosting.
> - **Vercel** — application hosting.
> - **Meta** — WhatsApp message delivery.

⚠ **Paymob, Supabase, Vercel and Meta are my inference from the live stack, not from any legal
document.** They belong on a sub-processor list and their absence was already a gap. **Confirm the
list is complete and correct before Adsero sees it** — a sub-processor list that omits one is worse
than none.

The Valify line carries the load: it says what Valify gets, from whom, where, and — critically — what
it never gets. The DPA is the center's agreement, and the center's concern is its students.

## 1.4 Added — Privacy erasure carve-out, **provider-scoped**

**Corrected 26 July.** It first went into Privacy "Your rights under the PDPL" — the general section a
parent reads. **Moved.** It now closes the new §2, which is already gated on *"if you are a center or
a teacher who turns on online collection"*, and the student-data language is gone.

> **So if you close your account, this one part stays.** We erase everything else and keep only the
> **financial skeleton** of what we paid you: your National ID number, your legal name, the amounts,
> the dates and the receipt references. Not your payout account, not your tax card, nothing else. We
> tell you what was kept and the exact date it goes.

**"Your rights under the PDPL" is back to its original text.** A parent reading it sees no tax
carve-out, because none applies to them.

## 1.5 Added — DPA §6 Deletion, our processor duty

Another heading with no body. Now populated, both languages:

> **Your students' and parents' data is yours, not ours.** You are the controller. If a student or
> parent asks to be erased, they ask you, and you instruct us.
>
> When you instruct us to erase student or parent data, **we do it and we confirm back to you in
> writing**, so you have a record to give the person who asked. We do not decide whether the request is
> valid — that is yours to judge. We do not charge for it, and we do not keep a copy afterwards.
>
> The one exception is a backup already written, which is purged on its next cycle. Nothing in this
> section is affected by the tax record we keep about **you** — that covers what we paid you, and never
> student or parent data.

Three things it settles: the duty is **owed to the center**, not the parent; we **confirm in writing**
so the center can answer the person who asked; and we **do not judge validity**, which keeps the
controller/processor line clean.

## 1.6 Untouched — the fallback

Privacy §4 is unchanged and unweakened:

> *"For access, correction or deletion, contact your center first. **If your center has closed or
> cannot help, you may contact us directly using the data rights form.**"*

A parent whose center vanished has nobody else to ask.

---

# 2. Drop-in text for the drafts

**Apply these to the legal drafts. I could not, because the drafts are not in the repo.**

## 2.1 Privacy policy — delete

- In the **summary**: the sentence containing *"We do not process sensitive personal information"*.
- In **section 1**: the same claim, and the sentence *"We do not collect any information from third parties."*

Both are now false. Valify is a third party that returns data to us, and a national identifier is
sensitive under any reasonable reading of Law 151 of 2020.

## 2.2 Privacy policy — insert a new section

Use the §1.2 text above verbatim, EN and AR. Place it immediately after "What data we collect", so a
reader meets the ID at the point they are told what is collected rather than in a retention annex.

## 2.3 DPA — add Valify to the sub-processor schedule

Use the §1.3 line. If the drafts already carry a sub-processor schedule, add Valify to it and
reconcile against the five above.

## 2.4 Both documents — version bump

The design carries **Version 2.0 · Updated 22 June 2026**. These are material changes to what is
collected and on what basis, so both need a new version and date, and existing customers need telling.
`Merged-Public-Legal` renders the version string on every document header.

---

# 3. Erasure — the split

## 3.0 Scope: this is a PROVIDER matter only

**The tax carve-out applies to centers and teachers, and is never cited to a parent or student** —
because we do not answer their erasure requests at all.

| Who asks | Who answers | Carve-out applies? |
|---|---|---|
| A **center or teacher** about their own account | **Us.** We are the controller for provider data. | **Yes** — §3.1 |
| A **student or parent** | **Their center or teacher.** They are the controller; we are the processor and act on their instruction (DPA §6). | **No. Never mentioned.** |
| A **student or parent whose center has closed or cannot help** | **Us**, directly, via the data-rights form. Unchanged and unweakened. | **No** |

A parent has no payout record, so nothing in the skeleton could be about them. Citing a tax carve-out
to a parent would be both wrong and alarming.

## 3.1 The rule, for providers

**Everything is erased except the financial skeleton.**

| Kept — the financial skeleton | Erased |
|---|---|
| National ID number | Groups, rooms, branches, schedule |
| Legal name | Attendance records |
| Amounts | WhatsApp messages and templates |
| Dates | Login credentials, PIN hash, sessions |
| Receipt references | **Payout destination (IBAN, wallet)** |
| | Tax card number |
| | Analytics, benchmarks, referral graph |
| | Everything else |

Retained for **[statutory period — pending Adsero]**, then erased too.

**The skeleton is the minimum that makes a tax record legible to an inspector**: who was paid, how
much, when, against which receipt. Anything that answers none of those is not in it — note the
**payout destination is erased**. We must show we paid Aly Shady 1,200 EGP on 12/07 against receipt
EX-1187. We do not need his bank account to prove it.

**Student and parent records are not on either side of this table.** When a provider closes their
account, the student data they control goes with it — but as the controller's own deletion, not under
our carve-out.

## 3.2 Carve-out pattern for the two promises

Both take the same shape as the existing five-year security-records carve-out: a general promise, then
a named exception with its own clock. **Both belong in the provider-facing part of the drafts.**

**The twelve-month deletion promise** →

> We delete your data within twelve months of your account closing, **except the financial skeleton of
> any payout we made to you, which Egyptian tax law requires us to keep for [statutory period —
> pending Adsero]. That skeleton is your National ID number, your legal name, the amounts, the dates
> and the receipt references, and nothing else.**

**The thirty-day erasure window** →

> We act on a verified erasure request within thirty days, **except the financial skeleton of any
> payout we made to you. We will tell you within the same thirty days exactly what was kept, why, and
> the date it will be erased.**

**Both exceptions name the same five fields and the same clock.** Two retention rules on one record is
how this gets got wrong later.

⚠ **Neither clause may appear in any student- or parent-facing text.** If the drafts state the
twelve-month promise once, for everybody, it needs splitting so the exception attaches only to the
provider limb.

## 3.3 What a provider is told

Not a legal notice — a plain screen at the moment they ask. **This state is undrawn anywhere in the
105 designs** and needs adding to `Merged-Public-Legal`'s data-rights confirmation, as a
**provider-only** variant.

> **Your data is deleted.** We removed your groups, attendance, messages, contact details and login.
>
> **We had to keep one thing.** Egyptian tax law requires us to keep the record of what we paid you:
> your National ID number, your name, the amounts, the dates and the receipt references. Nothing else,
> and nobody uses it for anything but tax.
>
> **It is erased on [date].** You do not need to do anything.

**A specific date, not a duration.** "Seven years" is a number someone has to compute; "14 March 2033"
is a fact.

**The student/parent confirmation is a different screen** and says none of this. It confirms the
erasure and, where the request came through the fallback, says the center was unreachable.

## 3.4 The consequence to check with Adsero

**For providers, this is not a full erasure and the policy should not call it one.** A record keyed to
a National ID, a legal name and payment amounts remains personal data for the whole retention period.
The right framing is *restriction of processing* — kept, not used — a distinct right under Law 151.

**Worth asking whether the skeleton can be pseudonymised**: hash the ID for storage, hold the
plaintext only in the issued receipt PDFs. Whether an inspector accepts that is their call.

---

# 4. Still needed before Adsero reads

| | Needed from |
|---|---|
| **The statutory retention period.** Every clause above says `[statutory period — pending Adsero]`. | Adsero / accountant |
| **Confirm the sub-processor list is complete.** Five named from the live stack; unverified against any legal document. | You |
| **The legal drafts themselves**, if the design and the drafts are to stay in step. | You |
| **`DECISION-national-id-2026-07-26.md`**, if it exists. | You |
| **Whether the skeleton may be pseudonymised** (§3.4). | Adsero |
| **Whether the twelve-month promise is written once for everybody**, in which case it needs splitting so the exception attaches only to the provider limb (§3.2). | You / Adsero |
| **Whether "erasure with a carve-out" should be framed as restriction of processing** (§3.4). | Adsero |
