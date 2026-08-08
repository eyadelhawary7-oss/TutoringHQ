# Re-diff — `design/Merged-Public-App.html` vs the LIVE app

**Date:** 8 August 2026 · **Model:** Opus 5 · **Scope:** PROTECTED file (auth + the parent money path)
**Scratch:** `/tmp/rediff/public-app`, `/tmp/rediff/public-app-b2`, `/tmp/rediff/public-app-b3`
**Live target:** Next dev server on `localhost:3000`, viewport 390×844, storage state `/tmp/state333.json` (logged-in OWNER).

---

## 1. Frames drawn — counted, not estimated

```
$ grep -o 'class="phone"' design/Merged-Public-App.html | wc -l
62
```

Per-section, from `awk '/mgd-bar/{sec=$0} /class="phone"/{c[sec]++}'`:

| § | Name | Frames |
|---|---|---|
| 01 | Public Auth | 30 |
| 02 | Public Join | 12 |
| 03 | Public Self Enrollment | 8 |
| 04 | InstaPay Upload | 8 |
| 05 | Referral Landing | 2 |
| 06 | Offline | 2 |
| | **Total** | **62** |

30 + 12 + 8 + 8 + 2 + 2 = 62. Sums to the grep.

§01 is 15 EN frames (S0, S1, S1b, S2, S3, S4, S4b, S5, S6, S7, S7a, S7b, S7c, S8, S9) mirrored by 15 AR. §04 is 4 states × 2 locales.

---

## 2. All six screens

1. **§01 Public Auth** — `/signup` · `/login`, one flow for centers and teachers, 5 steps, PIN-based login.
2. **§02 Public Join** — invite link, human approval, plus a `/parents` trust page.
3. **§03 Public Self Enrollment** — WhatsApp-OTP self-join, no approval wait.
4. **§04 InstaPay Upload** — the parent receipt upload page. **The whole new money model.**
5. **§05 Referral Landing** — the page a referred center/teacher lands on.
6. **§06 Offline** — the no-connection fallback.

---

## 3. Frame accounting

**`Drawn: 62 | Exercisable: 20 | Exercised: 14 | Blocked: 48`**

"Exercisable" = reachable by a plain GET, which is the harness's only capability. Every drawn frame that needs a click, a form submit or a step advance is not exercisable by this tool and is named below.

### Exercised (14)

| § | Frames | Route(s) |
|---|---|---|
| 01 | S1 EN+AR | `/en/signup`, `/ar/signup` |
| 01 | S1b EN+AR | `/en/teacher/signup`, `/ar/teacher/signup` |
| 01 | S7 EN+AR | `/en/login`, `/ar/login` |
| 01 | S8 EN+AR | `/en/forgot-password`, `/ar/forgot-password` |
| 03 | Frames 1+2 EN, 5+6 AR | `/en|ar/join/g/990b9d87-e922-4203-a2bb-1b24df6c7177` |
| 06 | Both | `/en/offline`, `/ar/offline` |

### Blocked (48) — every frame named

| § | Frames | n | Reason |
|---|---|---|---|
| 01 | S0 EN+AR (role fork) | 2 | **not-built** — no fork exists anywhere |
| 01 | S2 EN+AR (the code) | 2 | tooling — needs a form submit |
| 01 | S3 EN+AR (PIN, explained) | 2 | **not-built** — no explained-PIN screen in either flow |
| 01 | S4 EN+AR, S4b EN+AR (plans) | 4 | tooling — needs step advance |
| 01 | S5 EN+AR (review + consent) | 2 | tooling — needs step advance |
| 01 | S6 EN+AR (done) | 2 | tooling — needs a completed signup |
| 01 | S7a EN+AR (PIN revealed) | 2 | tooling — needs a click |
| 01 | S7b EN+AR (wrong PIN), S7c EN+AR (locked) | 4 | tooling — `/api/login` denies every attempt, see §7 |
| 01 | S9 EN+AR (trial used) | 2 | no-data — needs a phone that already burned a trial |
| 02 | Frames 1–5 EN, 7–11 AR | 10 | tooling — `/api/join/...` returns 429, see §7 |
| 02 | Frame 6 EN, 12 AR (`/parents`) | 2 | **not-built** — `src/app/[locale]/parents` is ABSENT |
| 03 | Frames 3, 7 (the code) | 2 | tooling — OTP path fails closed |
| 03 | Frames 4, 8 (enrolled) | 2 | tooling — needs a completed OTP |
| 04 | All 8 | 8 | **not-built** — see §4 |
| 05 | Both | 2 | tooling — `/api/referral/validate` returns 429, see §7 |

