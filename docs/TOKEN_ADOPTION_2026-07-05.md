# Token Adoption — Phase 1 of the redesign

**Date:** 2026-07-05
**Branch:** `claude/token-adoption-phase-1-o12pp7`
**Source brief:** "Token Adoption (Phase 1)" — point hand-typed raw hex at the color
tokens that already exist. **Swap-the-source, not restyle. Nothing on screen may
change color.**
**Audit reference:** `docs/CODEBASE_AUDIT_2026-07-05.md` §D (redesign readiness),
finding #29.

---

## 1. The golden rule (how a hex qualifies)

A raw hex is swapped **only when a token's value is byte-for-byte equal to it**.
Exact value match ⇒ the rendered pixel is identical ⇒ appearance cannot change.
Any hex with no exact token match is **drift**: it is listed here for the redesign
phase to decide on purpose, never snapped to a "near" token.

### 1a. Theme-stability constraint (critical)

`globals.css` defines two kinds of color token:

- **Theme-stable** — defined once in `@theme` and **never overridden** in the
  `html.dark` block or any `[data-*]` lock. Their value is identical in light and
  dark. These are the **only safe swap targets.** They are exactly the three
  numeric scales: `--color-brand-*`, `--color-navy-*`, `--color-gold-*`.
- **Theme-dependent** — e.g. `--color-teal` (`#0e6b61` light / `#0d9488` dark),
  `--color-surface-*`, `--color-warning`, `--color-text-*`. Their value changes
  between themes. Pointing a raw hex at one of these **would change how it renders
  in one theme**, so they are **excluded as targets** in this pass even when a hex
  happens to match one theme's value. Always prefer the theme-stable scale token.

Because every swap target is theme-stable and byte-equal, **parity is by
construction**: no screenshot diff is possible or needed to prove it.

---

## 2. Hex → token map (exact-match, theme-stable only)

Two adoption targets depending on context (see §3):

| Raw hex (any case) | CSS var (JSX/inline/Tailwind) | JS value (`@/lib/tokens`) |
|---|---|---|
| `#f0fdfa` | `var(--color-brand-50)`  | `colors.brand[50]`  |
| `#ccfbf1` | `var(--color-brand-100)` | `colors.brand[100]` |
| `#99f6e4` | `var(--color-brand-200)` | `colors.brand[200]` |
| `#5eead4` | `var(--color-brand-300)` | `colors.brand[300]` |
| `#2dd4bf` | `var(--color-brand-400)` | `colors.brand[400]` |
| `#0D9488` | `var(--color-brand-500)` | `colors.brand[500]` |
| `#0f766e` | `var(--color-brand-600)` | `colors.brand[600]` |
| `#115e59` | `var(--color-brand-700)` | `colors.brand[700]` |
| `#134e4a` | `var(--color-brand-800)` | `colors.brand[800]` |
| `#042f2e` | `var(--color-brand-900)` | `colors.brand[900]` |
| `#f8fafc` | `var(--color-navy-50)`   | `colors.navy[50]`   |
| `#f1f5f9` | `var(--color-navy-100)`  | `colors.navy[100]`  |
| `#e2e8f0` | `var(--color-navy-200)`  | `colors.navy[200]`  |
| `#cbd5e1` | `var(--color-navy-300)`  | `colors.navy[300]`  |
| `#94a3b8` | `var(--color-navy-400)`  | `colors.navy[400]`  |
| `#64748b` | `var(--color-navy-500)`  | `colors.navy[500]`  |
| `#475569` | `var(--color-navy-600)`  | `colors.navy[600]`  |
| `#334155` | `var(--color-navy-700)`  | `colors.navy[700]`  |
| `#1e293b` | `var(--color-navy-800)`  | `colors.navy[800]`  |
| `#0f172a` | `var(--color-navy-900)`  | `colors.navy[900]`  |
| `#080f1a` | `var(--color-navy-950)`  | `colors.navy[950]`  |
| `#fffbeb` | `var(--color-gold-50)`   | `colors.gold[50]`   |
| `#fef3c7` | `var(--color-gold-100)`  | `colors.gold[100]`  |
| `#fde68a` | `var(--color-gold-200)`  | `colors.gold[200]`  |
| `#fcd34d` | `var(--color-gold-300)`  | `colors.gold[300]`  |
| `#fbbf24` | `var(--color-gold-400)`  | `colors.gold[400]`  |
| `#F59E0B` | `var(--color-gold-500)`  | `colors.gold[500]`  |
| `#d97706` | `var(--color-gold-600)`  | `colors.gold[600]`  |
| `#b45309` | `var(--color-gold-700)`  | `colors.gold[700]`  |
| `#92400e` | `var(--color-gold-800)`  | `colors.gold[800]`  |
| `#78350f` | `var(--color-gold-900)`  | `colors.gold[900]`  |

