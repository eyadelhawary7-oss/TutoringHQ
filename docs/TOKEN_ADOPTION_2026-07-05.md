# Token Adoption — Phase 1 of the redesign

**Date:** 2026-07-05 (revised 2026-07-07 after syncing `master`)
**Branch:** `claude/token-adoption-phase-1-o12pp7`
**Source brief:** "Token Adoption (Phase 1)" — point hand-typed raw hex at the color
tokens that already exist. **Swap-the-source, not restyle. Nothing on screen may
change color.**
**Audit reference:** `docs/CODEBASE_AUDIT_2026-07-05.md` §D, finding #29.

---

## 0. Update after syncing master — dark mode is gone

The pilot analysis assumed two themes and restricted swaps to *theme-stable* tokens.
`master` has since merged **full dark-mode removal** (`docs/DARK_MODE_REMOVAL_2026-07-05.md`,
`#141`): `ThemeProvider`, `ThemeToggle`, `LoginThemeEffect` deleted; the
`html.dark { … }` overrides removed from `globals.css`; the `[data-chq-signup]` /
`[data-chq-session-expired]` dark-locks removed; nothing applies a `dark` class.

**There is now exactly one theme (cream).** Every token resolves to a single value,
so the theme-stability restriction is **dropped**: any token whose one value equals
a raw hex is a safe, pixel-identical swap. Parity remains **by construction**.

---

## 1. The golden rule (unchanged)

A raw hex is swapped **only when a token's value is byte-for-byte equal to it**.
Any hex with no exact token match is **drift** — listed here for the redesign phase,
never snapped to a "near" token. 8-digit alpha hex (`#1e293b80`, `#0D948820`) never
matches a solid token and stays as drift.

---

## 2. Hex → token map (full cream palette)

Source: `globals.css` `@theme` + `:root`. Where several tokens share one value the
canonical target is listed first; the value renders identically either way, so the
choice is by usage (bg/fill → surface/accent token; text → `text-*` token).

### Scales — also available in JS via `@/lib/tokens` `colors.<group>[step]`

| Hex | CSS var | Hex | CSS var | Hex | CSS var |
|---|---|---|---|---|---|
| `#f0fdfa` | brand-50  | `#f8fafc` | navy-50  | `#fffbeb` | gold-50  |
| `#ccfbf1` | brand-100 | `#f1f5f9` | navy-100 | `#fef3c7` | gold-100 |
| `#99f6e4` | brand-200 | `#e2e8f0` | navy-200 | `#fde68a` | gold-200 |
| `#5eead4` | brand-300 | `#cbd5e1` | navy-300 | `#fcd34d` | gold-300 |
| `#2dd4bf` | brand-400 | `#94a3b8` | navy-400 | `#fbbf24` | gold-400 |
| `#0D9488` | brand-500 | `#64748b` | navy-500 | `#F59E0B` | gold-500 |
| `#0f766e` | brand-600 | `#475569` | navy-600 | `#d97706` | gold-600 |
| `#115e59` | brand-700 | `#334155` | navy-700 | `#b45309` | gold-700 |
| `#134e4a` | brand-800 | `#1e293b` | navy-800 | `#92400e` | gold-800 |
| `#042f2e` | brand-900 | `#0f172a` | navy-900 | `#78350f` | gold-900 |
|           |           | `#080f1a` | navy-950 |           |          |

### Semantic tokens — CSS `var()` only (no correct JS mirror; see §5)

| Hex | CSS var | Hex | CSS var |
|---|---|---|---|
| `#ece8df` | surface-0 | `#1a6d4d` | success |
| `#fffdf8` | surface-1 (or text-inverse) | `#e4f0e9` | success-muted |
| `#f8f4ec` | surface-2 | `#8a5e16` | warning (or text-amber) |
| `#eceee9` | surface-3 | `#f4ebd7` | warning-muted |
| `#dcd7c9` | surface-4 | `#9c3322` | danger |
| `#0e6b61` | teal (or text-brand) | `#f4e5e2` | danger-muted |
| `#0a514a` | teal-deep | `#2563eb` | info |
| `#dfeeeb` | teal-soft | `#e3ecf6` | info-muted |
| `#9a6b1f` | brass | `#e9ebe7` | neutral-muted |
| `#f1e8d6` | brass-soft | `#5a605a` | neutral-ink |
| `#1b201d` | text-primary | `#80827a` | text-muted (or text-tertiary) |
| `#5d635c` | text-secondary | `#a6a79d` | text-disabled |
| `#e2ddd1` | border | `#ddd8cb` | ceo-chart-grid |

