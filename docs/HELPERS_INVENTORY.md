# Helpers inventory (Prompts 1–7)

> Synced against the code on 2026-07-18. Every helper listed below was confirmed to exist in `src/lib/` (verified 2026-07-18).

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

## Locale routing (`buildLocaleHref` in `src/lib/locale/buildLocaleHref.ts`)

`buildLocaleHref(target, currentLocale)` (verified 2026-07-18) — build hrefs with the active locale prefix to avoid `/en/en/...` duplicates.

## Cairo time (`src/lib/cairo/`)

Verified helpers (2026-07-18): `startOfCairoDay`, `cairoDateKey`, `startOfUtcInstantForCairoCalendarDay` (`day.ts`); `startOfCairoWeek`, `startOfCairoWeekKey`, `getCairoWeekDays` (`week.ts`). Import from the Cairo calendar module used by attendance (grep `startOfCairo`). There is no `endOfCairoDay` export — that name in older notes is stale; use `startOfUtcInstantForCairoCalendarDay` / day-key helpers for day boundaries.

## Scanner

`normalizeStudentNumber`, `useNetworkStatus` — scanner queue + offline reconciliation.

## Auth / security

`requireCronSecret` (`src/lib/cron/requireCronSecret.ts`), webhook `verifyHmac` helpers (`src/lib/verifyHmac.ts`) — verified 2026-07-18. See also `src/app/api/**` and `docs/SECURITY_MAINTENANCE.md`.
