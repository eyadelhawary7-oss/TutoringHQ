# Re-diff — Merged-Center-WhatsApp.html vs LIVE

**Design file:** `/home/user/TutoringHQ/design/Merged-Center-WhatsApp.html`
**Scratch:** `/tmp/rediff/center-whatsapp`
**Captured:** 8 August 2026, localhost:3000, owner of "Test Center 333", 390×844 @2x
**Read first:** `design/NEW-MODEL.md`

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-WhatsApp.html | wc -l
12

$ awk '/mgd-num/{s=$0} /class="phone"/{n[s]++} END{for(k in n) print n[k], k}' \
    design/Merged-Center-WhatsApp.html | sed 's/<[^>]*>/ /g'
6   03  WhatsApp Custom Flow  Screen-WhatsApp-Custom-Flow.html
3   02  WhatsApp Pack         Screen-WhatsApp-Pack.html
3   01  WhatsApp              Screen-WhatsApp.html
```

**12 frames.** 3 + 3 + 6 = 12.

---

## 2. Screens — 3

| # | Name | Source | Frames |
|---|---|---|---|
| 01 | WhatsApp | `Screen-WhatsApp.html` | 3 — EN list (one expanded), EN preview sheet, AR list |
| 02 | WhatsApp Pack | `Screen-WhatsApp-Pack.html` | 3 — EN notifications, EN promotions, AR notifications |
| 03 | WhatsApp Custom Flow | `Screen-WhatsApp-Custom-Flow.html` | 6 — 1 Tap Custom, 2 Set amount, 2b promotions, 3 Confirm·Paymob, 4 Done, AR 3 تأكيد |

---

## 3. Frame accounting

```
Drawn: 12 | Exercisable: 3 | Exercised: 3 | Blocked: 9
```

3 exercised + 9 blocked = 12.

### Capture result — all six routes MEASURED

```
$ node scripts/rediff/capture-batch.mjs /tmp/rediff/center-whatsapp \
    "/en/whatsapp,/ar/whatsapp,/en/whatsapp-pack,/ar/whatsapp-pack,/en/parent-whatsapp,/ar/parent-whatsapp" 6000
/en/whatsapp         -> en_whatsapp         OK chars=4680
/ar/whatsapp         -> ar_whatsapp         OK chars=4512
/en/whatsapp-pack    -> en_whatsapp_pack    OK chars=609
/ar/whatsapp-pack    -> ar_whatsapp_pack    OK chars=586
/en/parent-whatsapp  -> en_parent_whatsapp  OK chars=298
/ar/parent-whatsapp  -> ar_parent_whatsapp  OK chars=262

