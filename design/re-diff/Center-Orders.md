# Re-diff — `Merged-Center-Orders.html` vs the LIVE app

**Date:** 8 Aug 2026 · **Centre:** Test Center 333 (owner session) · **Viewport:** 390×844 @2x
**Design file:** `/home/user/TutoringHQ/design/Merged-Center-Orders.html`
**Captures:** `/tmp/rediff/center-orders/` (8 routes, 8 `.png` + 8 `.txt` + `_manifest.json`)
**Read first:** `design/NEW-MODEL.md` — *"Card orders — **Parked.** Coming soon."* (line 178)

---

## 1. Frames drawn

```
$ grep -o 'class="phone"' design/Merged-Center-Orders.html | wc -l
15
```

Per section (line ranges bounded by the `mgd-bar` markers at 260 / 336 / 425 / 595):

```
$ awk 'NR>=259 && NR<=335' … | grep -c 'class="phone"'   S01 Orders:        3
$ awk 'NR>=336 && NR<=424' … | grep -c 'class="phone"'   S02 OrderDetail:   2
$ awk 'NR>=425 && NR<=594' … | grep -c 'class="phone"'   S03 Checkout:      6
$ awk 'NR>=595'            … | grep -c 'class="phone"'   S04 ComingSoon:    4
```

3 + 2 + 6 + 4 = **15**, matching the total.

---

## 2. Screens — 4

| # | Name | Source screen | Frames |
|---|---|---|---|
| 01 | **Orders** | `Screen-Orders.html` | 3 — `EN · hub`, `EN · empty state`, `AR · RTL · الطلبات` |
| 02 | **Order Detail** | `Screen-Order-Detail.html` | 2 — `EN · timeline · tracking`, `AR · RTL · تتبع` |
| 03 | **Order Checkout** | `Screen-Order-Checkout.html` | 6 — `EN · 1 · delivery`, `EN · 2 · customize`, `EN · 3 · review`, `EN · 4 · payment`, `EN · success`, `AR · RTL · 2 · التخصيص` |
| 04 | **Card Orders Coming Soon** | `Screen-Card-Orders-Coming-Soon.html` | 4 — `EN · coming soon`, `EN · notified`, `AR · coming soon`, `AR · notified` |

---

## 3. Tally

```
Drawn: 15 | Exercisable: 2 | Exercised: 2 | Blocked: 13
```

Capture result — all 8 routes returned HTTP 200, none redirected to login, none still skeletal:

```
/en/orders                      -> OK chars=711
/ar/orders                      -> OK chars=672
/en/orders/checkout             -> OK chars=711   final: /en/orders?checkout_error=no_center
/ar/orders/checkout             -> OK chars=672   final: /ar/orders?checkout_error=no_center
/en/orders/checkout/customize   -> OK chars=711   final: /en/orders?checkout_error=no_cart
/en/orders/checkout/review      -> OK chars=711   final: /en/orders?checkout_error=no_center
/en/orders/checkout/payment     -> OK chars=711   final: /en/orders?checkout_error=no_center
/ar/orders/checkout/customize   -> OK chars=672   final: /ar/orders?checkout_error=no_center
measured 8/8 routes
```

6 of the 8 redirected (5 → `checkout_error=no_center`, 1 → `checkout_error=no_cart`). The 8 screenshots
collapse to **two distinct renders**, proven by hash:

```
39306f5a3f1742946534d673a1942984  en_orders.png en_orders_checkout.png
                                  en_orders_checkout_customize.png
                                  en_orders_checkout_payment.png en_orders_checkout_review.png
a39083d2aea33d925dffcb1665d8020d  ar_orders.png ar_orders_checkout.png
                                  ar_orders_checkout_customize.png
```

Every route in this area renders the **Card Orders Coming Soon** screen and nothing else.

### Blocked frames — all 13 named

| § | Frame | Reason | Why |
|---|---|---|---|
| 01 | `EN · hub` | `by-design` | `orders/page.tsx:125-144` returns `CardOrdersTeaser` because `centers.card_orders_enabled = false`. **Not measured** — the hub UI was never rendered. |
| 01 | `EN · empty state` | `by-design` | same gate |
| 01 | `AR · RTL · الطلبات` | `by-design` | same gate |
| 02 | `EN · timeline · tracking` | `not-built` | `/orders/[orderId]` is a hard 404 for **every** id — see defect **D2**. Not merely "no orders exist". |
| 02 | `AR · RTL · تتبع` | `not-built` | same |
| 03 | `EN · 1 · delivery` | `by-design` | parked gate + the bounce in **D4**. Not measured. |
| 03 | `EN · 2 · customize` | `by-design` | same |
| 03 | `EN · 3 · review` | `by-design` | same |
| 03 | `AR · RTL · 2 · التخصيص` | `by-design` | same |
| 03 | `EN · 4 · payment` | `not-built` | unreachable for every centre: the step before it 500s unconditionally (**D1**), and the `isPayment` bypass is dead (**D4**). |
| 03 | `EN · success` | `not-built` | `checkout/success/[orderId]` needs an order id that checkout can never mint (**D1**). |
| 04 | `EN · notified` | `not-built` | the "Notify me when it launches" CTA is deliberately absent — the write has no destination table. `CardOrdersTeaser.tsx` says so in its own header comment. No path reaches this state. |
| 04 | `AR · notified` | `not-built` | same |

