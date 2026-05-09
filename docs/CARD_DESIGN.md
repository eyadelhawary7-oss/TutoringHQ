# Card design — owner-facing QR card orders

## Style labels (B / C)

**Option A** is **reserved for a future visual preset** and is **not** exposed in the order UI today.

**Active presets:**

| Label in UI | Internal `card_style` | Description |
|-------------|----------------------|-------------|
| Option **B** | `dark` | Dark navy + teal accent (default “premium dark”). |
| Option **C** | `light` | White / light face + teal accent. |

Eyad confirmed **B/C labelling is intentional** (Option A deliberately omitted until a third preset ships).

See also: `CardOrderModal`, `CardTemplatePreview`, `generateOrderPdf`, admin PDF route.

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
