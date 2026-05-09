# Helpers inventory (Prompts 1–7)

Central utilities live under `src/lib/`. Prefer these instead of ad-hoc `Intl` or Cairo logic.

## Formatting (`src/lib/formatNumber.ts`)

| Helper | Example |
|--------|---------|
| `formatNumber(n, locale, opts?)` | Thousands grouping via locale rules |
| `formatGrowth(cur, prev, locale)` | Signed delta chip for KPI cards |
| `formatCurrency(n, locale)` | Egyptian pound display (see currency suffix rules for AR) |
| `formatPercent(n, locale)` | Percent without raw `toLocaleString` |
| `formatDate(d, locale, variant)` | Calendar vs time variants |

Charts must route tick/tooltip formatters through these helpers — enforced by `scripts/check-no-tolocalestring.ts`.

## Pricing (`src/lib/pricing.ts`, `src/lib/pricing/plans.ts`)

| Helper | Example |
|--------|---------|
| `getPlanPrice`, `getSignupDisplayMonthlyPrice` | Signup display alignment |
| `ORDERED_SUBSCRIPTION_PLAN_KEYS` | Iterate fixed tiers in UI |

## Locale routing (`src/i18n/routing` or `buildLocaleHref` if present)

Build hrefs with the active locale prefix to avoid `/en/en/...` duplicates.

## Cairo time

Helpers such as `startOfCairoWeek`, `getCairoWeekDays`, `startOfCairoDay`, `endOfCairoDay` — import from the Cairo calendar module used by attendance (grep `startOfCairo`).

## Scanner

`normalizeStudentNumber`, `useNetworkStatus` — scanner queue + offline reconciliation.

## Auth / security

`requireCronSecret`, webhook `verifyHmac` helpers — see `src/app/api/**` and `docs/SECURITY_MAINTENANCE.md`.