**Exercised (2):** `§04 EN · coming soon` and `§04 AR · coming soon`.

**Tooling note, not a finding.** The manifest logged one `500` on an RSC prefetch of
`/en/orders?checkout_error=no_center` during the customize capture. Not reproducible — 4 further RSC
requests and 1 plain request to the identical URL all returned 200. Dev-server transient.

---

## 4. Which state does the live app actually show a centre today?

**The parked "Coming Soon" screen. The app agrees with NEW-MODEL — but by state, not by code.**

Live catalog, run this session:

```sql
select (select count(*) from card_orders)                          -- 0
     , (select count(*) from centers)                              -- 1
     , (select count(*) from centers where card_orders_enabled)    -- 0
     , (select count(*) from card_order_carts)                     -- 0
     , (select count(*) from card_order_cart_items)                -- 0
     , (select count(*) from card_order_items);                    -- 0
```

> **Correction to the brief:** there is **1** centre in the live database, not 2. `Test Center 333`,
> `card_orders_enabled = false`. "0 of 2" is now "0 of 1".

Both captured screens show, verbatim: the ID-card mock, a `Coming soon` / `قريبًا` pill,
"Student ID cards" / "بطاقات هوية الطلاب", the description, four feature rows, and a `Go to Settings` /
`الذهاب للإعدادات` action. Arabic is fully mirrored. No orders hub, no cart, no checkout wizard is
reachable from any of the eight routes.

**The important qualifier.** The parked screen is *not* a build-time decision. It is produced by one
boolean, and that boolean is a **self-serve owner toggle**:

- `src/app/[locale]/settings/money/page.tsx:113-133` — `handleCardOrdersToggle` writes
  `centers.card_orders_enabled` through `/api/db`.
- `card_orders_enabled` is **absent** from `CENTERS_PROTECTED_COLUMNS` in
  `src/lib/dbProxyProtectedColumns.ts`, so the proxy permits the write.

An owner who flips that switch un-parks the feature themselves and lands directly in D1/D2/D3 below:
a checkout that 500s on submit, an order detail that 404s, and an admin queue that 500s. So the honest
answer to "is the app shipping the parked screen or a broken flow" is: **it is shipping the parked
screen, with a broken flow sitting behind an unguarded switch the customer controls.** That is better
than shipping the broken flow, and worse than removing the switch.

---

## 5. Divergences AGAINST THE APP (defects)

### D1 — P0. Card-order checkout returns 500 `insert_failed` for every centre, unconditionally

`card_orders` has 35 columns and **`card_style` is not one of them** (`information_schema.columns`,
run this session). `src/app/api/card-order-cart/checkout/route.ts:189` inserts it anyway.

Proven live against the write path, without writing anything (zero-row PATCH; table held 0 rows
before and after):

```
PATCH /rest/v1/card_orders?id=eq.00000000-…  {"card_style":"dark"}
-> 400 {"code":"PGRST204","message":"Could not find the 'card_style' column of 'card_orders' in the schema cache"}
rows after -> [{"count":0}]
```

There is **no path around it**: lines 99-101 of the same route 400 with `missing_card_style` unless
`cart.card_style` is exactly `'dark'` or `'light'`, so no request can reach line 192 with the field
omitted. `card_style` exists on `card_order_carts` only — the column was added to the cart and never
to the order.

### D2 — P0. Centre-facing Order Detail is a hard 404 for every order id, for every centre

Broader than the brief's "vendor print PDF 404s". `CARD_ORDER_DETAIL_COLUMNS` in
`src/lib/loadCardOrderDetail.ts:29` lists `card_style`. Proven live:

```
GET /rest/v1/card_orders?select=id,card_style&limit=1
-> 400 {"code":"42703","message":"column card_orders.card_style does not exist"}
GET /rest/v1/card_orders?select=id&limit=1  -> 200 []
```

The loader collapses that error to `{ ok: false, status: 404 }` (lines 217-219 and 270-272), and
`src/app/[locale]/(dashboard)/orders/[orderId]/page.tsx:28` turns it into `notFound()`. **Section 02
of the drawing is unreachable even with data present.**

