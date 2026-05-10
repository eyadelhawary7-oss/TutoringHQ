# RTL and logical layout (CenterHQ)

The app serves both LTR (`/en/...`) and RTL (`/ar/...`) locales. Prefer **logical** CSS so spacing, alignment, and positioning follow `dir="rtl"` on `<html>` (see `src/app/[locale]/layout.tsx`).

## Tailwind / utility cheat sheet

| Physical (avoid in app UI) | Logical (preferred) |
|----------------------------|----------------------|
| `ml-*` / `mr-*` | `ms-*` / `me-*` |
| `pl-*` / `pr-*` | `ps-*` / `pe-*` |
| `left-*` / `right-*` | `start-*` / `end-*` |
| `inset-x-*` | `start-* end-*` (or `inset-inline-*` where available) |
| `text-left` / `text-right` | `text-start` / `text-end` |
| `rounded-l-*` / `rounded-r-*` | `rounded-s-*` / `rounded-e-*` |
| `rounded-tl-*` / `rounded-tr-*` (when meaning “inline start/end”) | `rounded-ts-*` / `rounded-te-*` |
| `border-l-*` / `border-r-*` | `border-s-*` / `border-e-*` |

## Inline styles (React)

| Physical | Logical |
|----------|---------|
| `marginLeft` / `marginRight` | `marginInlineStart` / `marginInlineEnd` |
| `paddingLeft` / `paddingRight` | `paddingInlineStart` / `paddingInlineEnd` |
| `left` / `right` | `insetInlineStart` / `insetInlineEnd` (or shorthand that maps to them) |

## Exempt cases (keep physical CSS; do not “fix” blindly)

1. **PDF / print pipelines** – Puppeteer `page.pdf({ margin: { top, right, bottom, left } })` only accepts physical keys. Invoice HTML for print/PDF often stays LTR for legal readability.
2. **Email / legacy HTML strings** – Many clients ignore logical properties; use physical layout plus `dir="rtl"` on Arabic templates when needed (`src/lib/invoiceTemplates.ts` and similar).
3. **Recharts** – `margin={{ left, right, ... }}` and axis `orientation="left" | "right"` are **library APIs** (physical). Document with `// RTL-EXEMPT` next to the prop.
4. **Third-party primitives** – Prefer shadcn/Radix defaults; don’t override internal positioning unless there is a documented bug.

## Motion tokens (globals)

`src/app/globals.css` defines RTL-aware custom properties:

- `--chq-slide-enter-tx` – small horizontal slide nudge (flipped on `html[dir="rtl"]`).
- `--chq-slide-dir` – `1` / `-1` for animations that need `translateX(calc(var(--chq-slide-dir) * …))`.

Shared keyframes such as `admin-orders-slide-panel` rely on these variables.

## How to test locally

1. Run `npm run dev`.
2. Open the same path under **`/en/...`** and **`/ar/...`** (e.g. orders checkout, admin centers, billing, scan).
3. Confirm: padding/margins mirror, table headings align to the start edge, sticky footers span the full width, drawers slide from the **inline-end** edge, and decorative scanner corners track the frame under RTL.

## Visual checklist (common RTL bugs)

- Text or numbers hugging the wrong edge (`text-start` / `tabular-nums` / `dir="ltr"` on IDs where needed).
- Asymmetric padding on cards, tables, or modals (`ps`/`pe` not `pl`/`pr`).
- Full-bleed bars using physical `left`/`right` instead of `start`/`end` or `inset-inline`.
- Icons that imply direction (chevrons, arrows): use `DirectionalIcon`, `rtl:rotate-180`, or mirror transforms—not hard-coded “always point east” layout.

## ESLint tightening (future)

A `no-restricted-syntax` rule on `className` strings for `ml-`, `mr-`, `text-left`, etc. was **deferred** until the tree is free enough of legacy patterns that CI noise stays low. Revisit after major UI churn.