---

## 3. Conversion target by context

| Context | Target |
|---|---|
| Inline `style={{ … }}` on DOM elements, Tailwind arbitrary `bg-[#…]`/`text-[#…]`, CSS gradient strings | `var(--color-…)` (full map) |
| **Recharts SVG presentation props** (`stroke=`/`fill=`/`cursor`/`activeDot`) — CSS vars do **not** resolve in SVG presentation attributes (per `ChartTokens.ts`) | existing `CHART_STYLE.*` / `CHART_COLORS.*` constant (same value), else `colors.<scale>[…]` from `@/lib/tokens` |
| PWA `manifest.ts`, `<canvas>`, server JSON color data | `colors.<scale>[…]` from `@/lib/tokens` (scale values only) |

`var()` is only emitted where it actually resolves (DOM CSS). Recharts/manifest/
canvas use the JS mirror, matching the existing project convention.

---

## 4. Counts (merged tree, after pilot)

| Bucket | Occurrences | Files |
|---|---:|---:|
| **Exact-match — convertible** | **143** (130 scale, 13 semantic) | 41 |
| Drift — left for redesign (§6) | 152 (72 distinct) | — |
| Excluded (sources / PDF-email, §5) | — | 7 |
| Tailwind palette utilities — later pass (§7) | ~3,450 | ~180 |

Exact-match frequency: `#0d9488`×45 (brand-500), `#64748b`×15 (navy-500),
`#f59e0b`×14 (gold-500), `#94a3b8`×10 (navy-400), `#475569`×9 (navy-600),
`#f8fafc`×7, `#0f172a`×7, `#080f1a`×7, `#80827a`×6 (text-muted), `#dfeeeb`×5
(teal-soft), `#f1f5f9`×3, `#5eead4`×3, `#1e293b`×3, `#334155`×3, `#e2e8f0`×2,
`#2dd4bf`/`#0e6b61`/`#9a6b1f`/`#0f766e`×1.

---

## 5. Exclusions (do not touch)

- `src/app/globals.css` — CSS token source of truth.
- `src/lib/tokens.ts` — JS token source of truth (import *target*, never rewritten).
- `src/components/charts/ChartTokens.ts` — the chart palette's local source of truth
  (deliberate literals for SVG props). Chart *components* reference it.
- `src/lib/invoiceTemplates.ts`, `src/lib/generateInvoicePdf.ts`,
  `src/lib/generateOrderPdf.ts`, `src/lib/pdf/cardOrderReceiptTemplate.ts` — invoice/
  order/receipt PDF + email HTML (hardcoded hex on purpose, RTL-EXEMPT).

**Follow-ups noted, not done here (adoption-only scope):**
- `tokens.ts` `surface`/`state`/`text` groups still carry **old dark-era values**
  (`surface[0]='#080f1a'`, `text.primary='#f8fafc'`, `state.warning='#F59E0B'`) — they
  no longer match the cream CSS semantic tokens. Only `colors.brand/navy/gold` are
  used as swap targets here. The stale groups should be reconciled in the redesign.
- `ChartTokens.ts` scale values (`#0D9488`, `#F59E0B`, `#64748B`, `#1E293B`) duplicate
  global tokens; reconciling the two palettes is a redesign-infra task.

**Guardrail files** (billing / consent / summer / Paymob / WhatsApp send / auth
logic): only the color string is swapped, nothing else; on any doubt the hex is
skipped and reported.

---

## 6. Drift list — for the redesign phase (NOT converted)

152 occurrences, 72 distinct. Notable clusters (no cream token equals these):