14 + 32 tooling + 14 not-built/no-data… precisely: **not-built 14** (S0×2, S3×2, `/parents`×2, §04×8) · **tooling 32** (S2×2, S4×2, S4b×2, S5×2, S6×2, S7a×2, S7b×2, S7c×2 = 16; §02×10; §03×4; §05×2) · **no-data 2** (S9×2). 14 + 32 + 2 = 48. 14 exercised + 48 blocked = 62.

**Harness caveat, reported not hidden:** the manifest flagged `/en/login` and `/ar/login` as `REDIRECTED-TO-LOGIN: NOT MEASURED`. That is a substring false positive in the harness — `finalUrl` is `/en/login` and `/ar/login` respectively, i.e. no redirect occurred. Both were measured. The logged-in owner session did **not** bounce us off `/login` or `/signup`. `/en/teacher/landing` and `/ar/teacher/landing` **did** redirect, to `/en/teachers` and `/ar/teachers` — a marketing page belonging to `Merged-Public-Marketing.html`, out of scope for this file.

---

## 4. Does the "InstaPay Upload" parent screen exist live? — **NO. Nothing of it exists.**

This is the most valuable finding, so here is the full evidence chain rather than a verdict.

NEW-FEATURES §2 (build order step 3) requires three things. All three are absent.

**(a) A tokenised link with expiry, tied to ONE INVOICE for ONE student — PARTIAL, and wrong-shaped.**

A tokenised parent link *does* exist: `src/app/parent/[token]/page.tsx` + `src/app/api/parent/portal/route.ts`, backed by `parent_portal_tokens`. Live catalog, read this session:

```
parent_portal_tokens: id, student_id, expires_at, created_at, token_hash, revoked_at
```

Tokens are hashed, expiring and revocable — the security shape is right. But the scope column is **`student_id`, and there is no `invoice_id`**. The model's guarantee ("the receipt is never read to work out who paid" because the link is one invoice for one student) is not what this table encodes. The page it serves is a read-only portal: 30-day attendance grid, balance due, next sessions, a WhatsApp button. It has **no upload control of any kind**.

**(b) An upload endpoint — DOES NOT EXIST.**

```
$ grep -rn "formData()" src/app/api src/lib --include=*.ts | wc -l
0
$ grep -rn 'type="file"' src/ --include=*.tsx | wc -l
2
```

Zero multipart handlers in the entire API and lib tree. The only two file inputs in the app are `settings/center/page.tsx:328` (centre logo) and `students/import/page.tsx:457` (CSV import) — neither is parent-facing. Storage has 4 call sites across 2 buckets, `center-logos` and `invoice-pdfs`. **There is no receipt bucket.** No table or column named `%receipt%`, `%instapay%` or `%screenshot%` holds an image — the only matches in the live catalog are `centers.instapay_number`, `centers.instapay_reference`, `teacher_profiles.instapay_address`, `withdrawal_requests.instapay_number`, `transactions.e_receipt_ref/e_receipt_status`, `teacher_subscriptions.last_charge_e_receipt_ref/status` — all reference strings, none an upload.

**(c) The reader — DOES NOT EXIST.**

`@anthropic-ai/sdk` is declared in `package.json` but imported by **0 files under `src/`**. No OCR, vision or extraction dependency of any kind. Nothing to accuracy-test.

**Verdict:** all 8 §04 frames are `not-built`. Steps 1–4 of the build order are described as "the minimum for a working flow"; step 3 has not started.

### And the one live parent surface is broken

