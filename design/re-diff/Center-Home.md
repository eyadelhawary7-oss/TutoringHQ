# Re-diff — Merged-Center-Home.html vs LIVE

**File:** `/home/user/TutoringHQ/design/Merged-Center-Home.html`
**Routes:** `/en/dashboard`, `/ar/dashboard`, `/en/notifications`, `/ar/notifications`
**Captures:** `/tmp/rediff/center-home` · **Date:** 8 August 2026 · Owner of "Test Center 333"
**Design file state at diff time:** `af1d995c design: sweep the dead model out of Center-Setup and Center-Home (#370)`

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-Home.html | wc -l
8
```

Per-section split (awk over `mgd-bar` markers, sums to 8):

```
section 01: 2 phones
section 02: 2 phones
section 03: 4 phones
```

Supporting counts, all run this session:

| Command | Result |
|---|---|
| `grep -o 'class="nrow' … \| wc -l` | 20 (10 EN + 10 AR) |
| `grep -o 'class="nrow unread"' … \| wc -l` | 12 (6 EN + 6 AR — matches the "6 unread" label) |
| `grep -o 'class="kpi"' … \| wc -l` | 8 (4 EN + 4 AR) |
| `grep -o 'class="sess"' … \| wc -l` | 8 (4 EN + 4 AR) |

## 2. Screens

- **§01 Center Dashboard** — 2 frames (EN, AR)
- **§02 Notifications** — 2 frames (EN, AR)
- **§03 Active Balance** — 4 frames (EN/AR "balance above the day", EN/AR "pay invoice")

## 3. Coverage

```
Drawn: 8 | Exercisable: 6 | Exercised: 6 | Blocked: 2
```

Capture was clean — harness reported `measured 4/4 routes`, manifest shows `ok:true`,
`stillSkeleton:false`, `redirectedToLogin:false`, `pageErrors:[]`, `httpErrors:[]` on all four,
chars 767 / 736 / 429 / 443. Nothing here is a tooling excuse.

**Blocked frames, named:**

| Frame | Reason |
|---|---|
| §03 frame 3 — EN · "Pay invoice", balance applied before the total | `tooling` — the paying page is not among this file's four assigned routes. Not captured, so not ruled on from render. Owning file is `Merged-Center-Money`. |
| §03 frame 4 — AR · "ادفع الفاتورة" | `tooling` — same. |

**Element-level blocks inside frames that WERE exercised** (stated so coverage is not overread):

| Element | Frame | Reason |
|---|---|---|
| `.alert` "8 unpaid links / oldest 4 days / Review" | §01 EN+AR | `no-data` — code path exists (`safeData.unpaidCount > 0 &&`, dashboard/page.tsx:691); centre has 0 unpaid. |
| 4 `.sess` schedule rows + `Billed`/`Next`/`Later` chips | §01 EN+AR | `no-data` — centre has no `schedule_slots` for Saturday; live draws its empty state instead. |
| All 10 notification row types, Today/Earlier grouping, unread count | §02 EN+AR | `no-data` — feed is empty ("No notifications yet." / "لا توجد إشعارات بعد."). Shell, title and Mark-all-read were exercised; the row typology was not. |

---

## 4. Divergences ruled AGAINST THE APP (defects)

### D1 — §03's balance card is absent from the dashboard, and the reason recorded in code is the *dead* model

**Rendered evidence:** `en_dashboard.png`, `ar_dashboard.png`. In both, the first block beneath the
header is **`Today`** / **`اليوم`**. There is no balance card, no "Your balance", no send-credit route.

The omission is deliberate and commented at `src/app/[locale]/dashboard/page.tsx:651-691`
("THE DESIGN'S BALANCE CARD (.bal) IS STILL DELIBERATELY ABSENT"). Every reason it gives belongs to
the **dead** payout model: missing RPC `payout_available_minor`, missing `center_payouts`,
`payout_requests` at 0 rows, `getAvailableBalanceMinor`, the headline "Available now", and
"Verification-Payouts / V3 / V4 territory".

That is not what §03 draws. §03's card reads **"Your balance · Source: Referrals · Applied to: Next
invoice"**, and NEW-FEATURES §7 defines it as referral credit applied to platform invoices. Referral
credit has real live plumbing: `GET /api/referral` returns `available` and `totalEarned` computed
from the `referral_commissions` table (`src/app/api/referral/route.ts:87-88,161`), and
`centers.credit_balance` is a live column read by `src/app/[locale]/settings/billing/page.tsx`.

So the card is blocked against a source it was never supposed to use, while the source it *was*
supposed to use is available. Not "not-built" — **mis-justified**.

### D2 — "Digital share" / "Online": dead-model vocabulary is live in both locales

Design §01 titles this block **"InstaPay share"** with legend **"InstaPay 15,200 · Cash 3,400"**
(AR: "نسبة التحصيل الإنستاباي" / "إنستاباي").

Live renders **"Digital share"** / **"نسبة التحصيل الرقمي"** with legend **"Online 0 · Cash 0"** /
**"أونلاين ٠ · نقدًا ٠"** — see `en_dashboard.png`, `ar_dashboard.png`.

Keys: `messages/en.json:2021 "digitalShareTitle": "Digital share"`, `messages/en.json:2024
"online": "Online"`, `messages/ar.json:5270`, `messages/ar.json:5273`. `grep -n "instapayShare\|instaPayShare" messages/*.json`
returns nothing — the renamed key was never added.

NEW-FEATURES §1 names a "digital" label as exactly the thing InstaPay replaced ("a 'digital' label
that meant nothing specific"), and NEW-MODEL kills online gateway collection outright. Worse, the
computation itself contradicts the label: `digitalShareOnline += d.instapay + d.other`
(page.tsx:492), and the file's own comment two blocks up says the non-InstaPay methods "were removed
with the gateway model and hold zero rows". The metric is InstaPay-only in fact and "Online" in copy.

### D3 — Confident zeros: a failed read and a settled account are pixel-identical

This is the item §7 of the brief asks for, and it is real.

Established from source, all re-derivable:

- `dbSelect` **returns** `{ data: null, error: err }` on failure — it does not throw
  (`src/lib/db-proxy.ts:91`).
- `src/app/[locale]/dashboard/page.tsx` coerces query results with `.data || []` in **7** places
  (`grep -c` → 7; lines 208, 209, 210, 240, 241, 242, 244).
- It checks the returned `error` field on **0** of those 7. The only `.error` occurrence in the whole
  871-line file is `console.error` at line 354.
- The outer `catch` (line 353) only fires if something *throws*. A `dbSelect` failure does not, so
  `setDashboardDataFresh(true)` at line 352 still runs and `data` is still set.
- `kpiStale = Boolean(data && !dashboardDataFresh)` (line 527) is therefore **false**, and the KPI
  grid renders at `opacity-100`.

Consequence, per figure: a failed `payments` read yields `paymentsData = []`, hence
`todayRevenue = 0` → **"Collected 0"**; and `revenueChartData` all-zero → `digitalShareTotal = 0` →
**"0%"**, **"0 EGP total"**, **"Online 0"**, **"Cash 0"** — at full opacity, with no error, no retry,
no marker. A failed `schedule_slots` read yields **"Sessions 0 · 0 done"** and
**"Students expected 0"**.

`en_dashboard.png` shows precisely that pixel state. In this capture the zeros are **genuine** —
`stillSkeleton:false`, no HTTP errors, the centre really has nothing today. That is the point: a
false zero would be indistinguishable from what I photographed.

Two things the app already gets right, which sharpen the gap rather than excuse it:

- The **Attendance** tile does this correctly — no denominator returns `null`, and the tile renders
  an em dash **"—"** plus **"0 scanned"** (lines 498-517, visible in both PNGs).
- The app **has** a staleness signal (`kpiStale` → `opacity-70`) for *cached* data. It has no
  equivalent for *failed* data, and failed data renders brighter than stale data.

The in-code defence at lines 510-514 — that Digital share is safe because it prints its own
denominator "0 EGP total" — holds for "nothing was collected" and fails for "the query failed",
because in that case the denominator is fabricated too.

### D4 — The centre's own name is truncated by a dead-model badge, and in Arabic it loses its head

Rendered: EN reads **"Test C…"**; AR reads **"…st Center 333"** — the Arabic truncation eats the
*start* of the Latin name.

Mechanism: `<h1 className="truncate …"><bdi dir="auto">{centerBilling?.name}</bdi></h1>` (line ~592)
inside a header whose far end is `ms-auto` pinned `<VerificationBadge>` + plan pill (lines 602-606).
At 390px the badge and pill win the row. In RTL, `text-overflow:ellipsis` clips the logical end,
which for an LTR name in an RTL container is its visual left — so the identifying first characters go.

The design draws **no badge in this slot at all**; its `.vbadge` class is defined and used 0 times.

### D5 — "Verification unavailable" badge present at diff time

Present in both locales (`en_dashboard.png`, `ar_dashboard.png`; AR "التحقق غير متاح"), rendered by
`src/components/verification/VerificationBadge.tsx` via `dashboard/page.tsx:603`. Per the brief this
is reported as **confirmed-present-at-diff-time**, not as a new finding — a separate PR is removing it.

### D6 — Dead notification routing still live in code (source-read, not render-proved)

`src/app/[locale]/(dashboard)/notifications/NotificationsPageClient.tsx` `KIND_RULES` still carries:

- line 102 — `{ match: ['payout'], icon: Banknote, tone: 'money' }`
- line 113 — `{ match: ['verif', 'identity'], icon: ShieldCheck, tone: 'money' }`

and its comment at 108-113 justifies the second by citing "§02 tints *Identity verified* `.i-ok`" —
a row the drawing no longer contains (see S1).

Both rules are unreachable: of **35** distinct `kind: '…'` literals in `src/app/api` + `src/lib`,
**0** match `payout|verif|identity`.

Marked source-read because the live feed is empty; I did not photograph a row taking these branches.

### D7 — Referral credit is presented as withdrawable cash (source-read)

`src/components/referrals/ReferralWithdrawalPanel.tsx` renders "Request withdrawal", enforces
`REFERRAL_WITHDRAWAL_MIN_EGP`, and POSTs to `/api/referrals/payout`. It is mounted by
`src/app/[locale]/referrals/page.tsx:219` and `src/app/[locale]/settings/referrals/page.tsx:295`.

NEW-MODEL is explicit: credit "is applied to platform invoices automatically and **cannot be
withdrawn as cash**". Relatedly, the one place credit *is* applied to an invoice live
(`settings/billing/page.tsx:2188` `useCredits && credit_balance > 0` → "creditApplied: −…") is an
**opt-in toggle inside the reactivation flow** — the exact shape NEW-FEATURES §7 forbids ("applied
before the total, not offered as an option afterwards").

Both routes sit outside the assigned four; reported from source, not render.

### D8 — Arabic type scale: mirroring is right, the size step is missing

The settled Arabic rule has four parts. Mirroring from `dir="rtl"` is **satisfied** — both AR
captures mirror layout, nav order and iconography correctly. The **one-step size bump** is not
implemented: `grep` for locale-conditional typography in `dashboard/page.tsx` returns 0 hits, and
`globals.css` has no `:lang(ar)` / `[lang="ar"]` type rule (its only `html[dir="rtl"]` block, line
824, sets motion tokens, plus a background-wash flip). KPI values use `.num`, which is
`font-variant-numeric: tabular-nums` only (globals.css:1018) — no mono, so the "drop mono at weight
600" clause has nothing to bite on here. AR and EN KPI values therefore render at the same step.

---

## 5. Divergences ruled AGAINST THE DRAWING (stale design)

### S1 — The KNOWN notification defects are RESOLVED. Verified against the file as it is now.

`git log --oneline -3 -- design/Merged-Center-Home.html` shows the file was edited by
`af1d995c design: sweep the dead model out of Center-Setup and Center-Home (#370)`, so I re-checked
rather than assumed:

| Check run | Result |
|---|---|
| `grep -c 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'` (shield-check path) | **0** |
| `grep -oiE 'payout\|auto-collect\|instapay account\|sent to your'` | **0 matches** |
| `grep -o 'class="vbadge"' \| wc -l` | 0 |

"Payout requested", "auto-collection", "1,350 EGP sent to your InstaPay", and the retitled
identity-verification row that had kept its shield-check icon are **all gone**. The EN "Receipt
uploaded" row now carries a genuine upload glyph (`M12 21V9M7 13l5-5 5 5M4 3h16`). This KNOWN is
closed, not outstanding.

### S2 — Residue the sweep left behind

**S2a — "Payment failed" carries a credit-card glyph, on a row whose body says InstaPay.**
The same test shape as the KNOWN: `grep -o 'M2 10h20' | wc -l` → **2**, i.e. once in EN and once in
AR, and on **no other row**. The glyph is `<rect x="2" y="6" width="20" height="13" rx="2"/>` +
`M2 10h20` — a payment card — attached to "Payment failed · Habiba Sameh · InstaPay not received,
retry sent" (line 296) and "فشل الدفع" (line 317). Card checkout is dead; an InstaPay row should not
wear its icon. Retitle-hiding-a-deletion, one row over from the one already caught.

**S2b — the copy on that row breaks a NEW-MODEL rule.** "Payment failed" / "فشل الدفع" states as
fact that money did not arrive. NEW-MODEL: "Never tell a parent they did not pay… A failed read is a
system problem, not an accusation."

**S2c — the figure 1,350 survived the rewrite.** The "8 unpaid links" row now reads "1,350 EGP
outstanding · oldest 4 days" (line 297). 1,350 is the same figure the KNOWN records on the deleted
"sent to your InstaPay" payout row. The sentence was replaced; the number was carried across.

**S2d — "Order shipped · Card order `#THQ-2607` is on the way"** (lines 304, 325). NEW-MODEL lists
card orders as **"Parked. Coming soon."** The feed draws a shipping notification for a parked stream.

**S2e — "Add-on enabled · Advanced Analytics is now active"** (lines 305, 326). NEW-MODEL prices
analytics at **"0 for now. Priced later."** Softer than the above, but an "enabled" event for an
unpriced add-on is ahead of the model.

**S2f — dead-model residue in §01's own scaffolding.** `.vbadge` is defined (line 51) and used 0
times, and §01's source attribution in both the header comment and the section bar is still
`Screen-Center-Dashboard-Verified.html` — the filename still carries the two-state account model that
NEW-MODEL deletes.

### S3 — §01 draws no empty state; the app has one and it is better

Design §01 draws only a populated schedule. Live renders "Nothing scheduled today" / "لا يوجد جدول
لهذا اليوم" with a calendar glyph and a "Set up schedule" CTA (both PNGs). App is right, drawing is
incomplete.

### S4 — §01's Attendance tile draws a percentage with no unknown state

Design shows a flat "94%". Live shows "—" plus "0 scanned" when the denominator does not exist, which
is the honest behaviour and the one the code argues for at length (lines 498-517). App is right,
drawing is incomplete.

---

## 6. Does §03 "Active Balance" exist live?

**No. Not on the dashboard, in either language.**

Established three ways:

1. **Rendered.** `en_dashboard.png` and `ar_dashboard.png`: the first element under the centre-name
   header is `Today` / `اليوم`. Nothing sits above the day's numbers. Both captures are real renders
   (`stillSkeleton:false`, `ok:true`, no page or HTTP errors) — this is an absence, not a failed read.
2. **Rendered text.** Neither `en_dashboard.txt` nor `ar_dashboard.txt` contains a balance string;
   the sequence runs `… Starter → Today → Sessions …`.
3. **Source.** `dashboard/page.tsx:651` states the card is deliberately absent.

**Where the balance actually lives today, and why that is the failure §7 names.** Referral credit is
real and readable: `GET /api/referral` returns `available` / `totalEarned` from `referral_commissions`,
`centers.credit_balance` is a live column. But it surfaces **only inside the referral pages**
(`/referrals`, `/settings/referrals`), and there it is framed as a **withdrawal** rather than as
credit. NEW-FEATURES §7 anticipates exactly this: *"Showing it only inside the referral page would
mean a provider paying an invoice it already had the credit for."* That is the current live state.

**The gap is a mis-aimed justification, not a missing capability.** The recorded reason for omitting
the card is the absence of a payout engine — `payout_available_minor`, `center_payouts`,
`payout_requests`, "Available now". Under NEW-MODEL there is no payout engine and there never will
be; §03's headline is not "Available now" but "Your balance", sourced from referrals and applied to
the next invoice. The block cited is a dead-model block. The live source §03 needs exists.

Frames 3 and 4 of §03 (credit applied before the invoice total) are **blocked — `tooling`**: the
paying page is outside this file's four assigned routes. From source only, and flagged as such: the
one live credit-application path (`settings/billing/page.tsx:2188`) is an **opt-in `useCredits`
toggle in the reactivation flow**, which is the shape §7 explicitly rules out.

---

## 7. Dashboard honesty check

The dashboard prints **six** figures that read as confident zeros where the underlying value may
simply not have loaded:

| Figure | Live value | Fabricable on a failed read? |
|---|---|---|
| Collected | `0` | **Yes** — failed `payments` select → `paymentsData = []` → `todayRevenue = 0` |
| Digital share % | `0%` | **Yes** — same read; `digitalShareTotal = 0` → the `> 0` guard returns 0 |
| Digital share total | `0 EGP total` | **Yes** — same read; the denominator is fabricated with it |
| Online | `0` | **Yes** — same read |
| Cash | `0` | **Yes** — same read |
| Sessions / Students expected | `0 · 0 done` / `0` | **Yes** — failed `schedule_slots` select → `[]` |

Root cause, stated exactly: `dbSelect` signals failure by **returning** `{data: null, error}`, not by
throwing (`db-proxy.ts:91`). The dashboard applies `.data || []` in 7 places and inspects the
returned `error` in 0 of them. Because nothing throws, `setDashboardDataFresh(true)` still runs, so
`kpiStale` is false and the fabricated zeros render at **full opacity** — brighter than the
deliberately-dimmed cached-data state.

**One figure already does it right, and is the model for the rest.** Attendance returns `null` when
there is no denominator and renders **"—"** beside the real scan count, on the explicit reasoning
that "WHEN THERE IS NO DENOMINATOR THE PERCENTAGE IS UNKNOWN, NOT ZERO" (lines 498-517). Applying
that same unknown-state to Collected and to the Digital share triplet would close this. Checking the
`error` field on the 7 fallbacks is the prerequisite; without it the screen cannot tell the two
states apart in order to render them differently.

The in-code argument that Digital share is exempt because it shows its own denominator is sound for
an empty week and unsound for a failed query, because in that case the denominator is fabricated too.

---

## Unproduced frames

| Frame | Why |
|---|---|
| §03 EN · "Pay invoice" | Route outside the assigned four (`tooling`). Owned by `Merged-Center-Money`. |
| §03 AR · "ادفع الفاتورة" | Same. |

No capture failed, none redirected to login, none stayed skeletal. Every zero reported above was read
off a real render.