Blast radius — 5 call sites across 4 files:
`orders/[orderId]/page.tsx:27` · `(admin)/admin/card-orders/[orderId]/page.tsx:43` ·
`api/orders/[orderId]/route.ts:15` · `lib/generateInvoicePdf.ts:1201` and `:1202`.
The centre's order **receipt PDF** goes down with it.

### D3 — P0. Admin card-order queue list 500s

`src/app/api/admin/card-orders/route.ts:145` selects `card_style` in the list query; the error branch
at the same route returns `500`. Same root cause. (Outside this file's four screens, but it is the
same defect and it is total.)

Full set of statements touching `card_orders.card_style`: 6 reads —
`loadCardOrderDetail.ts` (`CARD_ORDER_DETAIL_COLUMNS`, used by the queries at `:212` and `:268`),
`api/admin/card-orders/[orderId]/pdf/route.ts:33`, `lib/vendorNotify.ts:64`, `lib/vendorNotify.ts:117`,
`api/admin/card-orders/route.ts:145` — plus 1 write, `api/card-order-cart/checkout/route.ts:189`. 7 total.

### D4 — P1. Every direct navigation to a checkout URL bounces, with a false reason

**Measured, not inferred:** 5 of the 6 checkout routes landed on `?checkout_error=no_center` for an
owner who demonstrably *has* a `center_id` (the sidebar in the same capture names the centre).

Mechanism: `CheckoutShell.tsx:81-100` runs its gate the moment `loading` is false.
`useCardOrderCart.tsx:264` defines `loading = Boolean(isLoading && !payload)`, and lines 70-71 set the
SWR key to `null` until `useUser()` hydrates — SWR reports `isLoading: false` for a null key. So the
gate fires against `user === null` and takes the `!user?.center_id` branch at line 83.

Second-order: the `isSuccess || isPayment` bypass sits at line 87, **after** the centre check at line 83.
A centre returning to `/orders/checkout/payment?orderId=…` — which is the Paymob return path and the
refresh path — is bounced too. `§03 EN · 4 · payment` has no reachable route even once D1 is fixed.

### D5 — P1. The bounce reason is then silently swallowed

`orders/page.tsx` returns `CardOrdersTeaser` at lines 131-143, *before* `OrdersPageClient` — which is
the only consumer of `searchParams.checkout_error`. The user is redirected carrying an error code that
is never rendered. Confirmed in both screenshots: no banner, no message.

### D6 — P1. The mobile top bar advertises the parked feature

`src/components/MobileTopBar.tsx:72-85` renders a shopping-cart button linking to `/orders` for **any**
user with a `center_id`, with no `card_orders_enabled` check. `src/components/Sidebar.tsx:215` hides
the same entry when the flag is off. At 390px — the only viewport a centre owner uses — the cart icon
is visible in the header of every dashboard screen and leads to a "Coming soon" wall. Visible in both
captured PNGs. It also falsifies `ComingSoon.tsx`'s own comment, which asserts the Orders entry is
"currently *hidden* when `card_orders_enabled` is false".

### D7 — P1. The parked screen's only action is clipped by the fixed bottom tab bar

`CardOrdersTeaser.tsx` (and `ComingSoon.tsx`) wrap in `min-h-screen … flex items-center justify-center p-6`
with no allowance for the dashboard's fixed bottom tab bar. The app's own convention is in
`CheckoutShell.tsx:162`: `pb-[calc(96px+env(safe-area-inset-bottom,0px))]`. In the 390px capture the
teal "Go to Settings" button is reduced to a sliver above the tab bar and its label is unreadable —
the one action on the one screen a centre actually sees. It is reachable by scrolling, but not in the
at-rest view.

### D8 — P2. `bosta_shipments` does not exist

```
GET /rest/v1/bosta_shipments?select=*&limit=1
-> 404 {"code":"PGRST205","message":"Could not find the table 'public.bosta_shipments' in the schema cache"}
```

`loadCardOrderDetail.ts:72` queries it. Unlike D2 this call **is** error-guarded (line 73), so it
degrades to `null` rather than failing. Consequence: `bosta_estimated_delivery_at` and the admin
`bosta_shipment_status` / `_updated_at` / `bosta_shipping_cost` fields are permanently null. The
drawing's "Est. 08/07/2026" ETA row in §02 has no data source that can ever populate.

### D9 — P2. The park is one unguarded self-serve toggle deep

See §4. `card_orders_enabled` is writable by a centre owner through `/api/db` and is not in
`CENTERS_PROTECTED_COLUMNS`. Given NEW-MODEL parks card orders, the toggle should not be centre-reachable
while D1-D3 stand.

