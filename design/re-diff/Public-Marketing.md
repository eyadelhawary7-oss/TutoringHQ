# Re-diff — Merged-Public-Marketing.html vs LIVE app

**File:** `/home/user/TutoringHQ/design/Merged-Public-Marketing.html` (2,028 lines)
**Last touched:** `57930a88 docs: rendered re-diff of Center-Groups and Center-Students, findings 27-46, and the first sweep edits (#368)` — so the excision sweep **did** run on this file.
**Captures:** `/tmp/rediff/public-marketing{,2,3,4}` — 18 routes, 18 PNGs, 18 rendered-text files.
**Date:** 8 August 2026. No code written.

---

## 1. Frames drawn

Commands run this session against the file:

| selector | command | result |
|---|---|---|
| `class="phone"` | `grep -o 'class="phone"' … \| wc -l` | **12** |
| `class="frame"` | `grep -o 'class="frame"' … \| wc -l` | **4** |
| `class="phones"` | `grep -o 'class="phones"' … \| wc -l` | **1** |

**Frames drawn = 12.** The `.frame` count is 4 and is stated separately because it is wrong for this file: all 4 `.frame` wrappers sit inside section 04 only, and the single `.phones` container in section 04 holds 4 bare `.phone` nodes. Sections 01–03 use **zero** `.frame` wrappers. Counting `.frame` would report 4 frames for a 12-frame file and would attribute all of them to one screen.

Per-section (script run over the parsed file, phones bucketed between `id="S-n"` anchors):

| § | name | `.phone` | `.frame` |
|---|---|---|---|
| 01 | Public Landing | 2 | 0 |
| 02 | Public Audience | 4 | 0 |
| 03 | Public Pricing | 2 | 0 |
| 04 | Lead Capture | 4 | 4 |
| | **sum** | **12** | **4** |

By direction: `dir="ltr"` phones = **6**, `dir="rtl"` phones = **6**, sum **12**.

---

## 2. All 4 screens

| § | Name | Source | Frames | Live route(s) |
|---|---|---|---|---|
| 01 | Public Landing | `Screen-Public-Landing.html` | 2 (EN, AR) | `/en`, `/ar` |
| 02 | Public Audience | `Screen-Public-Audience.html` | 4 (centers EN/AR, teachers EN/AR) | `/en/centers`, `/ar/centers`, `/en/teachers`, `/ar/teachers` |
| 03 | Public Pricing | `Screen-Public-Pricing.html` | 2 (EN, AR) | `/en/pricing`, `/ar/pricing` |
| 04 | Lead Capture | `Screen-Public-Lead.html` | 4 (EN form, EN submitted, AR form, AR submitted) | `/en/talk-to-us`, `/ar/talk-to-us` |

---

## 3. Frame accounting

**Drawn: 12 | Exercisable: 10 | Exercised: 10 | Blocked: 2**

Blocked frames, named:

| Frame | Reason | Detail |
|---|---|---|
| §04 frame 2 — `EN · asked for a call` | `tooling` | The submitted/confirmation state is reachable only by submitting the form. `capture-batch.mjs` performs no interaction, and submitting would write a real lead row. Not measured — **not** "not built". |
| §04 frame 4 — `AR · اتطلبت المكالمة` | `tooling` | Same. |

10 exercised + 2 blocked = 12 drawn.

### Tooling notes (route-level, not frames)

- **`/en/teacher/pricing` → `finalUrl: /en/dashboard`** (manifest, `redirectedToLogin: false`, `chars=767`). The `/tmp/state333.json` owner session bounced it to the dashboard. The PNG shows the Test Center 333 owner dashboard, not a pricing page. **NOT MEASURED = `tooling`.** No claim is made about whether a marketing page exists at that path.
- `/en/teacher/landing` → `finalUrl: /en/teachers`; `/ar/teacher/landing` → `finalUrl: /ar/teachers`. Aliases, not separate pages (`/en/teachers` and `/en/teacher/landing` both returned `chars=3744`).
- The 6 undrawn sub-pages (`features/*`, `compare/*`, `blog`) render **inside the logged-in app shell** — sidebar, cart, bell, bottom tab bar — because of the owner session. Chrome is session-caused; the body content is real.
- 17 of the 18 PNGs were read by hand. The 18th, `en_teacher_landing.png`, is the same rendered page as `en_teachers.png` (identical `finalUrl` and `chars`), which was read.
- No route failed, none stayed skeletal, no HTTP ≥400, no page errors, on any of the 18.

