# Dead Code Removed — 2026-07-05 (Cleanup Step 1)

Source of truth: `docs/CODEBASE_AUDIT_2026-07-05.md`. This build removes only files the audit proved unreferenced. **No behavior of any surviving screen changes.** No dependencies removed, no schema/DB work, no snapshot regen.

**Branch:** `claude/codebase-audit-findings-n04vgu` · **Held for review — no PR.**

## Proof method (applied to every file before deletion)

1. `knip` static analysis flagged the file as unused.
2. Whole-repo grep for the module's **import path** (`@/…/Name`, relative `./Name`, dynamic `import()`, `lazy()`, `require`), across `src`, `scripts`, `tests`, `docs`, config, and `CLAUDE.md`.
3. Any same-basename hit was resolved to its actual target directory to rule out false positives (e.g. root `ThemeToggle` vs the live `ui/ThemeToggle`).
4. A file was deleted only when it had **zero** real importers.

After deletion: `tsc --noEmit` clean, full unit suite green (1147), i18n/bidi/tolocale gates green, `next build` succeeds.

---

## Batch A — invisible dead code (42 files, 4 commits, SAFE)

### Commit 1 — superseded dashboard chart components (11)
Replaced by `src/components/analytics/*`; zero importers.

```
src/components/dashboard/AttendanceAreaChart.tsx
src/components/dashboard/AttendanceCard.tsx
src/components/dashboard/AttendanceRing.tsx
src/components/dashboard/AttendanceTrend.tsx
src/components/dashboard/PaymentBar.tsx
src/components/dashboard/PaymentDonut.tsx
src/components/dashboard/PaymentMethodsDonut.tsx
src/components/dashboard/RevenueBar.tsx
src/components/dashboard/RevenueSparkline.tsx
src/components/dashboard/RevenueStackedChart.tsx
src/components/dashboard/UnpaidList.tsx
```
*(Live files `InactiveList.tsx`, `PlanUsageCard.tsx` remain in the folder.)*

### Commit 2 — legacy onboarding flow (8)
The `/onboarding` page is self-contained (imports `SummerFirstInvoiceCard` + its own logic); it does not use any of these. Zero importers; the whole `src/components/onboarding/` directory is now gone.

```
src/components/onboarding/AnimatedCounter.tsx
src/components/onboarding/CompletionScreen.tsx
src/components/onboarding/Confetti.tsx
src/components/onboarding/WhatsAppConfirmation.tsx
src/components/onboarding/steps/Step1Profile.tsx
src/components/onboarding/steps/Step2Students.tsx
src/components/onboarding/steps/Step3QR.tsx
src/components/onboarding/steps/Step4Scanner.tsx
```

### Commit 3 — dead lib and type modules (6)
```
src/lib/metricsAggregator.ts        # zero importers
src/lib/number-utils.ts             # zero importers
src/lib/plan-tiers.ts               # @deprecated re-export shim of @/lib/pricing; zero importers
src/lib/analytics/healthScore.ts    # zero importers
src/types/billing.ts                # zero import-path references (@/types/billing)
src/types/invoice.ts                # zero import-path references (@/types/invoice)
```

### Commit 4 — duplicate & orphaned components (17)
```
src/components/AddStudentModal.tsx           # stale dup; live one is teacher/(portal)/groups/[groupId]/AddStudentModal.tsx
src/components/ThemeToggle.tsx               # stale dup; live one is ui/ThemeToggle.tsx (16 importers)
src/components/shell/Sidebar.tsx             # stale dup; live one is components/Sidebar.tsx
src/contexts/ThemeContext.tsx               # replaced by components/ThemeProvider.tsx
src/components/ColumnMapper.tsx
src/components/FileUploadZone.tsx
src/components/StepIndicator.tsx
src/components/SyncIndicator.tsx
src/components/landing/PricingBanner.tsx
src/components/ui/FormField.tsx
src/components/ui/skeleton.tsx               # not re-exported by ui/index.ts
src/components/billing/PastDueBanner.tsx     # unused UI banner; not imported by any live billing flow
src/components/charts/MRRTrend.tsx           # not re-exported by charts/index.ts
src/components/skeletons/DashboardStatsSkeleton.tsx
src/components/skeletons/PaymentRowSkeleton.tsx
src/components/skeletons/ScannerSkeleton.tsx
src/components/skeletons/StudentListSkeleton.tsx
```

---

## Batch B — the three confirmed fake pages

### `/sentry-test` — **DELETED**
`src/app/[locale]/sentry-test/page.tsx` (diagnostic page that throws on purpose). No internal links anywhere (verified). *Note: the `sentryTest` i18n keys in `messages/{en,ar}.json` were left in place — orphaned keys don't break the i18n parity gate; removing translation keys was out of scope for a source-file deletion build.*

### `/financial-intelligence` — **CONVERTED TO REDIRECT (not deleted)**
`src/app/[locale]/(dashboard)/financial-intelligence/page.tsx` was a one-line re-export of `/analytics`. It now server-redirects to `/{locale}/analytics`, so old bookmarks keep working instead of 404-ing. No internal links pointed at it.
- **Implementation note:** used `redirect()` (307) to match the repo's 9 existing legacy redirect stubs (`/invoices`, `/admin/dashboard`, `/admin/card-orders`, …) verbatim — consistency over introducing a lone `permanentRedirect()` (308). If you want true "permanent" 308 semantics for SEO, swap `redirect` → `permanentRedirect`; it's a one-word change.

