# WhatsApp (Meta) templates — registry

Project rule: delivery uses Meta-approved templates only. Wire locations live next to WhatsApp send helpers (`src/lib/centerNotify.ts`, `src/lib/whatsapp/`) and admin tooling.

## Platform configuration

| Key | Purpose |
|-----|---------|
| `courier_name` | JSON string label for **`{{courier_name}}`** in **`chq_vendor_new_order`** (default **`Bosta`**). Seeded in migration `20260509180000_pack_requests_fulfillment.sql`. |

## Owner-facing catalog

- **`/[locale]/whatsapp`** — template library with **Preview** (sample variable substitution). Vendor templates are hidden from this view.
- **`chq_pin_delivery`** — registered with Meta but **not wired** in product UI beyond a **Coming soon** tile + mail **Notify me**. Documented below.

## Template checklist

| Template name | Category | Variables / notes | Wired | Trigger |
|---------------|----------|-------------------|-------|---------|
| `chq_vendor_new_order` | vendor | Body: order ref, quantity, notes, **`{{courier_name}}`** (4th). Quick-reply button index `0` with `READY_<orderId>`. | Yes — `sendVendorNewOrder` | Card order → `notifyVendorOfNewOrder` |
| `chq_pin_delivery` | auth | PIN / login code (see Meta). | **Registered only — unwired** | Target launch **after Vodafone postpaid SIM + SMS fallback** |
| *(others)* | various | See Meta Business Manager & `wa_meta_templates` | Partial | See codebase grep for `template_name` |

### `chq_vendor_new_order`

- Replace any hardcoded courier brand in Meta copy with **`{{courier_name}}`**.
- Code sends `[ref, quantity, notes, courierLabel]` in that order — **Meta parameter order must match**.
- Default courier label from **`platform_config.courier_name`** (`Bosta`).

### `chq_pin_delivery`

- **Status:** Registered with Meta; **no automated send path** in app yet.
- **Milestone:** Ship after **Vodafone SIM** rollout and SMS fallback for PIN delivery.
- **UI:** Owner surface shows a **Coming soon** tile with **Notify me** (`mailto:support@centerhq.com`).

## Physical pack fulfillment (`pack_requests`)

Tracks stages after a centre requests the parent pack kit:  
`pending_approval` → `approved` → `in_production` → `dispatched` → `in_transit` → `delivered` → `issued` (+ `cancelled`).  
Admin: **`/admin/whatsapp-pack`** timeline + **Next stage** action (`POST /api/admin/pack-fulfillment/[packRequestId]/advance`).

## Exceptions / audit notes

- **`chq_parent_welcome`** — May be APPROVED but intentionally not auto-sent on student approval until ops enables it.

Keep template **status** (`PENDING` / `APPROVED` / `REJECTED`) in sync with Meta review state via admin template sync.