---

## 4. Dead-model claims still advertised on the LIVE PUBLIC SITE

**8 of the 16 distinct public marketing pages rendered carry at least one hard dead-model claim.** Every quote below is rendered text pulled from the capture and confirmed in the PNG.

### 4.1 The three items previously flagged for excision — excised from the DRAWING, still LIVE in the APP

The sweep removed all three from the design file (`grep -i 'payout' …` → 0 hits; `grep 'Split to each teacher' …` → 0 hits; `grep -i 'instant' …` → 0 hits). **None of them was removed from the app.**

| # | Rendered live text | Routes | Verdict |
|---|---|---|---|
| D1 | **"Teacher payouts"** | `/en` (feature pill under "A center"), `/en/centers` (4th card, "Things a solo teacher never needs") | Platform payouts are dead. The drawing now shows **3** cards there; the app shows **4**. |
| D1-AR | **"تحويلات المدرسين"** | `/ar`, `/ar/centers` | Same card, Arabic. |
| D2 | **"Teacher payouts — Split to each teacher's own account, or land in yours. Your call."** | `/en/centers` | Payouts **and** the split, in one card, verbatim the string the sweep was told to excise. |
| D2-AR | **"تحويلات المدرسين — تتقسّم على حساب كل مدرس، أو تنزل عندك. إنت اللي تقرر."** | `/ar/centers` | Same. |
| D3 | "Instant payout — priced per withdrawal" | — | **Not found live.** `grep -i 'Instant payout'` over all 18 captures → NONE. Gone from both drawing and app. |

### 4.2 Additional dead-model claims found live, not on the excision list

| # | Rendered live text | Routes | Which dead thing |
|---|---|---|---|
| D4 | **"Withdrawals to your own account"** — a ✓ line in "There is no cheaper version of the software." | `/en/pricing` | Platform payouts. The platform holds no tuition; there is nothing to withdraw. |
| D4-AR | **"سحب فلوسك على حسابك إنت"** | `/ar/pricing` | Same. |
| D5 | **"Sending a way to pay → TutoringHQ: A link with every invoice, paid by card"** | `/en/centers`, `/en/teachers` | Card as a **tuition** method. Dead — InstaPay only, two methods. |
| D5-AR | **"إرسال طريقة للدفع → TutoringHQ: رابط مع كل فاتورة، تُدفع بالبطاقة"** | `/ar/centers`, `/ar/teachers` | Same. |
| D6 | **"You teach. We collect."** — the h1 of the landing page | `/en` | The platform does not collect tuition. The drawing already says **"You teach. We record."**; the app was never changed. |
| D6-AR | **"الدرس عليك. التحصيل علينا."** — the h1 | `/ar` | Same claim. **Note: the drawing's Arabic h1 is identical** (line 858) — the AR hero was never corrected in either place. |

### 4.3 Soft — flagged because the sweep deliberately neutralised it in the drawing and the app kept it

"Cut" here is a center↔teacher arrangement, not the platform's 90/10, so it is **not** on the dead list. But the drawing was systematically rewritten from "cut" to "owed to you", and the app was not, so the two now disagree on every instance:

| Live text | Route | Drawing now says |
|---|---|---|
| "Your cut from each center you teach at, sitting next to what your own groups brought in." | `/en/teachers` | "What each center owes you, sitting next to…" |
| "Nile Prep Academy — Your cut, worked out from attendance" | `/en/teachers` | "Owed to you, worked out from attendance" |
| "Your cut from every center, calculated" | `/en/teachers` | "What you are owed from every center, calculated" |
| "Your cut from every center you teach at sits next to what your own groups brought in." | `/en` | "What each center owes you sits next to…" |
| "You see your groups, your students and your cut, and you pay nothing." | `/en/pricing` | (not drawn on the pricing screen) |
| "نصيبك من كل سنتر…" ×4 | `/ar`, `/ar/pricing`, `/ar/teachers` | "اللي ليك من كل سنتر، محسوب" |