The parent portal that *does* exist is unreachable. Reproduced three ways this session:

```
GET /parent/abc      -> 307  Location: /ar/parent/abc
GET /ar/parent/abc   -> 500
GET /en/parent/abc   -> 500
```

Captured page error: `Error: No intl context found. Have you configured the provider?` The parent sees the generic Arabic error boundary — including a **"العودة للوحة التحكم" (Back to dashboard)** button, offered to a parent who has no dashboard and no account.

Cause: the page lives at `src/app/parent/[token]/page.tsx`, **outside** the `[locale]` segment. `src/proxy.ts:447` matches every non-static path, `/parent` is absent from `publicRoutes` (`src/proxy.ts:102`) and from any next-intl exclusion, and `src/i18n/routing.ts` sets `localePrefix: 'always'` — so every request is redirected to `/{locale}/parent/...`, where no route file exists. **Every parent portal link ever sent is dead.** This is a defect against the app, not a design gap, and it sits on the parent money path.

---

## 5. Surviving card/wallet gateway checkout for TUITION

**Functionally: none. The deletion holds in code and in the database.**

- `src/app/api/payments/collect/route.ts:19` — `const ALLOWED_METHODS = new Set(['cash', 'instapay']);`
- `src/app/[locale]/payments/page.tsx:52` — `type MethodPillFilter = 'all' | 'cash' | 'instapay'`, and the collect modal offers only `['cash','instapay']` (lines 150, 850).
- `supabase/migrations/20260807185735_narrow_tuition_payment_methods.sql` narrows `payments_method_check`, `teacher_profiles_default_payment_method_chk` and `transactions_method_chk` to cash/instapay. Applied to production.
- `/api/invoices/[id]/pay` and `/api/teacher/invoices/[id]/pay` do run Paymob card checkout, but both gate on `requireCenterAuth` + `role === 'owner'`. That is a centre paying its **own** subscription — the exception NEW-MODEL explicitly preserves. Not a violation.

**But the claim survives in public copy, twice, in both locales.** `messages/en.json` lines 6790 and 9746, comparison-table row `row3`, criterion "Sending a way to pay":

> `"centerhq": "A link with every invoice, paid by card"`

2 occurrences in `en.json`, 2 of the mirror `"رابط مع كل فاتورة، تُدفع بالبطاقة"` in `ar.json` (counts run this session). One instance is on the centre comparison table, one on the teacher table — and I **photographed it rendering live** on `/en/teachers`. The platform is publicly promising parents a card payment link that no longer exists and cannot be built under the current model. **This is the highest-priority copy defect in the set.**

Secondary, non-rendering: `src/app/[locale]/students/[id]/page.tsx:72` and `:113` still document `payments.method` as `cash | instapay | vodacash | orange | fawry | bank` and say the chip folds "every other (electronic) method" to "Online". Comments only — the executable `CollectMethod` type on line 76 is `'cash' | 'instapay'`. Stale against the 7 August migration.

---

## 6. Divergences AGAINST THE APP (defects)

Ordered by cost.

**D1 · The parent portal 500s at every URL.** §4 above. `src/app/parent/[token]/page.tsx` is outside `[locale]`; `localePrefix: 'always'` redirects into a segment that has no such route. Parent money path, and it is fully dark.

**D2 · Public copy sells a card payment link for tuition that does not exist.** §5 above. `messages/en.json:6790,9746` + AR mirrors, live on `/en/teachers`.

**D3 · The dead referral model is live on a public signup screen.** The teacher signup card renders "Got a code from another teacher? Enter it and you both get a free month after your first paid month" — photographed on `/en/teacher/signup` and `/ar/teacher/signup`. NEW-MODEL specifies a recurring percentage commission (25% month 1, 10% months 2–6, 5% thereafter) applied as credit. "free month" appears **8 times in `messages/en.json`**, "شهر مجاني" **5 times in `messages/ar.json`** — including `"Teachers earn free months, not cash"` at en.json:3689.

