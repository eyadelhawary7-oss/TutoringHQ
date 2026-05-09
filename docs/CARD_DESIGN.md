# Card design — owner-facing QR card orders

## Style labels (B / C)

**Option A** is **reserved for a future visual preset** and is **not** exposed in the order UI today.

**Active presets:**

| Label in UI | Internal `card_style` | Description |
|-------------|----------------------|-------------|
| Option **B** | `dark` | Dark navy + teal accent (default “premium dark”). |
| Option **C** | `light` | White / light face + teal accent. |

Eyad confirmed **B/C labelling is intentional** (Option A deliberately omitted until a third preset ships).

See also: route-based **checkout** (`/orders/checkout/...`), `CardOrderStyleSampleMock`, `CardTemplatePreview`, `generateOrderPdf`, admin PDF route.

## Cart workflow

Centres keep **at most one open cart** per centre (`card_order_carts` with `status = 'open'`), enforced by partial unique index `card_order_carts_one_open_per_center`. Line items live in `card_order_cart_items` (`kind` `student` or `blank`; student lines always `quantity = 1`; blanks allow `quantity > 0`). Duplicate student lines in the same cart are prevented by `card_order_cart_items_unique_student`. A trigger on `card_order_cart_items` bumps the parent cart’s `updated_at` and `version` on insert/update/delete for concurrency hints in the UI.

**Platform config**

- `card_order_minimum_quantity` — minimum active cards before checkout (default `1` from migration seed).
- `card_order_cart_idle_days` — days after last `updated_at` before an open cart may be auto-abandoned (default `30`).

**Stale items**

Student rows whose student no longer belongs to the centre (deleted or transferred) are returned from the API with `stale: true` until purged. `GET /api/card-order-cart` triggers cleanup so orphaned rows are removed server-side before the response.

**Abandonment cron**

Vercel Cron calls `GET /api/cron/abandon-stale-carts` daily at **04:00 UTC** (06:00 Cairo). It reads `card_order_cart_idle_days` and sets `status = 'abandoned'` and `abandoned_at = now()` on open carts older than that threshold.

**Entry points**

- Orders nav / mobile bar: cart badge and preview → `/orders`.
- `/orders`: cart-first layout, student picker drawer, blanks modal.
- `/students` roster: bulk select → “Add to card cart”.
- `/students/[id]`: single **Order card** action when the student has no delivered card yet.

## Checkout flow (route-based)

Dedicated URLs per step (browser back/forward and deep links work). All steps except **Pay** and **Success** require an **open** cart with active quantity ≥ platform minimum; otherwise the user is redirected to `/orders` with a toast (`checkout_error` query).

| Step | Path | Purpose |
|------|------|--------|
| 1 Delivery | `/[locale]/orders/checkout` | Governorate, address, Egyptian mobile, optional delivery notes; shipping preview via Bosta rates; optional “save defaults” updates `centers`. |
| 2 Customize | `/[locale]/orders/checkout/customize` | Card style (`dark` / `light`), optional vendor notes; optional “remember style” updates `centers.last_card_style`. |
| 3 Review | `/[locale]/orders/checkout/review` | Summary, Egyptian legal pricing lines (`buildLegalInvoiceLines`), terms checkbox, `POST /api/card-order-cart/checkout`. |
| 4 Pay | `/[locale]/orders/checkout/payment` | Paymob iframe; poll `GET /api/orders/[orderId]` until `payment_status === paid`. |
| 5 Success | `/[locale]/orders/checkout/success/[orderId]` | Confirmation, receipt download, track order → `/orders/[orderId]`. |

Between steps the client **`PATCH /api/card-order-cart`** so cart row state survives refresh and back navigation. After step 3 the cart is marked **`submitted`** and linked to the new `card_orders` row.

## Order State Machine

`card_orders` carries **three independent columns** that must stay audit-consistent:

| Column | Meaning |
|--------|---------|
| `status` | **Canonical lifecycle for UI** — where the physical/digital fulfilment is in the pipeline. |
| `payment_status` | Money **in** (Paymob / unpaid / failed). Never shown directly in centre UI; kept for finance and chargebacks. |
| `refund_status` | Money **back out** (`NULL` until a refund path exists, then `pending` → `approved` \| `rejected` → `paid`). Never shown as raw columns to owners except contextual refund copy on cancelled orders. |

**Rule:** Every lifecycle write updates the triple **atomically** (single transaction / single `UPDATE`). Centre-facing surfaces read **`status` only** for progress (see `CardOrderStatusTimeline`). Use **`applyCardOrderTransition`** in `src/lib/cardOrderState.ts` — direct `UPDATE card_orders SET status = …` outside the helper is forbidden for production lifecycle paths.

### Event → (`status`, `payment_status`, `refund_status`)

| Event | `status` | `payment_status` | `refund_status` |
|-------|----------|------------------|-----------------|
| Cart submitted / Paymob pending | `pending_payment` | `unpaid` | `NULL` |
| Paymob success | `paid` | `paid` | `NULL` |
| Vendor assigned | `vendor_assigned` | `paid` | `NULL` |
| In production | `in_production` | `paid` | `NULL` |
| Ready for pickup | `ready_for_pickup` | `paid` | `NULL` |
| Bosta picked up | `in_transit` | `paid` | `NULL` |
| Bosta delivered | `delivered` | `paid` | `NULL` |
| Centre confirms cards in hand | `issued` | `paid` | `NULL` |
| Paymob declined | `failed` | `failed` | `NULL` |
| Cancelled before payment | `cancelled` | `unpaid` | `NULL` |
| Cancelled after payment (refund TBD) | `cancelled` | `paid` | `pending` |
| Refund approved (admin) | `cancelled` | `paid` | `approved` |
| Refund paid out | `refunded` | `paid` | `paid` |
| Refund rejected | `cancelled` | `paid` | `rejected` |

Row-level history: `card_order_status_transitions` (trigger on `status` changes); actor metadata is enriched post-insert when transitions go through the helper.

## Receipt PDF

- Generated server-side via `generateCardOrderReceiptPdf` → HTML from `src/lib/pdf/cardOrderReceiptTemplate.ts` → existing Puppeteer pipeline in `src/lib/generateInvoicePdf.ts`.
- **Delivery lines** (governorate, street address, phone, notes) come from **`card_orders` at submission** — they are the legal snapshot of what was paid for.
- **Centre display name / profile address** may still come from the live `centers` row until a dedicated billing snapshot column exists; delivery fields on the order remain authoritative for shipment.
- Pricing uses **`buildLegalInvoiceLines`** (subtotal → service → stamp → VAT → total) for the card product; shipping is listed separately; grand total matches `total_amount`.
- Footer / compliance: tax registration string from **`platform_config.ehg_tax_registration`** (placeholder until finance confirms).
- If **`refund_status` is non-null**, the PDF includes a short refund block (status, optional payout date, amount).
- **`GET /api/orders/[orderId]/receipt`** returns **422** while `status` is `pending_payment` or `failed`; successful PDF filename pattern **`centerhq-order-<LAST8>.pdf`**.
