# Physical ID card design (CenterHQ)

## Styles A / B / C

- **A — Reserved** for a future premium tier (not exposed in UI today).
- **B — Dark** and **C — Light** are the only customer-selectable styles in signup / orders.
- Do **not** relabel B/C as A/B in product copy — audit finding locked as intentional.

## Vendor

- **Pixel Egypt** — manufacturing partner; artwork exports live in the internal design workspace (see ops drive).
- Base card economics reference **`docs/PRICING_SPEC.md`** for cascading tax and tier pricing.

## Shipping (Bosta)

- Courier fee is **additive reimbursement** on top of taxed card manufacture — **not** VAT-applied platform revenue (see master context “INTENTIONAL DESIGN DECISIONS”).
- Governorate rates are sourced from **`platform_config`** at runtime; admin finance views read the same table.

### Updating courier rates

1. Key: **`bosta_shipping_rates`** — JSON object mapping governorate **slug** → fee in **EGP** (same slugs as `src/lib/bostaShipping.ts`, e.g. `cairo`, `giza`, `alexandria`).
2. Update via SQL or admin tooling against `platform_config`; use `ON CONFLICT (key) DO UPDATE` when inserting so existing rows refresh.
3. When **Bosta** changes prices, adjust this JSON and deploy — the app falls back to built-in defaults if the key is missing or invalid (with a Sentry warning). Migration `20260509140000_bosta_shipping_rates_platform_config.sql` seeds the initial map.

## Layered source files

Design PSD / SVG paths are maintained outside this repo (marketing drive). Link the canonical folder in ops documentation when updated.