### 4.4 Confirmed clean

Swept all 18 captures for the rest of the dead list — **none present anywhere on the live public site**: `90/10`, `1.5%`, `7.5%` (the only `7.5` hit is the money string `3,037.50` on `/en`), `Fawry` / `فوري` (the only `فوري` hit is the adverb "instantly" in `مسح فوري`), `Vodafone` / `فودافون`, `wallet` / `محفظة`, `identity` / `هوية` / `توثيق`.

The only `verif` hit across all captures is **"Verification unavailable"** on `/en/dashboard` — reached solely because `/en/teacher/pricing` redirected there. That is the app dashboard, **not** a public marketing page and **not** this file's territory; noted so the next agent on the dashboard file can chase it, not counted here.

**False positive checked and dismissed as instructed:** the drawing's caption *"Prices verified against `pricing_plans` and `platform_config` on 24 July 2026"* (line 1548) is a provenance note about price-checking. Not identity verification. Not reported as dead.

---

## 5. Prices shown live that disagree with the model facts

| Model fact | What the live site shows | Route |
|---|---|---|
| **Flat 20 EGP processing fee, VAT inclusive, on every invoice the platform issues to a center or teacher** | **"Every price on this page includes VAT. Nothing is added at checkout."** / **"كل سعر في الصفحة دي شامل الضريبة. مفيش حاجة بتتزود عند الدفع."** — the 20 EGP is added, so "nothing is added" is false. The fee is disclosed nowhere on the public site. | `/en/pricing`, `/ar/pricing` |
| **10 EGP service fee per confirmed InstaPay receipt, funded by the parent** | **Not disclosed on any of the 16 public marketing pages captured.** A grep for `processing fee` / `service fee` / `instapay` / `إنستاباي` / `رسوم` across all 18 rendered-text files returns exactly one hit — the app-shell tab label `الرسوم` ("Fees") on `/ar/features/qr-attendance`. A parent-funded per-receipt charge is advertised nowhere. | all |
| **Branch add-on 199 EGP / month** | **No branch add-on row exists on the live pricing page at all.** The live Add-ons list has exactly one row: *"Parent WhatsApp pack — 12 / parent / mo"*. The **drawing** shows *"Extra branch — 299 / mo"* / *"فرع إضافي — ٢٩٩ / شهر"*: **299 vs the model's 199**. | drawing `/pricing` |
| **Analytics = 0 for now** | Live still sells analytics as a paid tier differentiator: *"Advanced analytics — Not included"* on teacher Standard (`/en/pricing`), and *"Pro — 50 active students a month · analytics included — 999"* (`/en/teachers`). The **drawing** additionally prices it: *"Advanced analytics — 149 / mo"* / *"تحليلات متقدمة — ١٤٩ / شهر"*: **149 vs the model's 0**. | `/en/pricing`, `/en/teachers`; drawing `/pricing` |
| **Team seats = 0 for now** | Not shown live at all. The **drawing** prices it: *"Team seat — 99 / mo"* / *"مقعد موظف — ٩٩ / شهر"*: **99 vs the model's 0**. | drawing `/pricing` |
| **14% VAT only, inclusive** | Consistent. Live says "includes VAT" with no rate stated; no second tax, no service-fee line, no stamp duty anywhere. | — |
| **Card orders parked** | Consistent. No card-order offer on any captured public page. | — |

### Plan prices — live vs drawing

Base prices agree everywhere. **Caps do not.**

Center (live `/en/pricing` chips and `/en/centers` tiles; identical on `/ar`):

| Tier | Live cap | Live price | Drawing cap | Drawing price |
|---|---|---|---|---|
| Solo | 50 / week | 999 | 50 | 999 |
| Nano | 120 / week | 1,999 | 120 | 1,999 |
| Starter | **200** / week | 4,499 | **300** | 4,499 |
| Pro | **500** / week | 7,999 | **600** | 7,999 |
| Business | **1,000** / week | 12,999 | **1,200** | 12,999 |
| Enterprise | 2,000 / week | 18,499 | 2,000 | 18,499 |

3 of 6 caps differ. The drawing's own caption already declares this: *"Caps shown are the widened ones, which the database does not have yet."* — so this is a self-declared, still-open gap, not a new finding. Consequence: live renders *"Works out at 22.50 EGP a student"* (4,499 ÷ 200); the drawing's formula on cap 300 would render 14.99.

