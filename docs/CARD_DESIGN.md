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

## Layered source files

Design PSD / SVG paths are maintained outside this repo (marketing drive). Link the canonical folder in ops documentation when updated.
