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