| Hex | ~count | Note |
|---|---:|---|
| `#ffffff` / `#fff` / `#000000` / `#111` | ~31 | pure white/black — no token is pure #fff/#000 (surface-1 is `#fffdf8`, ink is `#1b201d`). Redesign call. |
| `#ef4444`, `#f87171`, `#b91c1c` | ~15 | reds — `--color-danger` is `#9c3322`, not a match. Chart/status reds diverge. |
| `#25d366`, `#075e54`, `#128c7e`, `#005c4b`, `#0b141a`, `#ece5dd`, `#667781` | ~13 | WhatsApp brand green + chat-bubble mock — **no token exists** (audit §D). |
| `#14b8a6`, `#34d399`, `#22c55e`, `#10b981` | ~13 | teal/emerald 400-ish greens — no cream match (`#10b981` is the stale `tokens.ts` success). |
| `#6b5d3a`, `#4a4030`, `#8f7322`, `#7a6019`, `#2e5a4c`, `#244a3e` | ~22 | landing/marketing custom brass & deep-teal shades — no token. |
| `#080d14`, `#0b0e17`, `#0a1628`, `#1c1f2e`, `#0e1018`, `#2f3347`, … | ~18 | landing near-navy darks that differ from `#080f1a`. |
| `#fbf9f4`, `#faf6ec`, `#faf8f3`, `#b2dfdb` | ~7 | cream/teal washes just off the surface tokens. |
| `#3b82f6`, `#6366f1`, `#8b5cf6` | ~7 | chart blue / indigo / violet — `--color-info` is `#2563eb`. |
| 8-digit alpha (`#1e293b80`, `#0D948820`) | several | token value + alpha; no solid token carries alpha. |

_(Full list reproducible via `scratchpad/analyze2.mjs`.)_

---

## 7. Tailwind palette-utility list — separate later pass (NOT converted)

`bg-teal-600`, `text-red-400`, `border-slate-700`, … remain out of scope: ~3,450
occurrences across ~180 files. Top: `bg-teal-600` (275), `text-teal-600` (136),
`bg-teal-700` (129), `text-slate-400` (103), `text-teal-400` (102). A utility→token
migration must be deliberate, not mechanical.

---

## 8. Batch plan (each = one commit; build + tests green before the next)

1. **Pilot — `features/`** ✅ done (11 swaps, `#080f1a`→navy-950).
2. **Charts** — chart components reference `CHART_STYLE`/`colors.*` for their raw hex
   (`MultiLineChart`, `AreaChart`, `DonutChart`, teacher chart views). `ChartTokens.ts`
   excluded as source.
3. **Landing/marketing** — `landing/AnimatedPhoneMockup`, `landing/HeroVisuals`,
   `compare/spreadsheets`, `blog`, `demo-request`.
4. **UI primitives & components** — `ui/Toast`, `ui/SuccessCheck`, `empty-states`,
   `QRCard`, `CardOrderStyleSampleMock`, `CardTemplatePreview`, `attendance/ScanTab`.
5. **Error/utility pages + manifest** — `not-found` (root + locale), `global-error`,
   `offline`, `layout`, `manifest.ts` (`colors.brand[500]`).
6. **Admin / CEO** — `(admin)/ceo-dashboard`, `admin/analytics`, `admin/centers`,
   `admin/finance`, `admin/platform-config` (color strings only).
7. **Settings / billing / payments / dashboard / students** — one at a time; billing
   & payments are guardrail-sensitive (color string only).
8. **Server routes** — `api/ceo/dashboard`, `api/admin/card-orders`, `vendorNotify`
   (scale values → `colors.*`; drift left).

---

## 9. Running log

### (a) Exact swaps done
- **Batch 1 — pilot `features/` (11):** all `#080f1a` → `var(--color-navy-950)`.
  Left drift `#0b141a`, `#005c4b` and the `#1024` student-ID text untouched.