**D4 · The signup flow the design says was replaced is still exactly as described.** Design lead: *"The old build gave centers a four step wizard and teachers a single crowded card. Now both walk the same five steps."* Live: `/en/signup` is a 4-stage wizard (`type Stage = 'info' | 'plan' | 'payment' | 'success'`, `SignupForm.tsx:298`) reading "STEP 1 OF 4"; `/en/teacher/signup` is one card carrying name, mobile, subject, referral code, PIN, Confirm PIN and two consent checkboxes. No role fork exists (S0, `not-built`). No shared flow.

**D5 · Self-enrollment lets a student opt his own parent out.** `/join/g/[groupId]` defaults `payerType` to `'student'` (`JoinFlowClient.tsx:38`) and collects parent name + parent mobile **only** when "The parent" is picked (lines 371, 80–83). Design §03 lead: *"It still collects the parent number, because the parent receives every receipt and every alert, and a student cannot opt his own parent out of that."* Under NEW-MODEL step 2 the invoice link goes to the parent on WhatsApp — with no parent number captured, the future InstaPay upload link has nowhere to go. This is a model-blocking gap, not a styling one.

**D6 · Self-enrollment tells the student fees arrive BEFORE class.** `joinFlow.waNote` = *"Your teacher will send you a WhatsApp message before each class with the payment link."* Design frame 4: *"Your parent gets the fee message after the session, never before."* NEW-MODEL creates the invoice when attendance marks the student InstaPay — i.e. after. Live copy contradicts both the drawing and the model.

**D7 · The anti-phishing line is missing.** Design frame 3 carries *"This is the only code we send for joining. Attendance and fees never ask for a code."* — the design lead calls this the point of the screen. `grep -ci "only code we send" messages/en.json` → **0**. No equivalent key exists.

**D8 · RTL: the wordmark renders reversed as "HQTutoring" on `/ar/forgot-password`.** Photographed. Cause: `src/app/[locale]/forgot-password/page.tsx:197` wraps the two brand spans in `<h1 className="... flex items-center justify-center gap-0">`; flex items reverse visual order under `dir="rtl"`. `src/app/[locale]/login/page.tsx:295` nests the identical spans inline and renders "TutoringHQ" correctly. `check:bidi` passes because this is `display:flex` in an RTL context, not a physical CSS property — the gate cannot see it.

**D9 · Public auth pages render inside the authenticated app shell.** `/en/set-pin`, `/ar/set-pin`, `/en/offline`, `/ar/offline` and `/en/refer/[code]` all render the dashboard top bar (hamburger, bell, cart, locale chip) **and** the bottom tab bar (Home / Students / Attend / Fees). The design draws these as bare full-bleed screens. Observed under a logged-in owner session; the anonymous case was not measured, so treat the *severity* as unconfirmed — but `/set-pin` and `/refer/[code]` are for people who by definition are not logged in.

**D10 · Two locale switchers on one screen.** `/en/set-pin` and `/ar/set-pin` show the app-bar globe chip *and* a second in-page language switcher. Photographed in both locales.

**D11 · The wordmark is clipped in the app bar at 390px.** Renders "Tutoring H" (EN) and "Tutoring" (AR) — the bell button overlaps it. Visible on `/en/set-pin`, `/en/offline`, `/ar/offline`, `/ar/set-pin`, `/en/refer/XRD3OKMK`.

**D12 · The offline note is close to illegible.** The mint callout ("QR scanner works offline. Attendance is saved automatically." / "ماسح QR يعمل بدون إنترنت…") renders near-white on mint in both locales. Separately, the copy diverges: the design promises *sync* ("Attendance you already took is saved on this device and will sync automatically when the connection returns", under a "Good to know" heading); live promises only that the scanner works and omits the sync sentence and the heading.

**D13 · The forgot-PIN screen drops both reassurances.** Design S8 carries *"The code lasts 10 minutes."* and *"Nobody at TutoringHQ can see your PIN or read it back to you. Resetting is the only way in."* Live `/en|ar/forgot-password` shows only "Enter your registered phone number" + "Send OTP".

