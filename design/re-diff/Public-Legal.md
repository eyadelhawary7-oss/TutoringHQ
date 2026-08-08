# Re-diff — `Merged-Public-Legal.html` vs LIVE

**File:** `/home/user/TutoringHQ/design/Merged-Public-Legal.html` (512 lines, 45,913 bytes)
**Scratch:** `/tmp/rediff/public-legal`
**Date:** 8 August 2026 · dev server `localhost:3000`
**Model:** Opus 5

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Public-Legal.html | wc -l
14
```

**14 frames**, one screen (`01 · Public Legal ← Screen-Public-Legal.html`).

---

## 2. Frames / sections enumerated

One screen, 14 frames — 7 states × 2 locales. English and Arabic are separate screens.

| # | Frame caption | Live route | Result |
|---|---|---|---|
| 1 | `EN · legal index` | `/en/legal` | measured |
| 2 | `AR · الفهرس` | `/ar/legal` | measured |
| 3 | `EN · privacy policy` | `/en/legal/privacy` | measured |
| 4 | `AR · سياسة الخصوصية` | `/ar/legal/privacy` | measured |
| 5 | `EN · terms and conditions` | `/en/legal/terms` | measured |
| 6 | `AR · الشروط والأحكام` | `/ar/legal/terms` | measured |
| 7 | `EN · cookie policy` | `/en/legal/cookie` | measured |
| 8 | `AR · سياسة الكوكيز` | `/ar/legal/cookie` | measured |
| 9 | `EN · data processing agreement` | `/en/legal/dpa` | measured |
| 10 | `AR · اتفاقية معالجة البيانات` | `/ar/legal/dpa` | measured |
| 11 | `EN · request form` | `/en/legal/privacy-request` | measured |
| 12 | `AR · النموذج` | `/ar/legal/privacy-request` | measured |
| 13 | `EN · submitted` | post-POST state of `/legal/privacy-request` | **blocked** |
| 14 | `AR · تم الإرسال` | post-POST state of `/legal/privacy-request` | **blocked** |

**Routes captured: 15/15**, every one `ok:true`, `stillSkeleton:false`, `pageErrors:[]`, `httpErrors:[]`.
Two batches: 8 + 7 = 15. The three legacy aliases are extra route coverage, not extra frames — the manifest confirms all three are permanent redirects into frames 3, 5 and 7:

| Legacy route | `finalUrl` |
|---|---|
| `/en/privacy` | `/en/legal/privacy` |
| `/en/terms` | `/en/legal/terms` |
| `/en/cookies` | `/en/legal/cookie` |

Source: `src/app/[locale]/privacy|terms|cookies/page.tsx`, each a `permanentRedirect`. The old duplicate `legal.*` message namespace is down to two title strings (`legal.terms.title`, `legal.privacy.title`) — the contradictory second Privacy/Terms pair is gone.

**Documents:** 23 sections across four documents; **13 drafted + 10 pending = 23**. The ten pending render one explicit `Pending Adsero draft.` / `تحت الصياغة من Adsero.` line rather than invented copy — verified visually in every reader capture, and locked by the parity test.

---

## 3. Accounting

```
Drawn: 14 | Exercisable: 12 | Exercised: 12 | Blocked: 2
```

**Blocked frames, named:**

| Frame | Reason | Detail |
|---|---|---|
| 13 · `EN · submitted` | `by-design` | The `done` state is local React state (`privacy-request/page.tsx:72`, `:112`) set only on a 201 from `POST /api/privacy-request`. There is no query param or route that reaches it. Submitting inserts a real row into production `privacy_requests`, inserts an `admin_alerts` row, and fans an `in_app_notifications` row out to **every** platform admin. Not exercised — that is a production write with a human notification blast, not a screenshot. |
| 14 · `AR · تم الإرسال` | `by-design` | Same state, Arabic side. |

The confirmation branch is fully implemented (`privacy-request/page.tsx:123-188`) — this is a reachability limit, not a build gap.

12 exercised + 2 blocked = 14 drawn.

---

## 4. `legalCorpusParity` — verbatim

```
$ npx vitest run tests/unit/legalCorpusParity.test.ts --reporter=verbose

 RUN  v4.1.2 /home/user/TutoringHQ

 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — design fixture is readable > finds exactly two reader frames per document 3ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — design fixture is readable > pairs each frame with the right document by title 1ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — contents lists match the design > 'privacy' lists the design’s sections, in order, in both languages 2ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — contents lists match the design > 'terms' lists the design’s sections, in order, in both languages 1ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — contents lists match the design > 'cookie' lists the design’s sections, in order, in both languages 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — contents lists match the design > 'dpa' lists the design’s sections, in order, in both languages 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split > 'privacy' drafts prose for exactly the sections the design drafts 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split > 'terms' drafts prose for exactly the sections the design drafts 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split > 'cookie' drafts prose for exactly the sections the design drafts 1ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split > 'dpa' drafts prose for exactly the sections the design drafts 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split > leaves ten of the twenty-three sections pending, and no more 1ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — X4: drafted vs pending is exactly the design’s split > renders a pending section as an explicit line, never as invented copy 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — no half-translated string reaches a reader > has both sides of every bilingual tuple filled 0ms
 ✓ tests/unit/legalCorpusParity.test.ts > Merged-Public-Legal §01 — no half-translated string reaches a reader > closes every `**bold**` marker it opens 1ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  02:18:51
   Duration  346ms (transform 87ms, setup 0ms, import 110ms, tests 15ms, environment 0ms)