Teacher:

| Tier | Live | Drawing |
|---|---|---|
| Standard | 20 active students / month · 499 | 20 · 499 |
| Pro | 50 active students / month · 999 | 50 · 999 |
| Scale | **100** active students / month, **then 20 each** · 2,499 | **150**, **then 16 each** · 2,499 |
| Chips | 20 / 50 / 100 / 100+ | 20 / 50 / 150 / 150+ |

Annual multiplier agrees: live *"Or 3,749 EGP a month paid yearly, which is 44,990 EGP for the year"* = ×10; the drawing computes `p.m * 10`.

---

## 6. Divergences

### 6.1 AGAINST THE APP — drawn, but the app differs or does not have it

| # | Drawn | App | Where |
|---|---|---|---|
| A1 | h1 "You teach. We record." | h1 "You teach. We collect." | `/en` |
| A2 | undercta line 2: "InstaPay collection switches on once you add your InstaPay account." | absent — app shows only "No card. Nothing to pay until Aug 30." | `/en` |
| A3 | undercta line 2: "تحصيل إنستاباي بيشتغل بعد ما نتأكد من هويتك." | absent | `/ar` |
| A4 | "Things a solo teacher never needs" = **3** cards | **4** cards (extra: Teacher payouts) | `/en/centers`, `/ar/centers` |
| A5 | "Sending a way to pay → TutoringHQ": EN *"A link with every invoice, card or wallet"*; AR *"رابط مع كل فاتورة، إنستاباي"* | EN *"…paid by card"*; AR *"…تُدفع بالبطاقة"* | `/en/centers`, `/ar/centers`, `/en/teachers`, `/ar/teachers` |
| A6 | "What you are owed from every center, calculated" / "اللي ليك من كل سنتر، محسوب" | "Your cut from every center, calculated" / "نصيبك من كل سنتر، محسوب" | `/en/teachers`, `/ar/teachers` |
| A7 | Add-ons = **5** rows (Extra branch, Team seat, Advanced analytics, Parent WhatsApp pack, WhatsApp packs) | **1** row (Parent WhatsApp pack, 12 / parent / mo). 4 of 5 not built. | `/en/pricing`, `/ar/pricing` |
| A8 | includes row 8: "Everything exportable, any time you want to leave" | "Excel export of everything, **from the Pro plan up**" / "تصدير كل بياناتك على إكسل، **من باقة محترف وفوق**" — the app gates export behind Pro; the drawing promises it unconditionally | `/en/pricing`, `/ar/pricing` |
| A9 | teacher tiles: "20 a week / 50 a week / 150 a week, then 16 each" | "20 / 50 / 100 active students a month, then 20 each" | `/en/teachers`, `/ar/teachers` |
| A10 | center caps 300 / 600 / 1,200 | 200 / 500 / 1,000 (drawing's own caption already flags this) | `/en/pricing`, `/en/centers` + AR |
| A11 | "Free until 16 August" | "Free until Aug 16" — date format differs in the banner, the undercta and the big footer CTA | `/en` and every EN page |
| A12 | §04 submitted state, EN and AR | not exercised — see blocked frames | `/en/talk-to-us`, `/ar/talk-to-us` |

Built and matching: the SUMMER26 banner, the "Mark all present 18" hero object, the three-step section, the FAQ accordions, the data-ownership panel, the big footer, the MOST CHOSEN badge, the monthly/annual toggle, the "Comes with a 14 day trial" note, and both `talk-to-us` forms field-for-field including hint copy ("We call this number. We do not put you on a list." / "بنتصل على الرقم ده. ومابنحطكش في أي قايمة.").

### 6.2 AGAINST THE DRAWING — live, but undrawn in this file

| # | Live | Note |
|---|---|---|
| B1 | **6 public marketing routes this file does not draw at all**: `/en/features/qr-attendance`, `/ar/features/qr-attendance`, `/en/features/student-management`, `/en/features/whatsapp-notifications`, `/en/compare/spreadsheets`, `/en/blog` | Real, populated pages with their own heroes, step lists and comparison tables. None appears in the 4-screen TOC. `/en/blog` is a "Coming soon" placeholder. |
| B2 | **Invisible h1 on all 6 of those pages.** In all 6 PNGs the hero `<h1>` renders near-black on a near-black panel and is effectively unreadable — "QR Attendance in One Scan", "حضور بمسح QR في ثانية واحدة", "Complete Profile for Every Student", "Automatic WhatsApp for Every Parent", "TutoringHQ vs. Spreadsheets & Paper", "Blog". The h2s below them (e.g. "Detailed comparison", "How it works") render white and are legible, so the defect is specific to the hero heading. 6 of 6 pages read. **Caveat: captured under the owner session; a logged-out visitor's theme was not tested, so I cannot state this reaches the public without that check.** |
| B3 | Floating WhatsApp bubble with a close ✕, bottom-end on every public page | Undrawn in all 12 frames. Visible in `/en`, `/ar`, `/en/pricing`, `/ar/pricing`, `/en/talk-to-us`, `/ar/talk-to-us`, `/en/centers`, `/en/teachers`, and the 6 sub-pages. |
| B4 | `/en/teachers` hero row sub-label "Your cut, worked out from attendance"; `/en/pricing` teacher blurb "You see your groups, your students and your cut" | Neither string exists in the drawing (see §4.3). |
| B5 | `/en/compare/spreadsheets` "Payment collection → Automated invoices and overdue reminders" | Clean under the new model — no gateway claim. Undrawn, but nothing to fix. |

### 6.3 Defects inside the drawing itself

| # | Line | Problem |
|---|---|---|
| C1 | 890 | AR landing undercta: **"تحصيل إنستاباي بيشتغل بعد ما نتأكد من هويتك."** = "InstaPay collection works **after we verify your identity**." Identity verification is dead. The EN twin (line 726) was already rewritten to "…once you add your InstaPay account"; the Arabic was not. **Arabic-only stale identity-verification claim, still in the drawing.** |
| C2 | 858 | AR landing h1 **"الدرس عليك. التحصيل علينا."** = "The lesson is on you, **the collection is on us**." The EN h1 was changed to "We record"; the Arabic was not. |
| C3 | 1082, 1354 | EN `/centers` and `/teachers` still read *"A link with every invoice, card or wallet"*. Their **Arabic** twins (1218, 1476) were already corrected to *"إنستاباي"*. The card/wallet excision ran on the Arabic side only. |
| C4 | 1480 | **Corrupted string from that same replace pass.** AR `/teachers`, row "Center income beside your own", reads **"إنستاباين، وإجمالي واحد، في شاشة واحدة"** — `رقمين` ("two numbers") was overwritten by the InstaPay substitution, producing a non-word. The live app renders the correct **"رقمين، وإجمالي واحد، في شاشة واحدة"**. |
| C5 | 1611, 1727 | Pricing includes list still promises **"Withdrawals to your own account"** / **"سحب فلوسك على حسابك إنت"**. Platform payouts are dead — this survived the sweep in the drawing as well as in the app. |
| C6 | 1628–1630, 1738–1740 | Add-on prices contradict the model: Extra branch **299** (model: 199), Team seat **99** (model: 0), Advanced analytics **149** (model: 0). |
| C7 | 1374–1377 vs the `/pricing` script | The `/teachers` tiles state teacher capacity **"a week"**; the drawing's own `/pricing` screen states it as **"Active students a month"**, which is what the app renders. The drawing contradicts itself. |

---

## Headline

**The excision sweep edited the drawing and never reached the app.** All three strings flagged for removal were successfully deleted from `Merged-Public-Marketing.html`, but *"Teacher payouts"*, *"Split to each teacher's own account, or land in yours. Your call."*, *"A link with every invoice, paid by card"* and *"Withdrawals to your own account"* are all live on tutoringhq.app's public marketing pages right now, in both languages, across 8 of the 16 public pages captured — plus a landing-page h1 that says **"You teach. We collect."** in English and **"التحصيل علينا"** in Arabic. Under the new model the platform never touches tuition, so every one of those is a promise to a prospect that the product cannot keep. Separately, the drawing's own Arabic landing page still says InstaPay collection turns on **"after we verify your identity"**, and one Arabic string in it was corrupted into a non-word by the replace pass that produced the fix.
