# EH Group — Master Context v24

> STALE IN-REPO COPY (v24). Re-synced 2026-07-18. This is an out-of-date snapshot of the owner's master-context file; the current canonical version (v46) is maintained in Eyad's Claude.ai project, outside this repository. Do not treat the numbered narrative below as current. Load-bearing live corrections are inline-tagged (verified live 2026-07-18); the intentional-design decisions are preserved as a record. Note: "quarterly" pricing/billing referenced in several decisions below is DEAD — `centers.billing_period` now CHECKs IN ('monthly','annual') only, quarterly removed (verified live 2026-07-18).

## Build state

- **Latest commit:** post–Prompt 7 stabilization merge (see `git log -1`).
- **Routes:** Next.js App Router — full surface documented in technical reference.
- **Tables:** ~89 applied migrations + `pending_signups` where deployed → **90** logical entities including pending signup staging. **[STALE: the live public schema now has 142 base tables (all RLS-enabled), 2 views, and 141 functions, counted live 2026-07-18.]**

## Environment / schema deltas (audit)

- New or emphasized secrets: WhatsApp, Bosta, Paymob webhooks, cron bearer, backup drive IDs — see `docs/LAUNCH_CHECKLIST.md`.
- Notable columns: `centers.is_test`, governorate fields, `card_orders.card_style`, pricing overrides for Top Centers.

## Audit summary

~316 findings across Cowork sessions → resolved in a **7-prompt** remediation chain (Prompts 1–7). Coverage target: **14 / 14** sessions complete including **Session 13 (RTL)** and **Session 14 (375px mobile)** executed via automated checks + manual verification notes.

## Helper inventory

See [`docs/HELPERS_INVENTORY.md`](./HELPERS_INVENTORY.md).

## INTENTIONAL DESIGN DECISIONS (do not “fix” without product approval)

1. Card style labels: only **B (Dark)** and **C (Light)** exposed; **A** reserved — do not rename tiers.
2. Quarterly tab **+15% / −15%** on signup is marketing shorthand; billed amounts use `.99` endings — totals may not equal exact 1.15× / 0.85× math.
3. **Nano Monthly** intentionally **+25%** vs Quarterly to push quarterly commitment — do not normalize Nano monthly to `2,299`.
4. **Enterprise** is fixed-price (`18,499` EGP/mo quarterly baseline). **Top Centers** is the only negotiable tier; `centers.all_in_price` is authoritative — code must throw + Sentry if NULL when resolving Top Centers.
5. **`chq_parent_welcome`** WhatsApp template is approved but **not auto-wired** to approvals — send manually until ops enables automation.
6. **`chq_pin_delivery`** is **stub** until Vodafone SIM + SMS fallback — no live PIN blast tests pre-SIM.
7. **2099-12-31** tombstone dates on legacy test rows — filtered via `is_test`; do not blanket backfill.
8. **`/api/admin/check`** reflects JWT-derived admin scope only — **never** trust caller-supplied `center_id` headers for privilege.
9. Card order **shipping** sits **above** cascading tax — Bosta fees are reimbursement, not VAT-inclusive revenue.
10. **Egyptian consumer invoice order of lines** — VAT last on customer PDFs; internal admin “strip from inclusive” views stay separate.
11. Signup stays **3 steps** — step 3 payment summary **is** the review step; no fourth review screen.
12. **`/admin/finance`** is the in-app finance command centre — external BI (Metabase / etc.) rejected.

## WHAT CLAUDE SHOULD NEVER DO (additions)

- Replace logical Tailwind (`ms-`, `ps-`, `start-`) with physical `left`/`right` in authenticated UI (PDF generators exempt).
- Ship raw `.toLocaleString` outside `formatNumber.ts` (lint blocks).
- Introduce a fourth signup step or relabel card styles A/B/C against the decisions above.

## Final audit disposition

Tracker migrated to **v4** (see `docs/tracker_disposition_v4.md`): session coverage badges + final lock timestamp when Eyad closes Cowork import.