- **Batch 2 — charts (20):**
  - `DonutChart.tsx` (6) — `DEFAULT_PALETTE` now references `CHART_COLORS.*`
    (teal/amber/purple/green/red/slate), the local chart source. SVG `<Cell fill>`
    can't resolve vars, so JS constants are correct here.
  - `MultiLineChart.tsx` (5) — DOM inline `#80827a`→`var(--color-text-muted)`;
    SVG cursor `#80827a`→`CHART_STYLE.axisColor`; navy values feeding SVG/props
    →`colors.navy[400|900]` from `@/lib/tokens`.
  - `AreaChart.tsx` (3) — same pattern (`var(--color-text-muted)`,
    `CHART_STYLE.axisColor`, `colors.navy[900]`).
  - `teacher/AnalyticsView` (2), `IncomeView` (1), `LockedAnalyticsPreview` (1),
    `LockedIncomePreview` (1) — `text-[#dfeeeb]` → `text-[var(--color-teal-soft)]`
    (the `/80` opacity variant renders identically via color-mix).
  - `(dashboard)/analytics/page.tsx` (1) — `#64748B` fallback → `colors.navy[500]`
    (already imported).
  - **Left (reported):** `teacher/IncomeLifetimeChart.tsx` `TEAL='#0e6b61'` /
    `BRASS='#9a6b1f'` — semantic values used in **SVG presentation attributes**
    (vars don't resolve) with **no JS mirror** in `tokens.ts`. Converting is
    impossible without either breaking the color (var in SVG) or adding new JS
    infra; left as-is for the redesign.

- **Batch 3 — landing/marketing (31):**
  - `landing/AnimatedPhoneMockup.tsx` (17) — 16 single-quoted `style` values →
    `var(--color-…)`; SVG `stroke="#94a3b8"` → `stroke={colors.navy[400]}`.
  - `landing/HeroVisuals.tsx` (7) — 5 `style` values → `var(--color-…)`; 2 SVG
    `stopColor="#0d9488"` → `{colors.brand[500]}`.
  - `compare/spreadsheets` (3), `blog` (2), `demo-request` (2) — `bg-[#080f1a]`/
    gradient/`text-[…]` → `var(--color-navy-950 | navy-50 | brand-500)`.
  - **Left (reported):** `HeroVisuals` traffic-dot array
    `['#ef4444','#f59e0b','#22c55e']` — a cohesive decorative window-control trio;
    only `#f59e0b` matches (gold-500). Splitting one out of the trio is a redesign
    call, so the whole array is left. All the `#…"` SVG-attribute drift
    (`#14b8a6`, `#34D399`) and WhatsApp-mock colors stay as drift.

- **Batch 4 — UI primitives/components (~18):**
  - `ui/Toast.tsx` — `COLORS` config uses `${color}15`/`${color}30` alpha
    concatenation, so `var()` would break it → `colors.brand/gold[500]`,
    `colors.navy[500|400]` (real hex strings). `#EF4444` error stays drift.
  - `ui/SuccessCheck.tsx` — `color` default (SVG stroke) → `colors.brand[500]`.
  - `empty-states/EmptyState.tsx` — `backgroundColor` → `var(--color-brand-500)`.
  - `QRCard.tsx` — gradient → `var(--color-brand-500|navy-800)`.
  - `CardOrderStyleSampleMock.tsx` — SVG `fill` vars → `colors.brand[500]`,
    `colors.navy[50|200|500|900]` (whites/`#0a1628` stay drift).
  - `CardTemplatePreview.tsx` — contrast helper `#0F172A`→`colors.navy[900]`;
    `color` default → `colors.brand[500]`; `text-[color:#0f172a]` →
    `text-[color:var(--color-navy-900)]`.
  - `attendance/ScanTab.tsx` — SVG `stroke` → `{colors.brand[500]}` (color only;
    no scanner logic touched).

- **Batch 5 — error/utility pages + manifest (~18):**
  - **Important:** `globals.css` is imported **only** in `[locale]/layout.tsx`.
    Root `not-found.tsx` and `global-error.tsx` (own `<html>`) render **without**
    it, so `var()` tokens would be undefined there → used `colors.*` (literal hex,
    no CSS dependency) instead. This is why they hardcoded hex originally.
  - `not-found.tsx` (root, 5) + `global-error.tsx` (4) — inline styles →
    `colors.navy[950|50|400]`, `colors.brand[500]`; `#fff`/`#ef4444` stay drift.
  - `[locale]/not-found.tsx` (2) — within `[locale]` (globals.css loaded) →
    `text-[var(--color-navy-50|brand-500)]`.
  - `[locale]/offline/page.tsx` (1) — SVG `stroke` → `{colors.gold[500]}`.
  - `[locale]/layout.tsx` (1) — viewport `themeColor` (metadata) → `colors.brand[500]`.
  - `manifest.ts` (1) — `theme_color` → `colors.brand[500]`; `background_color`
    `#080D14` stays drift (not `#080f1a`).

### (b) Drift left for the redesign
- See §6. Nothing snapped.

### (c) Tailwind utilities left for the later careful pass
- See §7. Nothing converted.

---

## 10. Verification

### Pilot (batch 1) — all green
Grep proof (11 `#080f1a` → 0, zero new raw hex), `next build`, 1147 unit tests,
typecheck, lint (0 errors), i18n/bidi/tolocale — all green. Parity by construction.

### Per-batch (repeat before each commit)
Grep proof of raw-hex drop + zero new raw hex; `next build`, unit suite, typecheck,
lint, i18n/bidi/tolocale all green. Authenticated screens can't be screenshotted in
this environment — parity is guaranteed by byte-equal token values, stated plainly.