**D14 · The referral landing sells nothing and routes to sales.** Blocked from rendering (§7), so read from source: the entire live `refer` namespace is 8 keys — `welcomeTitle`, `invitedBy`, `fallbackCenterName`, `ctaButton: "Book your demo"`, `autoApplyNote`, `loading`, `invalidLink`, `backHome`. Design §05 requires the reward stated plainly and the visitor dropped **into the free trial rather than a sign-up wall**; live states no reward at all and its CTA is "Book your demo". Neither perk line ("14-day free trial, no card needed", "A welcome credit on your first bill") exists.

---

## 7. Environment faults — `tooling`, NOT design gaps

`rateLimit()` in `src/lib/rateLimitCore.ts` fails **closed** when Upstash is unconfigured (`if (!r) return { success: false, ... }`), and Upstash is not configured here. Confirmed live, this session:

```
GET  /api/join/007/9ad1cf34-...   -> 429 {"error":"Too many requests. Please try again later."}
POST /api/referral/validate       -> 429 {"error":"Too many requests. Please try again later."}
```

Consequences, all recorded as **not measured**:
- §02 Public Join, 10 frames — the page renders its error card ("We couldn't load this invitation" / "تعذر تحميل بيانات الدعوة"). The route source is fully implemented.
- §05 Referral Landing, 2 frames — both locales render "This link is invalid or has expired." with a **real** referral code (`XRD3OKMK`, read from `centers.referral_code`). The validate route does look up `centers.referral_code`; it never got there.
- §01 S7b/S7c, 4 frames — `/api/login` denies every login, so the wrong-PIN and locked states are unreachable.
- §03 frames 3, 4, 7, 8 — `api/join/g/[groupId]/verify-otp/route.ts:65,73` returns `verification_unavailable` 503 when Redis is absent.

**That OTP failure is PHONE verification and is live product.** It is not identity verification and is not the dead-model Valify gate. It must not be written up as dead-model verification.

Also `tooling`, not product: the dev overlay's "Compiling…" pill appears in `/en/signup` and `/en/join/007/...`; page content had rendered in both.

### What I did about the join route, stated plainly

I found **real** ids in the live database rather than guessing: centre `Test Center 333` `center_code='007'`, centre group `Biology A` `9ad1cf34-…`, and — after reading the gate — the private group `Physics Sun 4PM` `990b9d87-e922-4203-a2bb-1b24df6c7177`, which matches the design's own sample. `/join/[center_code]/[group_id]` was still blocked by the 429 above. `/join/g/[groupId]` is a **server** component reading Supabase directly, so it bypasses the rate limiter and **rendered fully** — that is how §03 was exercised. My first attempt used the centre group and correctly returned "This group link is no longer active", because the route requires `kind='private'` AND `status='active'`; I then found a conforming group rather than reporting the error state as the screen.

I did **not** mint a parent portal token: tokens are stored hashed, so exercising one means writing a row to the production database. Not done. The §4 finding rests on reading the page component, the API route, the live table definition, and three reproduced HTTP 500s.

---

## 8. Divergences AGAINST THE DRAWING (stale design)

**S1 · The `/parents` trust page still lists card, wallet and Fawry as tuition methods.** §02 frame 6 (EN) reads: *"Card, wallet, InstaPay or InstaPay, through a the center's own account."* — a half-completed find/replace, garbled in two places. Its AR mirror (frame 12) was **not edited at all**: *"بطاقة أو محفظة أو إنستاباي أو فوري، عبر حساب السنتر نفسه"* = "card or wallet or InstaPay or **Fawry**". NEW-MODEL kills all three as tuition methods. `grep -c 'InstaPay or InstaPay'` → **1**.

**S2 · A botched Arabic find/replace corrupted the join copy in three places.** `grep -o 'إنستاباين' | wc -l` → **3**, at design lines 1578, 1611 and 1791. The intended word is `رقمين` ("two numbers"); the file now reads e.g. *"بتبعت طلب فيه اسمك وإنستاباين تليفون"* — "you send a request with your name and InstaPay-two phone". All three are in Arabic frames a parent would read.