> 8-digit hex with an alpha suffix (e.g. `#1e293b80`, `#0D948820`) is **drift** —
> there is no solid token that carries the alpha, so it is never matched.

---

## 3. Two conversion targets (context decides)

| Context | Target | Why |
|---|---|---|
| Inline `style={{ … }}`, Tailwind arbitrary `bg-[#…]` / `text-[#…]`, CSS gradient strings, SVG `fill`/`stroke` in JSX | `var(--color-…)` | Rendered as CSS in the browser; `var()` resolves to the same static value. |
| Recharts props, `<canvas>`, PWA `manifest.ts` `theme_color`, and other JS values consumed outside CSS | `colors.…` imported from `@/lib/tokens` | `var()` is invalid in these contexts. `tokens.ts` is the sanctioned JS mirror (its own header: "Use ONLY when CSS variables are inaccessible: Recharts, canvas"). The literal it holds is byte-equal. |

`src/lib/tokens.ts` is the **JS source of truth** and is never rewritten by this
pass — it is the import *target* for the second row.

---

## 4. Counts

| Bucket | Occurrences | Files |
|---|---:|---:|
| **Exact-match — convertible this phase** | **212** | **42** |
| Drift — left for redesign (§6) | 177 (77 distinct values) | — |
| Excluded (source-of-truth / PDF-email, §5) | — | 5 |
| Tailwind palette utilities — separate later pass (§7) | 3,456 | 183 |

Exact-match frequency (top values):

```
#0d9488 ×59  -> brand-500      #1e293b ×10  -> navy-800
#080f1a ×23  -> navy-950       #334155  ×9  -> navy-700
#64748b ×21  -> navy-500       #5eead4  ×6  -> brand-300
#f8fafc ×21  -> navy-50        #f1f5f9  ×3  -> navy-100
#475569 ×19  -> navy-600       #e2e8f0  ×2  -> navy-200
#f59e0b ×14  -> gold-500       #2dd4bf  ×1  -> brand-400
#94a3b8 ×12  -> navy-400       #0f766e  ×1  -> brand-600
#0f172a ×11  -> navy-900
```

---

## 5. Exclusions (do not touch)

By project rule these keep their hardcoded hex; they are **not** in the 212 count:

- `src/lib/invoiceTemplates.ts` — invoice PDF/email HTML (RTL-EXEMPT).
- `src/lib/generateInvoicePdf.ts` — invoice PDF builder.
- `src/lib/generateOrderPdf.ts` — order PDF builder.
- `src/lib/pdf/cardOrderReceiptTemplate.ts` — receipt PDF HTML.
- `src/lib/tokens.ts` — the JS token source of truth (import target, never a consumer).
- `src/app/globals.css` — the CSS token source of truth.

**Guardrail files** (billing / consent / summer engine / Paymob / WhatsApp send /
auth **logic**): if such a file contains an exact-match hex, only the color string
is swapped, nothing else; if there is any doubt the hex is skipped and reported.

---

## 6. Drift list — for the redesign phase to decide (NOT converted)

77 distinct values, 177 occurrences. No theme-stable token equals these, so
snapping them would change appearance. Notable clusters:

| Hex | ~count | Note |
|---|---:|---|
| `#ffffff` / `#fff` / `#000000` | 29 | pure white/black — semantic surface/ink tokens exist but are theme-dependent; redesign call. |
| `#ef4444`, `#f87171`, `#b91c1c` | ~21 | reds — `--color-danger` is theme-dependent (`#9c3322` / `#ef4444`), not a stable match. |
| `#25d366`, `#075e54`, `#128c7e`, `#005c4b`, `#0b141a` | ~11 | WhatsApp brand green + chat-bubble mock — **no token exists** (audit §D flags adding one). |
| `#80827a` | 6 | chart axis/tick grey (`ChartTokens.ts`) — theme-dependent `--color-text-tertiary` only. |
| `#14b8a6`, `#34d399`, `#22c55e`, `#10b981` | ~13 | teal/emerald 400-ish greens — no stable scale match. |
| `#6b5d3a`, `#4a4030`, `#8f7322`, `#7a6019`, `#2e5a4c`, `#244a3e` | ~22 | signup/marketing brass & deep-teal custom shades — no token. |
| `#080d14`, `#0b0e17`, `#0a1628`, `#1c1f2e`, `#0e1018`, … | ~20 | signup/landing near-navy darks that differ from `#080f1a` — redesign should reconcile. |
| `#dfeeeb`, `#f1e8d6`, `#fbf9f4`, `#faf6ec`, `#b2dfdb` | ~11 | cream/teal-soft washes — theme-dependent surface/accent tokens only. |
| `#3b82f6`, `#6366f1`, `#8b5cf6` | ~7 | info blue / indigo / violet — theme-dependent `--color-info` only. |
| 8-digit alpha hex (`#1e293b80`, `#0D948820`, …) | several | token value + alpha; no solid token carries alpha. |

