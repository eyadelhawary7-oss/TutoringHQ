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
| `chq_card_order_status_update` | card_orders | Body: **`{{order_id}}`**, **`{{status_label}}`**, **`{{centre_name}}`** — parameter order must match Meta registration. | Yes — `sendCardOrderStatusUpdate` | Fallback when no dedicated template for `status` |
| `chq_card_order_paid` | card_orders | **`{{order_id}}`**, **`{{centre_name}}`** | Yes | `status` → `paid` |
| `chq_card_order_in_production` | card_orders | Same pair | Yes | `status` → `in_production` |
| `chq_card_order_in_transit` | card_orders | Same pair | Yes | `status` → `in_transit` |
| `chq_card_order_delivered` | card_orders | Same pair | Yes | `status` → `delivered` |
| `chq_card_order_cancelled` | card_orders | Same pair | Yes | `status` → `cancelled` |
| `chq_vendor_new_order` | vendor | Body: order ref, quantity, notes, **`{{courier_name}}`** (4th). Quick-reply button index `0` with `READY_<orderId>`. | Yes — `sendVendorNewOrder` | Card order → `notifyVendorOfNewOrder` |
| `chq_pin_delivery` | auth | PIN / login code (see Meta). | **Registered only — unwired** | Target launch **after Vodafone postpaid SIM + SMS fallback** |
| *(others)* | various | See Meta Business Manager & `wa_meta_templates` | Partial | See codebase grep for `template_name` |

**`chq_card_order_refunded` — DEPRECATED.** Do **not** register on Meta. Card orders are non-refundable; refunds are not offered. Legacy `wa_meta_templates` rows (e.g. `PENDING`) are harmless and may be deleted manually via SQL.

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

## Subscription renewal reminders (future Meta templates)

Today `/api/cron/renewal-reminders` sends **freeform** WhatsApp copy for centres with `next_payment_due` in **7 days** or **1 day** — not Meta templates.

If product moves to approved templates, register these names in Meta and seed **`wa_meta_templates`** before switching sends:

| Template name | Intended use |
|---------------|----------------|
| `chq_payment_reminder` | T-7, T-3 before due |
| `chq_payment_due_today` | T+0 |
| `chq_payment_overdue` | T+1, T+3, T+7 after due (grace window) |
| `chq_subscription_suspended` | After grace + suspension |
| `chq_payment_received` | Successful renewal (partial overlap with existing `chq_payment_confirmed`) |

Until approved, keep renewal-reminders on freeform text or rely on `sendChqRenewalOverdueTemplate` (`chq_renewal_overdue`) from `subscriptionBillingCron`.

## Card order status templates — registration checklist

Templates seeded as **PENDING** in `wa_meta_templates` that need Meta-side registration:

| Template name | Variables (body parameters) |
|---------------|----------------------------|
| `chq_card_order_paid` | `order_id`, `centre_name` |
| `chq_card_order_in_production` | `order_id`, `centre_name` |
| `chq_card_order_in_transit` | `order_id`, `centre_name`, `tracking_number` |
| `chq_card_order_delivered` | `order_id`, `centre_name` |
| `chq_card_order_cancelled` | `order_id`, `centre_name`, `reason` |

**Deprecated (do not register):** `chq_card_order_refunded` — refunds are not offered on card orders. If a seed row exists as `PENDING` in `wa_meta_templates`, leave it or delete manually; do not submit for Meta approval.

### Process

1. Log in to **Meta Business Manager** → **WhatsApp Manager**.
2. Open **Templates** → **Create template**.
3. For each template above: choose category **UTILITY**, add **Arabic** and **English** languages, and paste the body text matching the seed row in `wa_meta_templates` (parameter order must match Meta).
4. **Submit for review** (Meta typically responds within 24–48 hours).
5. After Meta marks a template **APPROVED**, flip the DB row:

   ```sql
   UPDATE public.wa_meta_templates SET status = 'APPROVED' WHERE template_name = 'chq_card_order_paid';
   ```

   Run one `UPDATE` per template name.

6. Re-test by changing status on a **test** `card_order` — `webhook_outbox` should drain successfully.

Until templates are **APPROVED** in the database, `sendCardOrderStatusUpdate` falls back gracefully (logs to Sentry but does not throw).

## Billing nudges / dunning (unified center + teacher)

The unified nudge engine (`src/lib/nudges/`, cron `/api/cron/billing-nudges`, banner
`/api/billing/nudge-status` + `src/components/billing/NudgeBanner.tsx`) drives both the
in-app banner and the WhatsApp reminders for centers AND teachers off the shared
`invoices` + subscription tables. See `docs/BILLING_NUDGES.md` for the full design.

**Template config is one place:** `src/lib/nudges/config.ts` (`NUDGE_TEMPLATES`). The
WhatsApp channel is gated by `NUDGE_WHATSAPP_ENABLED` (env) **and** Meta approval
(`wa_meta_templates.status === 'APPROVED'`, checked via `isTemplateApproved`). Until both
are true every due nudge is recorded `disabled` and only the in-app banner shows — the
banner never depends on WhatsApp.

### New templates to submit to Meta — **category UTILITY** (NOT Marketing)

All Arabic (EGY), Arabic comma U+060C where punctuation is needed. Body parameters are
positional `{{1}}…`, sent in the order shown (see `src/lib/nudges/messages.ts`).

| Template name | Category | Params (in order) | Used for |
|---------------|----------|-------------------|----------|
| `chq_nudge_prebill` | **UTILITY** | `{{1}}` name, `{{2}}` amount, `{{3}}` days, `{{4}}` pay link | Pre-billing reminder T-3 and T-1 (manual-pay owners) |
| `chq_nudge_due_today` | **UTILITY** | `{{1}}` name, `{{2}}` amount, `{{3}}` pay link | Billing day, still unpaid — due today / one-day grace |
| `chq_nudge_locked` | **UTILITY** | `{{1}}` name, `{{2}}` amount, `{{3}}` pay link | After lock — pay to restore (center summary / teacher free-tier) |
| `chq_nudge_card_expiry` | **UTILITY** | `{{1}}` name, `{{2}}` last4, `{{3}}` MM/YY, `{{4}}` update link | Saved card expires before next billing (T-30, T-7) |

Suggested Arabic bodies (final wording is set on Meta; keep variable order):

- **`chq_nudge_prebill`** — `مرحبًا {{1}}، اشتراكك هيتجدد خلال {{3}} يوم والمبلغ المستحق {{2}}. ادفع دلوقتي للحفاظ على استمرارية الخدمة: {{4}}`
- **`chq_nudge_due_today`** — `{{1}}، النهارده آخر يوم لدفع {{2}}. ادفع دلوقتي قبل ما يتقيّد الوصول بكره: {{3}}`
- **`chq_nudge_locked`** — `{{1}}، تم تقييد الوصول لعدم سداد {{2}}. ادفع دلوقتي لاستعادة الوصول الكامل: {{3}}`
- **`chq_nudge_card_expiry`** — `{{1}}، الكارت المحفوظ المنتهي بـ {{2}} هينتهي {{3}}. حدّث الكارت لتجنّب أي انقطاع: {{4}}`

### Recategorize (Marketing → Utility)

⚠️ **`chq_renewal_reminder`** is currently **MARKETING** in `wa_meta_templates`. It is a
billing/transactional message — Marketing category risks silent non-delivery. Recategorize
to **Utility** on Meta (the legacy freeform renewal-reminders cron that used it is retired,
but the registry row should still be corrected). Audit any other billing-related templates
for the same issue.