**S3 · §04's undrawn states are undercounted.** `SPEC-instapay-fee-collection.md` §6 has exactly **8** result rows (counted). The drawing covers 3 of them — not-an-InstaPay-receipt, amount-less-than-due, amount-matches — plus a before-upload frame, which is the "four states drawn". That leaves **5** SPEC rows with no frame: status-not-Successful, wrong recipient, reference-already-recorded, amount-more-than-due, unreadable/low-confidence. NEW-FEATURES §2 says "Four more are specified". One of the two is off by one; worth resolving before anyone builds from the count.

**S4 · S5 draws a 5-of-5 progress bar for a flow the app runs in 4 stages** and the design's own §01 header says "five steps". The live 4-stage shape is not obviously wrong — the stage-3 copy is "Confirm your order" / "No charge today — your 14-day free trial starts now" / "Start free trial", which matches the design's intent — but the live progress label reads **"Step 4: Payment"** on a step that charges nothing. Flagging both sides: the drawing's step count is stale, and the app's step label is misleading.

**Correct in the drawing, worth recording:** the drawn §04 copy obeys every model rule. The accepted state says *"The center will confirm receipt"* rather than claiming payment is complete; the wrong-image state says *"Send the screen from the InstaPay app after the transfer completes"* with no accusation; the partial state says *"160.00 EGP remaining. You can upload another receipt."* and invites the rest. When this gets built, the copy is ready.

---

## 9. What I would fix first

1. **D1** — the parent portal 500. One route-location fix; today every parent link is dead.
2. **D2** — delete the "paid by card" tuition claim, 4 strings across both locales. It is a public promise the product cannot keep.
3. **D5 / D6** — capture the parent number unconditionally at self-enrollment and correct the before/after-class fee copy. Both block the InstaPay flow before a line of §04 is written.
4. **D3** — retire the "free month" referral copy, 8 EN + 5 AR strings, one of which is on a public signup page.
5. **§04 itself** — invoice-scoped tokens, an upload endpoint, then the reader, gated by the accuracy test as NEW-FEATURES §2 requires.

---

## 10. Route ledger

| Route | finalUrl | Result |
|---|---|---|
| `/en/login`, `/ar/login` | unchanged | measured (harness redirect flag is a false positive) |
| `/en/signup`, `/ar/signup` | unchanged | measured |
| `/en/teacher/signup`, `/ar/teacher/signup` | unchanged | measured |
| `/en/set-pin`, `/ar/set-pin` | unchanged | measured |
| `/en/forgot-password`, `/ar/forgot-password` | unchanged | measured |
| `/en/offline`, `/ar/offline` | unchanged | measured |
| `/en/session-expired`, `/ar/session-expired` | unchanged | measured (not a drawn screen) |
| `/en/teacher/landing`, `/ar/teacher/landing` | → `/en/teachers`, `/ar/teachers` | redirect; marketing file, out of scope |
| `/en|ar/join/007/9ad1cf34-…` | unchanged | **tooling** — 429 from `/api/join/...` |
| `/en|ar/join/g/9ad1cf34-…` | unchanged | wrong group kind; superseded below |
| `/en|ar/join/g/990b9d87-…` | unchanged | **measured** — §03 exercised |
| `/en|ar/refer/XRD3OKMK` | `?ref=` appended | **tooling** — 429 from `/api/referral/validate` |
| `/parent/notarealtoken0000` | → `/ar/parent/...` | **500** — defect D1 |
| `/en/parent-whatsapp` | → `/en/whatsapp-pack` | redirect; not the `/parents` trust page |

Manifests: `/tmp/rediff/public-app/_manifest.json`, `/tmp/rediff/public-app-b2/_manifest.json`, `/tmp/rediff/public-app-b3/_manifest.json`.

Tallied across all three this session: **26 routes captured, 26 `ok:true`, 20 with `finalUrl` identical to the requested route.** Of the 6 that moved, 2 are the `/refer` pages appending their own `?ref=` query to the same path — so **22 stayed on their own path** and **4 genuinely left it**: `/en/teacher/landing`, `/ar/teacher/landing`, `/parent/notarealtoken0000` and `/en/parent-whatsapp`.