### `/admin/sales-pipeline` — **FULLY RETIRED** (follow-up build, 2026-07-05)
Initially paused because it was linked from the nav and the tab-redirect map. Now removed completely, with every reference cleaned up so no dead link remains:
- **Page deleted:** `src/app/[locale]/admin/sales-pipeline/page.tsx`.
- **`src/components/AdminSidebar.tsx`** — removed the nav entry (`key/icon/label/isActive/canShow/href`), the `'salesPipeline'` union-type member, the `isSalesPipeline` active-route const, its operand in the `onDedicatedAdminSubpage` OR-chain, and the now-unused `Target` icon import. Nothing else in the file changed.
- **`src/app/[locale]/admin/page.tsx`** — removed the 4 tab aliases (`salesPipeline`, `salespipeline`, `sales-pipeline`, `sales_pipeline`). Every other tab route in the map is untouched and still resolves.
- **Verified:** repo grep for `sales-pipeline` returns **zero code references** (only historical mentions remain in `docs/`).

**Intentionally left (auth guardrail #1):** the `sales_pipeline` *permission key* in `src/lib/admin-roles.ts` (role arrays + label). That file is the admin auth/permissions surface — out of scope for this build. The key is now a harmless orphan (no nav renders it); removing it belongs in the auth-focused careful step alongside `admin-check.ts`.

---

## Intentionally NOT touched (deferred to later careful steps)

| Item | Why deferred |
|---|---|
| `src/lib/admin-check.ts` | Explicitly excluded by the brief — name touches auth; own careful step later. (Confirmed still dead: 0 importers.) |
| `src/lib/savedCard/index.ts` | Proven-dead barrel, **but it lives inside the live Paymob + consent + billing `savedCard/` module** (siblings imported by the Paymob webhook, autocharge cron, and consent route). HARD-guardrail zone — defer to a careful step. |
| `sentryTest` i18n keys | Translation keys, not a source file; leaving them is parity-safe. Optional later cleanup. |
| `sales_pipeline` permission key (`src/lib/admin-roles.ts`) | Auth/permissions surface (guardrail #1). Orphaned but harmless; remove in the auth careful step. |

## Unused dependencies — left for a separate build (per brief guardrail #4)

The audit flagged these as having no static references. **Not removed here** — a dependency can be used at runtime in ways static scans miss, and dependency removal is its own build.

| Dependency | Note |
|---|---|
| `@anthropic-ai/sdk` | 0 code references. |
| `jspdf` | 0 code references (PDF generation uses other libs). |
| `canvas-confetti` (+ `@types/canvas-confetti`) | Was used only by the now-deleted onboarding `Confetti`/`CompletionScreen`. Likely removable now — verify. |
| `@fontsource/cairo`, `@fontsource/jetbrains-mono` | 0 code references, **but verify against the `setup-fonts` build step before removing** — fonts may be loaded outside the import graph. |

---

## Verification (Batch A + B)

| Check | Result |
|---|---|
| Files removed | **42** (Batch A) + 1 deleted page + 1 page converted to redirect (Batch B) |
| `tsc --noEmit` (typecheck) | ✅ clean (baseline clean → post-deletion clean) |
| Unit tests (`vitest run`, TZ=UTC) | ✅ **1147 passed / 141 files** (unchanged from baseline) |
| `check:i18n` (ar/en parity) | ✅ OK |
| `check:bidi` | ✅ OK |
| `check:tolocale` | ✅ OK |
| `npm run lint` | ✅ 0 errors (163 pre-existing warnings, all in test files, unrelated) |
| `next build` | ✅ **succeeded** (Next 16.2.6 / Turbopack, compiled in 64s, full route table generated) |
| `/financial-intelligence` resolves | ✅ present in route table as `ƒ /[locale]/financial-intelligence`, now redirects to `/{locale}/analytics` |
| `/sentry-test` | ✅ removed from route table |
| No surviving file imports anything removed | ✅ confirmed (typecheck + grep) |

## Verification (sales-pipeline follow-up removal)

| Check | Result |
|---|---|
| Files changed | 1 page deleted (`admin/sales-pipeline/page.tsx`), 2 files edited (`AdminSidebar.tsx`, `admin/page.tsx`) |
| Repo grep for `sales-pipeline` | ✅ **zero code references** (only historical mentions in `docs/`) |
| `tsc --noEmit` (after clearing stale `.next/types`) | ✅ clean |
| Unit tests | ✅ **1147 passed / 141 files** |
| `check:i18n` / `check:bidi` / `check:tolocale` | ✅ OK |
| `npm run lint` | ✅ 0 errors, 163 warnings (unchanged — `Target` import removal left no new unused-var) |
| `next build` | ✅ **succeeded** (compiled in 76s); `sales-pipeline` **absent** from route table |
| Other admin tabs sharing the redirect map | ✅ `admin/finance`, `admin/vendors`, `admin/renewals`, `admin/analytics` all still build & resolve |

---

*Read-only-adjacent: deletions, one redirect conversion, and surgical nav/redirect-map edits to retire one prototype route. No dependency, schema, or snapshot changes. Hold for Eyad's review — no PR.*