```

**14 passed, 0 failed.** Necessary, not sufficient — see §5, where the green result is exactly the "both sides wrong together" case.

---

## 5. FALSE STATEMENTS in live legal copy about the CURRENT model

### 5.1 — HEADLINE: *"All payments are processed by Paymob."*

**Live, both locales, Terms §2 "Payment and Paymob":**

- EN (`/tmp/rediff/public-legal/en_legal_terms.txt:24`):
  > **All payments are processed by Paymob, our authorized Egyptian processor.** We never collect or store your card details. Completing a payment authorizes Paymob to charge the applicable fees on our behalf.
- AR (`ar_legal_terms.txt:24`):
  > **كل المدفوعات بتتم من خلال Paymob**، معالج الدفع المصري المعتمد بتاعنا. إحنا مابنجمعش ولا بنخزّن بيانات كارتك أبدًا. إتمام الدفع بيخوّل Paymob إنه يحصّل الرسوم نيابةً عننا.

**Source:** `src/app/[locale]/legal/legalContent.ts:213` (en) / `:214` (ar).
**Published on:** `/en/legal/terms`, `/ar/legal/terms`, plus the `/en/terms` legacy redirect. Linked from the public `MarketingFooter`, and deep-linked from the signup consent checkboxes (`src/app/[locale]/signup/SignupForm.tsx`, `src/app/[locale]/teacher/signup/page.tsx`).

**Why it is false.** NEW-MODEL's one sentence: *tuition never touches the platform* — a parent transfers directly to the center or teacher by InstaPay and the platform records and matches it. Paymob is not in that path at all. "All payments" is an unqualified universal, and it now misdescribes the entire tuition rail *and* the 10 EGP service fee a parent is billed per confirmed receipt. This is copy asserting a collection rail the new model retracted.

The **third** sentence is fine and should stay: "authorizes Paymob to charge the applicable fees **on our behalf**" is the platform charging its own customer — NEW-MODEL's stated exception.

**Corroborating evidence — the corpus describes only the old rail.** Across all 15 captures there are **zero** occurrences of `instapay | service fee | 10 EGP | ١٠ ج | رسم خدمة | إنستاباي`. The published legal corpus contains no description of the InstaPay tuition flow, no mention of the 10 EGP per-receipt service fee, and no statement that the platform never holds tuition. Paymob is presented as the only rail that exists.

**This is a both-sides-stale case, which is why parity is green.** The design carries the identical sentence at `design/Merged-Public-Legal.html:279` (EN) and `:306` (AR). `legalCorpusParity` compares live against the design and passes — the app faithfully reproduces a stale design. Fixing the app alone would turn the test red; the design line has to move with it.

### 5.2 — Terms §1: "each with a 14-day free trial" is false for 2 of 3 teacher plans

**Live** (`en_legal_terms.txt:22`, `legalContent.ts:197`):
> Teachers have Standard, Pro and Scale, **each with a 14-day free trial**.

**Live code** (`src/lib/teacherPlans.ts`): `teacher_standard` → `trialDays: 14`; `teacher_pro` → `trialDays: 0`; `teacher_scale` → `trialDays: 0`. One of three plans carries a trial. The file's own header comment says so: *"Standard (499) — up to 20 active students. 14-day free trial."* — named for Standard only.

A published commercial promise the product does not honour on two plans. Also verbatim in the design (`Merged-Public-Legal.html:277`, AR `:304`), so the same both-sides fix applies.

### 5.3 — Terms §1: billing intervals are stated as two, the product sells three

Live: *"billed in Egyptian Pounds monthly or annually."* `src/lib/pricing.ts` `getPlanPrice` handles `quarterly` (`quarterlyAllIn * 3`), `monthly` and `annual`, with quarterly as the switch default; the plan table's headline field is `quarterlyAllIn` (`src/lib/pricing/plans.ts`). Quarterly is the primary interval and is unmentioned. Lower severity than 5.1/5.2 — an omission, not a contradiction.

### What I checked and found CLEAN

Grepped the rendered corpus (all 15 `.txt` captures) for `collect | payout | pay out | settle | split | verif | wallet | fawry | vodafone | valify | tuition | hold | escrow | remit | disburse | identity`. Complete hit list is six lines. After removing the Paymob sentence (5.1) and the 20 EGP paragraph (correct), what remains is:

- **No copy anywhere claims the platform collects tuition, holds money, pays out, settles, or splits revenue.** No 90/10, no Thursday settlement, no payout ledger, no wallet, no Fawry, no Vodafone Cash as a tuition method.
- **No identity-verification / KYC copy.** The two `verif` hits are PDPL data-subject verification — *"We act on verified requests"* and *"We verify who you are, using the details you gave. Never your PIN."* Neither is the retracted Valify gate or a two-state account model.
- **The settled language ruling is correctly applied on both sides.** Affirmative use is RECORD: EN *"What data we record"* / *"We record what you give us"*; AR `بنسجّلها` (TOC + heading) and `بنسجّل` (body). Both protected denials survive untouched: EN *"we do **not** collect anything from third parties"* and *"We never collect or store your card details"*; AR `مابنجمعش` in both places. Confirmed visually in `en_legal_privacy.png`, `ar_legal_privacy.png`, `en_legal_terms.png`, `ar_legal_terms.png`. **No blanket find-and-replace is warranted or proposed.**
- **The 20 EGP processing-fee paragraph is correct** and is a live-only addition the design lacks (documented as F1 in `legalContent.ts:203-208`, sourced from `resolveProcessingFeeAmount()` under the same `> 0` gate): *"A flat processing fee of 20 EGP is added to each Paymob-charged subscription invoice … VAT is included in the displayed totals."* Matches NEW-MODEL's 20 EGP, VAT-inclusive, platform-invoice-only rule.

---

## 6. Data-rights promises with no mechanism behind it

### The promises, as published

| # | Promise (live) | Where |
|---|---|---|
| a | *"We act on verified requests within **30 days**, at no charge"* / `خلال ٣٠ يوم، بدون رسوم` | Privacy §5 — `/…/legal/privacy`, `legalContent.ts:173-174` |
| b | *"We **acknowledge** your request within **5 business days**."* / `بنأكد استلام طلبك خلال ٥ أيام عمل` | Confirmation step 1 — `legalContent.ts:461-462` |
| c | *"We **complete** it within **30 days** of verifying you. No charge."* / `بنكمّله خلال ٣٠ يوم` | Confirmation step 3 — `legalContent.ts:469-470` |
| d | *"Email — **so we can send our reply**"* (required field) | Form — `legalContent.ts:394-395`, seen in `en_legal_privacy_request.png` |
| e | *"you may request access, correction, **deletion**, restriction, portability, or object"* | Privacy §5 |

### What is actually behind them — verified this session

1. **No timer, no cron, no escalation.** `grep -rlEi 'privacy_request|privacyRequest' src/app/api/cron/ src/lib/` returns exactly one file, `src/lib/privacyRequestConfirmation.ts`. `vercel.json` contains no privacy cron. Nothing counts down and nothing escalates.

2. **No deadline exists in the schema.** Live catalog, `information_schema.columns` on `public.privacy_requests`: `id, full_name, phone, email, relationship, request_types, description, correction_detail, status, handled_by, handled_at, response_notes, created_at, updated_at`. There is no due-date column, no SLA column, and **no `acknowledged_at`** — so promise (b) is not even recordable. The only place "30 days" is written down operationally is human-readable prose inside the alert and notification bodies (`api/privacy-request/route.ts:133`, `:146`).

3. **The acknowledgement channel has no row, so it never fires.** Verified against the live production catalog:
   ```sql
   SELECT key FROM platform_config WHERE key = 'privacy_request_confirmation_wa_template';
   -- []  (no row)
   ```
   `sendPrivacyRequestConfirmation` therefore returns `template_not_configured` on every submission and no WhatsApp is ever sent.

4. **The fallback channel has no sender at all.** Email is *required* by both the client (`page.tsx:88`) and the route (`route.ts:79-88`), and its label promises a reply. There is no `resend | sendgrid | nodemailer | sendEmail | mailer | smtp` reference in `api/privacy-request/route.ts`, `lib/privacyRequestConfirmation.ts`, `api/admin/privacy-requests/route.ts` or `…/anonymize/route.ts`. The address is stored for a human to read.
   **Net: a submitted PDPL request produces zero automated contact with the requester on either channel. Promise (b) — the 5-business-day acknowledgement — has no mechanism whatsoever.**
   *Credit where due:* the confirmation screen is honest about the phone line specifically — `subtextPhone` renders only when the route reports `confirmationSent === true` (`page.tsx:158`), which today is never, so it falls back to the email line. The design's unconditional *"A confirmation is on its way to your phone"* is the weaker version. **Keep the live deviation.** The 5-day promise printed directly beneath it is the unbacked one.

5. **No self-serve delete path.** The only files outside `/admin/` matching `delete-account|deleteAccount|erase|anonymize` are `legalContent.ts` (the copy itself) and the intake route. Erasure is `POST /api/admin/privacy-requests/anonymize`, gated `requireAdminRole(ctx, ['super_admin'])` — a manual action by one person.

6. **Erasure is partial, and the record says "completed" anyway.** The route updates `students` (`name → '[erased]'`, `phone`/`parent_phone`/`qr_code`/`qr_data`/`qr_code_data`/`grade_level` → null, `is_active` → false), deletes `student_notes`, blanks `student_group_notes.note` — then sets `privacy_requests.status = 'completed'` (`anonymize/route.ts:124-132`). Against the live catalog, **10 other public tables** can still hold that parent's phone, and none is touched:
   ```
   enrollment_otps, families, paid_parents, parent_pack_monthly_counts,
   pending_enrollments, privacy_requests, wa_message_queue,
   wa_onboarding_schedule, whatsapp_messages, whatsapp_usage
   ```
   (query: `information_schema.columns`, `table_schema='public'`, `table_name <> 'students'`, `column_name IN ('parent_phone','to_phone')` or `phone` on `enrollment_otps`/`privacy_requests` → `count(DISTINCT table_name) = 10`.)

7. **The parent-portal link survives erasure.** `parent_portal_tokens` has a `revoked_at` column (live catalog: `id, student_id, expires_at, created_at, token_hash, revoked_at`), and `GET /api/parent/portal` rejects on `revoked_at !== null || expires_at <= now` **and nothing else** — it never checks `students.is_active`. The anonymize route never sets `revoked_at`. An outstanding parent-portal link for an erased student keeps resolving until its own expiry, still returning the student row, the balance, up to 30 days of attendance scans and the center's phone.

### The contradiction, stated plainly

**Yes — live copy states erasure and response windows that nothing in the system can honour or even measure.**

- **(a) and (c), the 30-day window**, are published in both locales and rest entirely on a super-admin noticing an `admin_alerts` row. No due date is stored, no job checks one, nothing escalates. The window is a sentence, not a control.
- **(b), the 5-business-day acknowledgement**, is contradicted outright: both notification channels are dead (WhatsApp template row absent — verified; no email sender exists — verified), and there is no column in which an acknowledgement could be recorded.
- **(e) + (c) together are the sharpest one.** The copy promises deletion and says *"We complete it."* The code marks the request `completed` while the same person's phone remains in 10 other tables and their portal token stays live. **Closing the record as "completed" is the point where the system actively asserts something stronger than what it did** — and unlike the copy above it, that assertion is written into the database.

**Not-yet-written, and honestly so:** Privacy §4 *"How long we keep it"* and DPA §6 *"Deletion"* are both in the pending ten and render `Pending Adsero draft.` The retention and deletion commitments a mechanism would have to satisfy have not been drafted. That is the right failure mode — but it means (a), (b) and (c) are the *only* stated windows on this surface, and all three are unbacked.

---

## 7. Other live-vs-design deltas observed in the captures

| Delta | Status |
|---|---|
| Version date: design `22 Jun 2026` → live `Aug 4, 2026` / `٤ أغسطس ٢٠٢٦`, all three numbered docs, index + reader | Documented deviation — `DOC_VERSION`, `legalContent.ts:62-78` (L-09). Deliberate: 22 June predates the L-05 removals. |
| Version line suffix `· pending Adsero review` / `· تحت مراجعة Adsero`, live only | Documented deviation — `LEGAL_CHROME.pendingReview`, `legalContent.ts:103-119`. Kept per Eyad, 4 Aug 2026. Do not "restore parity" by deleting it. |
| Terms §2 second paragraph, 20 EGP processing fee, live only | Documented deviation — F1, `legalContent.ts:202-208`. Correct under NEW-MODEL. |
| DPA reader header: design `For centers and teachers · 22 June 2026` → live `For centers and teachers · August 4, 2026 · pending Adsero review` | Consequence of the two rows above. |
| Confirmation subtext is conditional in live, unconditional in the design | Live is stronger. Keep. |
| **Floating WhatsApp support button overlays legal body text** | Real, undocumented. `src/components/support/FloatingWhatsAppButton.tsx`, mounted in `src/app/[locale]/layout.tsx`, so it renders on every public legal page. The design's legal frames draw no such control. Visible obscuring copy in `en_legal_dpa.png` (over DPA §5 "Breach notice", covering the words after *"without undue delay"* and mid-sentence at *"what happened"*) and in `en_legal_privacy.png` / `ar_legal_terms.png`. Worth a call: a support FAB parked on top of a legal sentence is the one surface where hidden words matter. |

Dev-only artifacts present in some captures and **not** app defects: the Next.js dev indicator (circled `N`) and a transient `Compiling …` toast.