measured 6/6 routes
```

Manifest: 0 redirected-to-login, 0 still-skeleton, 0 pageErrors, 0 httpErrors on all six.
**No tooling blocks.** Every block below is a product fact, not a capture failure.

`/en/parent-whatsapp` and `/ar/parent-whatsapp` resolved to `finalUrl: /en/whatsapp-pack` and `/ar/whatsapp-pack`. `src/app/[locale]/parent-whatsapp/page.tsx` is 9 lines and its whole body is `redirect(`/${locale}/whatsapp-pack`)`. It is a redirect stub, not a third screen.

### Exercised (3)

| Frame | Evidence |
|---|---|
| §01 F1 · EN list, one expanded | `en_whatsapp.png`, `slices/en_whatsapp_s0..s4.png`, `fold/en_fold.png`, `interact/en_expanded.png` |
| §01 F2 · EN preview sheet | `interact/en_preview_sheet.png` — sheet opened via the inline Preview chip on `chq_parent_absence`; `[role="dialog"]` count 1 |
| §01 F3 · AR list | `ar_whatsapp.png`, `slices/ar_whatsapp_s0.png`, `fold/ar_fold.png`, `interact/ar_preview_sheet.png` |

### Blocked (9) — every one named

| Frame | Reason | Why |
|---|---|---|
| §02 F4 · EN notifications balance + tiers | **not-built** | No message-credit balance, no tier list, no Recharge section exists. Live `/whatsapp-pack` is a per-parent monthly subscription, not prepaid credit. |
| §02 F5 · EN promotions balance + tiers | **not-built** | Same. No promotions credit balance and no separate promotions tier list anywhere. |
| §02 F6 · AR notifications | **not-built** | Same. |
| §03 F7 · 1 · Tap Custom | **not-built** | No custom-pack sheet. |
| §03 F8 · 2 · Set amount | **not-built** | No stepper, no quantity chips, no volume rate bands. |
| §03 F9 · 2b · Same step, promotions | **not-built** | Same. |
| §03 F10 · 3 · Confirm · Paymob | **not-built** | No message-pack checkout. |
| §03 F11 · 4 · Done | **not-built** | No credit-added confirmation. |
| §03 F12 · AR · 3 · تأكيد | **not-built** | Same. |

### Live screen I could NOT measure — named separately, not counted in the 12

**`/whatsapp-pack` in its `parent_pack_enabled = true` state — reason: no-data.**
`WhatsAppPackClient.tsx` has four states. Test Center 333 rendered the fourth (`/* STATE 1 - none (or other): request pack */`, line 869), which the code reaches only when `packEnabled === false` and `requestStatus` is neither `pending` nor `rejected`. The enabled state (lines 249–789 — status card, parent table, announcement composer, blast history) never rendered. I did **not** flip `centers.parent_pack_enabled` to force it, because the environment is fixed. Everything I say about that state below is read from source and is labelled as such.

---

## 4. Does "WhatsApp Custom Flow" exist live at all?

**No. Not in any form.** Established four ways:

1. **No route.** `find src/app -type d -name '*whatsapp*'` returns 11 directories. The three center-facing page routes are `[locale]/whatsapp`, `[locale]/(dashboard)/whatsapp-pack`, `[locale]/parent-whatsapp` (redirect stub). There is no custom-pack route, and no sub-route under `whatsapp-pack` (`ls` shows exactly `page.tsx`, `loading.tsx`, `WhatsAppPackClient.tsx`).
2. **No component.** `grep -rl "customPack|custom_pack|messageCredit|message_credit|messagesLeft|messages_left|topUp|top_up|packTier|pack_tier" src/` → **0 files**.
3. **No pricing model to drive it.** The design's flow prices *messages* in volume bands (1 / 0.75 / 0.5 EGP per notification; 7 EGP flat per promotion). Live has no per-message price anywhere. `src/lib/parentPack.ts:8` is `PACK_PRICE_PER_PARENT = 12` (per parent per **month**) and `src/lib/invoiceTemplates.ts:16` is `BLAST_PRICE_PER_PARENT_INCLUSIVE = 9.8` (per parent per **blast**). Neither is a message price.
4. **No checkout.** No Paymob intent, no confirm-and-pay step, and no "Credit added" terminal state for a message pack. The only pack-related payment path is the monthly invoice generated from `parent_pack_enabled`, plus an `announcement_cap` invoice raised when the blast balance crosses the plan cap (`api/parent-pack/announcement/route.ts:122-141`).

The design's own framing — "Custom pack · the flow … One shared flow serves both portals … Only the rate changes" — describes a product that has never been built. **All 6 frames: not-built.**

---

## 5. Consent surface

### Direct answer: **no. None of the three screens exposes any of the three toggles.**

Verified, not inferred:

```
$ grep -rn 'notify_on' src/app/[locale] src/components --include=*.tsx | wc -l
2
$ grep -rn 'notify_on' src/app/[locale] src/components --include=*.tsx
src/app/[locale]/settings/notifications/page.tsx:138: `public` are `students.notify_on_absence` / `notify_on_balance` /
src/app/[locale]/settings/notifications/page.tsx:139: `notify_on_scan`, which are per-STUDENT parent toggles, a different
```

Both hits are inside a **code comment**. There is not one rendered control for `notify_on_scan`, `notify_on_absence` or `notify_on_balance` anywhere in the center-facing app.

```
$ grep -rn "api/whatsapp-pack" src/ tests/ scripts/ | grep -v "^src/app/api/whatsapp-pack/"
(no output — exit 1)
```

`GET /api/whatsapp-pack/settings` (reads all three back, lines 50 and 91–93) and `PATCH /api/whatsapp-pack/student/[studentId]` (writes all three, lines 36–43) have **zero callers** in `src/`, `tests/` or `scripts/`. They are reachable only by hand.

### This is a consent failure, and its shape is worse than "controls that don't work"

The brief's send-path facts all hold, re-verified this session:

| Flag | Written by | Read back by | Honoured at send |
|---|---|---|---|
| `notify_on_scan` | `api/students/[id]` (allow-list line 39), `api/whatsapp-pack/student/[studentId]` (line 37) | `api/whatsapp-pack/settings` (line 91) | **Yes** — `lib/whatsapp/flows/parentNotifications.ts:82`: `if (!s.parent_phone \|\| !s.parent_consent_given \|\| s.notify_on_scan === false)` |
| `notify_on_absence` | same two routes (lines 40, 40) | line 92 | **No** |
| `notify_on_balance` | same two routes (lines 41, 43) | line 93 | **No** |

```
$ for f in .../parent-absence-alerts/route.ts .../parent-balance-alerts/route.ts; do ... done
parent-absence-alerts:  notify_on_absence: 0   notify_on_balance: 0   parent_pack_opted_in: 3
parent-balance-alerts:  notify_on_absence: 0   notify_on_balance: 0   parent_pack_opted_in: 1
```

`parent-absence-alerts/route.ts:97` gates on `if (!s.parent_pack_opted_in) continue;` and nothing else. `parent-balance-alerts/route.ts:67` gates on `.eq('parent_pack_opted_in', true)` and nothing else. Zero references to the absence and balance consent columns in either cron.

**So the honest classification is: the consent surface is ABSENT from the product, while two of the three consent flags are live, writable, readable and silently ineffective.**

That is not milder than the brief's framing — in one respect it is worse. A UI that shows a broken toggle can at least be caught by anyone who looks at the screen. Here there is nothing on any screen to look at: the flags can be set through `PATCH /api/students/[id]` or `PATCH /api/whatsapp-pack/student/[studentId]`, they read back faithfully through `GET /api/whatsapp-pack/settings`, and two of them change nothing about what gets sent or billed. Any importer, admin tool or support script that writes them — and the write route is a general student-update allow-list, so this is an easy thing to do by accident — creates a stored opt-out that the product will honour on paper and violate in fact, while billing the centre 9.8 EGP per parent for every message it should never have sent. Nothing in the app will ever surface the contradiction.

### Does any screen claim the toggles take effect?

**No — because no screen mentions them.** Quoting what I actually rendered, in full:

`/en/whatsapp-pack` and `/en/parent-whatsapp` (identical — the second redirects to the first), complete card text:

> **Parent WhatsApp Pack**
> Submit a request to activate the Parent WhatsApp Pack. Requests are reviewed within 24 hours.
> EGP 12 per student per month. Billed monthly.
> EGP 12 per student per month - counted after approval
> **Request Pack**

`/ar/whatsapp-pack` and `/ar/parent-whatsapp`, complete card text:

> **باقة واتساب الأهالي**
> قدّم طلبك لتفعيل باقة واتساب الأهالي. يتم مراجعة الطلبات خلال ٢٤ ساعة.
> ١٢ ج.مًا لكل طالب شهرياً - يُحسب شهرياً.
> ١٢ ج.مًا لكل طالب شهرياً - يُحتسب بعد الموافقة
> **طلب الباقة**

`/en/whatsapp` header and only standing claim about parents:

> **WhatsApp templates**
> Approved Meta templates your center may use for parents and ops. Previews use sample data.

No consent language, no opt-out language, no toggle, in either locale, on any screen that rendered.

### One rendered control that IS a consent control — and one label collision

In the **unrendered** pack-enabled state (source only, `WhatsAppPackClient.tsx:432-478`) there is a per-student `role="switch"` writing `parent_pack_opted_in` via `PATCH /api/parent-pack/student/{id}`. That flag **is** honoured — by both crons above and by `parentNotifications.ts`. So the one consent control the product has works.

Two things about it are still wrong:

- Its column header is `t('whatsapp.notifications')` — EN **"Notifications"**, AR **"الإشعارات"** (line 418). A switch labelled "Notifications" sitting one table away from three DB columns named `notify_on_*` is a collision waiting to be miswired, and it is very likely how the three dead flags came to be written by two routes and honoured by none.
- Flipping it changes `activeParents`, which drives `monthlyPackTotal = activeParents × 12`. It is a **billing enrolment switch presented as a notification preference.** A centre reading "Notifications: off" has no way to know it just stopped being charged for that parent — or, read the other way, that turning notifications *on* for a parent adds 12 EGP/month to the bill. The screen states the price only in aggregate (`whatsapp.monthlyCost`), never at the row where the decision is made.

### Where the toggles' labels *do* appear

`whatsappPack.notifScan` / `notifAbsence` / `notifBalance` ("Scan Notifications", "Absence Notifications", "Balance Notifications") are rendered — but on the **super-admin** screen `[locale]/(admin)/admin/whatsapp-pack`, lines 521–523, as four platform-wide switches under "Global Controls". Those write `PATCH /api/admin/whatsapp-pack/config` (line 399), a platform config object. They are **not** the per-student consent columns. Same three words, different mechanism, no connection to a parent's choice. Out of scope for these three screens; recorded because it is the third distinct thing in this codebase called "notifications".

---

## 6. Divergences

### A. Against the APP — defects

**A1 · CONSENT: two of three parent opt-outs are writable, readable and dead. [severity: highest]**
Detailed in §5. `notify_on_absence` and `notify_on_balance` are accepted by two write routes, echoed by a read route, and consulted by nothing at send. No UI exposes them, so nothing in the product can reveal the contradiction. Billing follows the send, so a stored opt-out costs the centre money. Files: `api/students/[id]/route.ts:39-41`, `api/whatsapp-pack/student/[studentId]/route.ts:36-43`, `api/whatsapp-pack/settings/route.ts:91-93`, `api/cron/parent-absence-alerts/route.ts:97`, `api/cron/parent-balance-alerts/route.ts:67`, `lib/whatsapp/flows/parentNotifications.ts:82`.

**A2 · MONEY: blast invoice components do not sum to the blast total, and still charge a retired 6% service fee.**
`api/parent-pack/announcement/route.ts:91-94` stores four fields on `announcement_blasts`:

```
base_amount  = parents × BLAST_BASE_PER_PARENT (6.72)
service_fee  = base × BLAST_SERVICE_FEE_RATE  (0.06)
vat          = base × BLAST_VAT_RATE          (0.14)
total_amount = parents × BLAST_PRICE_PER_PARENT_INCLUSIVE (9.8)
```

Per parent: 6.72 + 0.40 + 0.94 = **8.06**, against a stored `total_amount` of **9.80** — a **1.74 EGP per parent** gap with no line to explain it. Separately, `BLAST_SERVICE_FEE_RATE = 0.06` and `PACK_SERVICE_FEE_RATE = 0.06` (`lib/parentPack.ts:10,16`) are the 6% service fee that `CLAUDE.md` and `docs/SERVICE_FEE_REMOVAL_FINDINGS.md` record as removed — VAT-inclusive-only is the rule. `PACK_BASE_PER_PARENT = 10.08` likewise fails to reconcile: 12 / 1.14 = 10.5263, not 10.08. The pack constants have no reader (grep found callers only for the three `BLAST_*` ones, at lines 91–93); the blast ones are live on every send.

**A3 · The template list is unreadable at phone width, in both languages.**
Measured at 390×844:

| | EN | AR |
|---|---|---|
| Template titles truncated | **43 of 44** | **43 of 44** |
| Template IDs truncated | **43 of 44** | **44 of 44** |
| Title box width | 85 px | 80 px |
| `"Card Order Cancelled"` needs | 149 px | 149 px |
| `"chq_card_order_status_update"` needs | 153 px | 167 px |

Both the human name and the `chq_` ID truncate on the same row, so the disambiguator dies with the label. The seven card-order rows render as seven copies of `Card Orde… / chq_card_orde…` (see `slices/en_whatsapp_s0.png`). A centre cannot tell "Card Order Cancelled" from "Card Order Refunded". The design solves this by giving the row's full width to name + preview and no fixed column to the badge; live reserves a right-hand column for `status` + `category`, and the title pays for it.

**A4 · AR truncates from the wrong end, so Latin template names lose their head instead of their tail.**
In RTL the ellipsis lands at the logical end, which for an LTR string is its **left**. `fold/ar_fold.png` and `slices/ar_whatsapp_s0.png` render:

> `…ancelled` · `…Delivered` · `…n Transit` · `…rder Paid` · `…efunded` · `…s Update` · `…g Step1` · `…ent Ops` · `…hipped` · `… Invoice`
> IDs: `…er_cancelled` · `…er_delivered` · `…er_in_transit` · `…_order_paid` · `…atus_update` · `…ck_invoice`

An Arabic reader sees "…ancelled" and cannot recover the word. This is strictly worse than the EN case and is specific to the RTL screen. Arabic typography is a product rule, so this counts against the app regardless of the design's `class="ar"` markers.

**A5 · Arabic template bodies render with broken punctuation in the list, and correctly in the sheet — same string, two renderings.**
`TemplatePreviewLine` (`WhatsAppTemplatesClient.tsx:133-146`) emits its spans with **no `dir` attribute**. Measured: **16 preview lines on the page, 0 carrying a `dir` attribute**, in both locales. The result is Arabic sentences whose trailing punctuation jumps to the visual left:

> `.شكرًا لتعاونك` · `.الحصة` · `. {{center}}` · `:طريقة الدفع` · `:المجموعات` · `.SMS`

The preview *sheet* sets `dir="rtl"` explicitly on the bubble (line 459) and renders the identical body correctly — visible side by side in `interact/en_preview_sheet.png`, where the sheet's bubble is clean and the list row behind it is not. One line of the same component family has the attribute; the other does not. `check:bidi` does not catch this: it enforces CSS logical properties, not `dir` on mixed-direction content.

**A6 · The CTA to the pack screen is clipped off the viewport in both languages.**
Measured, viewport 390 px:

| | box width | left | right | px outside viewport |
|---|---|---|---|---|
| EN "Parent pack & blasts" | 156 | 277 | 433 | **43** |
| AR "باقة أولياء الأمور والإعلانات" | 185 | −55 | 130 | **55** |

Renders as "Parent pack & bl" and "باقة أولياء الأمور والإ" (`fold/en_fold.png`, `fold/ar_fold.png`). `documentElement.scrollWidth === clientWidth === 390` in both locales, so this is clipped by an ancestor, not page overflow — the user cannot scroll to reveal it. This is the only navigation link from Templates to the Pack screen.

**A7 · Duplicate pricing line on the pack request card.**
Both locales print the same fact twice, one line apart: "EGP 12 per student per month. Billed monthly." then "EGP 12 per student per month - counted after approval" (`whatsapp.requestPackPricingLine` and `whatsapp.pricingNote`). The AR pair reads `١٢ ج.مًا` in both — the `ج.مًا` form carries a stray tanween that `ج.م` should not take.

**A8 · `[locale]/parent-whatsapp` is an app route prefix absent from `AUTHENTICATED_ROUTE_PREFIXES`.**
`src/proxy.ts:134-135` lists `/whatsapp-pack` and `/whatsapp`; `/parent-whatsapp` is not there. Effect today is nil — the page body is a bare `redirect()` with no data access, and the target is protected (unauthenticated `curl` gives 307 → `/whatsapp-pack` → 307 → `/login`). Recording it because `CLAUDE.md` makes registering new prefixes a standing rule and this one reads as unprotected in an audit.

**A9 · Untranslated Arabic strings shipped past the i18n gate.**
`whatsappPack.globalControls` AR = `"عام Controls"`, `whatsappPack.globalControlsDesc` AR = `"عام Controls Desc"`. Key parity passes because both keys exist; the values are half-machine-translated placeholders. Rendered on the admin pack screen, not on the three in scope — noted because it is the same message namespace these screens draw from.

### B. Against the DRAWING — stale design

**B1 · §02 and §03 draw a prepaid message-credit product. Live sells a per-parent subscription. Nine of twelve frames describe a business model that does not exist.**
Design: two credit balances ("3,240 messages left", "140 messages left"), tiers at 200 / 1,000 / 5,000, per-message rates 1 / 0.75 / 0.5 and 7 flat, "never expires and carries over", a Custom volume flow, Paymob checkout, "Credit added".
Live: `PACK_PRICE_PER_PARENT = 12` EGP per parent per **month**, requested and manually approved within 24 h; plus `BLAST_PRICE_PER_PARENT_INCLUSIVE = 9.8` EGP per parent per blast, accrued against a plan cap (`ANNOUNCEMENT_CAPS`: nano 700 … enterprise 18,000, top_centers 99,999) and invoiced when the cap is crossed. There is no message balance, no expiry promise, no tier, no custom amount and no checkout. This is not drift in numbers; it is a different revenue mechanic, and the drawing is stale against it.

**B2 · Live breaks NEW-MODEL's separation rule — and the design is the side that's right.**
NEW-MODEL: *"WhatsApp parent packs — priced separately so a reminder pack cannot be spent on marketing."* The design honours this exactly: two balances, two prices, and copy that says so — "This credit is separate and cannot be spent on notifications."
Live does the opposite. `api/parent-pack/announcement/route.ts:94` is `totalAmount = parentsNotified × BLAST_PRICE_PER_PARENT_INCLUSIVE` with **no branch on `blastType`**. Ops and promo blasts cost the same 9.8 EGP/parent, draw down the **same** `centers.announcement_balance` (line 117), and are checked against the **same** `getAnnouncementCap(plan)` (line 72). The only thing `blastType` selects is the Meta template name (line 96) and which sender is called (line 159). **A reminder allowance can be spent entirely on marketing.** The design should be treated as the specification here and the app as the defect; I have listed it under stale design only because the drawing's *pricing* (7 EGP flat, 1/0.75/0.5 banded) is itself stale.

**B3 · §01 draws Edit and an auto-send toggle. Neither exists, and the omission is deliberate and documented.**
Design F1 draws four chips — Edit, Preview, "Auto: on", More — and per-row badges reading Auto / Manual / Off; F2's sheet carries a "Send automatically" toggle and an "Edit template" button. Live renders one inline chip (Preview) plus More, and per-row badges showing the **Meta** status (APPROVED / PENDING / IN_REVIEW). `WhatsAppTemplatesClient.tsx:236-248` states the reason: `wa_meta_templates` has no `auto_send` and no `message_body` column, `center_message_templates` has both but holds 0 rows and no reader, and enabling unattended auto-send is a held decision (D4). Correctly omitted rather than faked — but the drawing has not been updated to match, so it still promises a centre it can edit Meta-approved copy from this screen, which it cannot.

**B4 · §01 draws an Add (+) button. Live has none, and cannot.**
The design's topbar has a primary `+`. Templates originate in Meta Business Manager and sync in (`syncMetaTemplates` on the admin screen); a centre cannot author one. The drawing implies a capability the product does not and should not have.

**B5 · §01's preview bubble is drawn as WhatsApp chrome. Live is a neutral panel.**
Design: `#dcf8c6` green bubble, delivered ticks, "4:12 PM" timestamp. Live: `var(--color-panel)` on `var(--color-tile)`, no ticks, no timestamp (`interact/en_preview_sheet.png`). Live also pins the bubble right in both directions (`justify-end` inside `dir="ltr"`, line 456), so on the Arabic screen the outgoing message sits on the incoming side.