_(Full machine list reproducible via `scratchpad/analyze.mjs`.)_

---

## 7. Tailwind palette-utility list — separate later pass (NOT converted)

Palette utility classes (`bg-teal-600`, `text-red-400`, `border-slate-700`, …) are
a more careful pass and are **out of scope for phase 1**. Inventory: **3,456
occurrences across 183 files.** Top classes:

```
275 bg-teal-600     102 text-teal-400    81 text-red-600     49 text-teal-700
136 text-teal-600    98 text-red-400      75 border-teal-500  48 text-teal-300
129 bg-teal-700      90 text-slate-500    75 bg-teal-500      48 text-slate-600
103 text-slate-400   86 text-slate-900    70 ring-teal-500    47 border-slate-700
```

Note: `globals.css` already remaps several of these at runtime for the cream theme
(e.g. `bg-teal-600 → var(--color-teal)`, slate/white text remaps), which is why a
utility→token migration must be done deliberately, not mechanically.

---

## 8. Batch plan

Group by folder/area, each its own commit, `next build` + full tests green before
the next. **Hold for Eyad's review after the pilot, and again before final merge.**

1. **Pilot — `src/app/[locale]/features/` marketing pages** (3 files, `#080f1a`
   → `var(--color-navy-950)` via Tailwind-arbitrary + inline gradient string).
2. Charts — `src/components/charts/*` (`tokens.ts`-import path; validates the JS-value target).
3. UI primitives — `src/components/ui/*`, `src/components/empty-states/*`, `src/components/attendance/*`.
4. Landing/marketing — `src/components/landing/*`, `features` remainder, `blog`, `compare`, `demo-request`.
5. Error/utility pages — `not-found`, `global-error`, `offline`, `session-expired`, `accept-invite`, `layout`, `manifest.ts`.
6. Admin/CEO screens — `admin/*`, `(admin)/ceo-dashboard`, `ceo` (color strings only; skip anything touching logic).
7. Settings/billing/payments/dashboard/students — one at a time; billing & payments are guardrail-sensitive (color string only).
8. Server routes — `api/ceo/dashboard`, `api/admin/card-orders/*`, `vendorNotify.ts` — only if the hex is UI/CSS, not email HTML; otherwise report.
9. **Largest & most sensitive: `signup/SignupForm.tsx` (63)** — auth surface; color strings only, done last with extra care.

---

## 9. Running log

### (a) Exact swaps done
- **Pilot (batch 1) — `src/app/[locale]/features/` — 11 swaps, all `#080f1a` → `var(--color-navy-950)`:**
  - `features/qr-attendance/page.tsx` — 4 (3× `bg-[#…]`, 1× inline gradient string).
  - `features/student-management/page.tsx` — 3 (2× `bg-[#…]`, 1× inline gradient string).
  - `features/whatsapp-notifications/page.tsx` — 4 (3× `bg-[#…]`, 1× inline gradient string).
  - Left untouched in the same files (correctly): `#0b141a`, `#005c4b` (WhatsApp
    chat-bubble mock — drift), and `#1024` (student-ID text in a translation string,
    not a color).

### (b) Drift left for the redesign
- See §6. Nothing snapped.

### (c) Tailwind utilities left for the later careful pass
- See §7. Nothing converted.

---

## 10. Verification

### Pilot (batch 1) — all green
- **Grep proof:** the 11 `#080f1a` occurrences in `features/` → 0; net raw-hex in
  those files dropped by 11; **zero new raw hex** added (only `var(--color-navy-950)`
  references introduced). Global exact-match remaining: 212 → 201.
- **`next build`** — success (full route tree emitted, no errors).
- **Unit suite** — 1147 passed / 141 files.
- **typecheck** — clean (`tsc --noEmit`, no errors).
- **lint** — 0 errors (163 pre-existing warnings in test files, none from this diff).
- **i18n / bidi / tolocale** gates — OK (3834 t() keys, en/ar parity).
- **Parity is by construction:** `--color-navy-950` is `#080f1a` in both light and
  dark (theme-stable, `@theme`, never overridden), byte-equal to the hex it
  replaced ⇒ identical pixel. Authenticated screens cannot be screenshotted in this
  environment — stated plainly, not glossed.

### Per-batch (repeat before each subsequent commit)
- Grep proof of raw-hex drop + zero new raw hex added.
- `next build` green; unit suite green; typecheck, lint, i18n, bidi, tolocale green.