### D10 — P3. Stale doc references in shipped code comments

`CardOrdersTeaser.tsx` cites `BUILD-AFTER-REDESIGN.md` D7 — no such file exists under `design/`.
Both `CardOrdersTeaser.tsx` and `ComingSoon.tsx` cite `NEW-FEATURES.md` A3 — that file has no A3 row
and no card-orders row at all.

---

## 6. Divergences AGAINST THE DRAWING (stale design)

The file is internally in tension with NEW-MODEL: **§04 is current, §01-§03 are the stale half.** The
drawing still contains a complete ordering flow for a revenue stream NEW-MODEL marks *Parked*.

| # | Drawing | Live truth |
|---|---|---|
| S1 | §02/§03 add **"VAT (14%)"** as a line *on top of* an ex-VAT subtotal (900 + 50 + 133 + 20 = 1,103 — internally consistent, wrong model) | VAT is **inclusive** by locked rule and in code: `taxMath.ts` `baseFromInclusive = P/1.14`, `vatInside = P×0.14/1.14`. `review/page.tsx` renders a base+VAT *decomposition* then an inclusive subtotal. |
| S2 | **5 EGP per card** (§02 "120 × 5 = 600", §03 "180 × 5 = 900") | **60 EGP per card, VAT-inclusive** — `taxMath.ts:28`, `CARD_UNIT_BASE_EGP = 60 / 1.14`. Same 180-card basket to Cairo: 180×60 = 10,800 + 20 processing + 115 shipping = **10,935**, against the drawing's 1,103. |
| S3 | Flat **50** delivery | Governorate table in `platform_config.bosta_shipping_rates` — Cairo **115**, spread 115-165. |
| S4 | §03 step 4 offers an **"Instapay"** pill as the way to pay for a card order | NEW-MODEL: InstaPay is the parent→centre *tuition* rail; a card order is a platform invoice to the centre, and the stated exception is "whatever Paymob offers". Live issues a Paymob iframe only (`issueCardOrderIframePayment`). The InstaPay pill is stale and, per NEW-MODEL's own fee-collision warning, actively misleading. |
| S5 | **Three** card-colour swatches (teal / charcoal / brass) | **Two** styles throughout: `z.enum(['dark','light'])` in `api/card-order-cart/route.ts:18` and `validations.ts:337`; two buttons in `customize/page.tsx`; two labels in `review/page.tsx:168`; two branches in the PDF route. |
| S6 | §03 step 1 is a **quantity stepper** ("180 · matches active students") | Live is a **per-student cart**: `CardOrderCartContents`, `StudentPickerDrawer`, blank lines, save-for-later, `CartRecommendations`, `card_order_minimum_quantity = 1`. The drawing has **no frame at all** for the cart, which is the actual first screen of the flow. |
| S7 | Order numbers **`#THQ-2607`** | No order-number column on `card_orders`. Admin synthesises `ORD-001` positionally (`api/admin/card-orders/route.ts`); the payment step derives a short ref from the UUID tail. |
| S8 | §02 "Out for delivery — Est. 08/07/2026" | No feeder. Only source is `bosta_shipments.estimated_delivery_date`; table absent (D8). |
| S9 | §04 CTA **"Notify me when it launches"** + "We'll message you on WhatsApp." | Live CTA is **"Go to Settings"**; no sub-line. Deliberate — the notify write has no destination table. Consequence: the two `notified` frames are undrawable against this app. |
| S10 | §04 is a **dedicated screen**: back chevron, "Card orders" title bar, brass **lock badge**, a rotated (-4°) ID card with a teal header band, photo placeholder, "Grade 10 · #2043", a real QR block and a brass "STUDENT ID" wordmark | Live is a centred card inside the standard dashboard shell: no title bar, no lock badge, no rotation, no teal band, no photo, no grade/ID sub-line, and a lucide `QrCode` glyph in place of a QR block. **Copy matches the drawing word-for-word in both languages** — badge, title, description, all four features, sample name and ID badge (`messages/{en,ar}.json` → `orders.teaser`). |
| S11 | §01 Shipped/Delivered status badges and the three-dot track/reorder menu | **Unverifiable** — the hub is gated off. Not called either way. |

---

## 7. One-line summary

The live app shows a centre the parked **Coming Soon** screen on all 8 routes, in both languages, and
in that narrow sense agrees with NEW-MODEL. It agrees by accident of data, not by construction:
`card_orders_enabled` is a self-serve owner toggle, and behind it sit a checkout that 500s on every
submit, an order detail that 404s on every id, and an admin queue that 500s — all from one column,
`card_orders.card_style`, that six read paths and one write path reference and the database does not
have.