**B6 · §01's sample preview shows English body copy. Every real template body is Arabic.**
The design bubble reads "Dear parent, Youssef Adel was absent from today's Math session." Live renders `أهلًا أحمد محمد، سنتر النخبة بيتواصل معاك: أحمد محمد كان غايب النهاردة من الحصة.` — on the **English** screen too, because Meta holds one Arabic body per template. The design's EN frame implies a per-locale template body that does not exist; live's handling (Arabic body, `dir="rtl"` on the bubble, Latin `{{var}}` tokens preserved) is the correct behaviour and the drawing should follow it.

**B7 · §02's footer promises "20 EGP processing fee" on the pack screen. Live's request card names no fee and no VAT.**
NEW-MODEL requires the 20 EGP processing fee on every invoice the platform issues to a centre, packs included. Live does apply it to the blast cap invoice (`announcement/route.ts:126`, `metadata: { processing_fee: processingFee }`). But the rendered request card says only "EGP 12 per student per month. Billed monthly." — no VAT statement, no processing fee, no total. The design's disclosure line is the better copy and is absent from the built screen.

**B8 · §02's only consent claim sits on an unbuilt frame — and live already honours it.**
The design's notifications hero reads "Never expires · **only subscribed parents receive pack messages**" (AR: "تصل رسائل الباقة للمشتركين فقط من أولياء الأمور"). That claim is true of live via `parent_pack_opted_in`, which both crons respect. It is the single sentence in this whole design file that states a consent rule — and it lives on a frame that does not exist, on a screen whose built form says nothing about consent at all.

---

## Artifacts

`/tmp/rediff/center-whatsapp/` — `_manifest.json`, 6 full-page PNGs + 6 rendered-text dumps, `slices/` (7 sliced PNGs), `fold/` (2 above-the-fold PNGs), `interact/` (4 PNGs + 3 text dumps).
Temporary capture scripts were removed from `scripts/rediff/` after use; only the pre-existing harness remains. No code was written and no app or database state was changed.
