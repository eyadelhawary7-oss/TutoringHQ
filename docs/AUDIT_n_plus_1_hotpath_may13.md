# N+1 Hot Path Audit — Phase 15 Followup

> Point-in-time snapshot as of 2026-05-13. Reviewed 2026-07-18; preserved as a historical audit. The one real N+1 it found (File 2) has since been resolved — see the dated note on that section.

*Generated: 2026-05-13*

## File 1: `src/app/api/admin/billing/route.ts`

**Pattern found:** No. The main `for (const row of billingRows)` loop only computes derived fields in memory (amounts, MRR, discounts, `daysUntilDue`). There is no `await supabase...` or `.from()` inside that loop. Referral credits and PAYG charges are loaded with batched `.in('center_id', ...)` / `.in('referring_center_id', ...)` before the loop. `paymentRows` / `invoiceRows` use `.find()` on `billingRows` for `centerName` — that is extra CPU (O(payments × centers)) but **not** extra round-trips to Postgres.

**Loop bound:** `billingRows` grows with all non-deleted centres (growing table).

**Real N+1 risk:** No (queries are not executed per row inside a loop).

**Proposed fix:** None required for query count. Optional future work: a `Map<centerId, name>` built once from `centers` for O(1) name lookup in payment/invoice maps (CPU only; must keep response semantics if `billingRows` is plan-filtered).

**Estimated query reduction at 100 centres:** 0 (already constant query count for the hot GET path aside from list size).

---

## File 2: `src/app/api/admin/centers/route.ts`

**Pattern found:** Yes, in **DELETE** only. `GET` uses `enrichCentersList`, which already batches `students`, `attendance_scans`, `users`, `admin_payments`, and referring centres with `.in('center_id', centerIds)` (see inline note re prior auth N+1 removal). However, when deleting a centre, the handler loads `studentIds` then runs:

`for (const sid of studentIds) { await adminSupabase.from('parent_portal_tokens').delete().eq('student_id', sid) }`

That is **one DELETE round-trip per student** (classic sequential N+1).

**Loop bound:** Grows with student count for the deleted centre.

**Real N+1 risk:** Yes.

**Proposed fix:** Replace the loop with a single `delete().in('student_id', studentIds)` (wrapped in the same try/catch pattern).

**Estimated query reduction:** For one centre with *S* students, from *S* queries to **1** (e.g. 200 students → 200 to 1).

*(Update, verified 2026-07-18: FIXED. The `parent_portal_tokens` delete was batched into a single `.in('student_id', …)`, and the `admin/centers` DELETE handler was later rewritten entirely to deactivate rather than hard-delete a center — the per-student loop is gone. Corroborated by `docs/ENTERPRISE_ARCHITECTURE_AUDIT_2026-07-07.md` §3.4 and `docs/FIX_2026-07-02_SAFE_CLEANUP_TECHNICAL.md` §H3.)*

---

## File 3: `src/app/api/analytics/consolidated/route.ts`

**Pattern found:** No remaining DB N+1. The route uses `Promise.all` with three batched queries (`payments`, `students`, `users`) scoped by `.in('center_id', centerIds)`, then aggregates in memory. The `for (const c of centers)` loop only reads maps.

**Loop bound:** Branches (centres) in the org — growing.

**Real N+1 risk:** No (already refactored; see existing comment in source).

**Proposed fix:** None.

**Estimated query reduction at 100 centres:** Already ~3 queries instead of O(N) per metric family.

---

## File 4: `src/app/api/settings/billing/route.ts`

**Pattern found:** No. `GET` runs a fixed sequence of scoped queries (`centers` by id, `pricing_plans`, `payg_rates`, `attendance_scans` twice for month/week windows, `payg_weekly_charges`, `invoices`, `announcement_blasts`). The only `for` loop is `for (const p of order)` over `ORDERED_SUBSCRIPTION_PLAN_KEYS` (small constant list) calling `getPlanPrice` in memory — no Supabase inside the loop.

**Loop bound:** N/A for DB.

**Real N+1 risk:** No.

**Proposed fix:** None.

**Estimated query reduction:** 0.

---

## File 5: `src/app/api/auth/check-invite/route.ts`

**Pattern found:** A `for (const p of phoneVariants)` loop issues up to **two** `center_invites` selects (normalized vs leading-zero variant). This is bounded by a constant (2), not by centres/students/invites table cardinality.

**Loop bound:** Fixed (≤2).

**Real N+1 risk:** No — intentional format fallback, not scaling N+1.

**Proposed fix:** None (optional micro-optimization: single query with `.or('phone.eq.x,phone.eq.y)` could shave one round-trip but is not required for Phase 15 “hot path N+1”).

**Estimated query reduction:** 0 for audit purposes.

---

## Summary

- **Files with real N+1:** **1** — `src/app/api/admin/centers/route.ts` (DELETE handler, `parent_portal_tokens` per student).
- **Files with intentional sequential queries:** **1** — `check-invite` (≤2 phone variants; not table-scaled).
- **Files already batched / no query-in-loop:** **3** — `admin/billing` (GET), `analytics/consolidated`, `settings/billing`.
- **Total queries eliminated at scale:** Per **single centre delete**, up to **(S − 1)** redundant DELETEs removed where *S* = student count (e.g. **199** fewer queries when *S* = 200). Not expressed “per 100 centres” because this path is per-delete, not per list page.
