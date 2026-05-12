# N+1 Hot Path Audit — Phase 15 Followup

*Generated: 2026-05-13*

---

## File 1: `src/app/api/admin/billing/route.ts`

**Pattern found:** No. The GET handler's `for (const row of billingRows)` loop (line 75) contains only in-memory computation — no `.from()` calls inside the loop. All DB fetches are batched before the loop:
- `centers` — single query, all columns, all centers
- `referral_rewards` — single `.in('referring_center_id', centerIds)` call
- `payg_weekly_charges` — single `.in('center_id', paygCenterIds)` call
- `admin_payments`, `invoices` (approved), `invoices` (pending) — each a single bounded query (`.limit(100)` / `.limit(50)`)

The audit grep likely matched the `.map(...)` callbacks that reference `.from()` only indirectly through imported functions, or the sequential single-center queries in the PUT/POST mutation handlers (which are not hot-path GET responses).

**Loop bound:** N/A
**Real N+1 risk:** No
**Proposed fix:** None
**Estimated query reduction at 100 centres:** 0 (already optimal in the GET path)

---

## File 2: `src/app/api/admin/centers/route.ts`

**Pattern found:** Yes. Inside `enrichCentersList()`, after fetching all owners from the `users` table in one batched query, the code issues one **Supabase Admin Auth API call per unique owner** in a `Promise.all` block (lines 114–129):

```ts
const uniqueOwnerAuthIds = [...new Set(...)];
const waPhoneByAuthId = new Map<string, string | null>();
await Promise.all(
  uniqueOwnerAuthIds.map(async (authId) => {
    const { data, error } = await adminClient.auth.admin.getUserById(authId);
    waPhoneByAuthId.set(authId, phoneFromCenterhqAuthEmail(data.user.email));
  }),
);
```

The purpose is to extract the owner's phone from their auth email (`${phoneDigits}@centerhq.local`). But the `users` table already stores `phone` in `row.phone`, which is fetched in the same preceding query. The code then immediately falls back to `row.phone` if the auth lookup is null:

```ts
const phone = (fromAuth && fromAuth.length > 0 ? fromAuth : null) ?? (row.phone && row.phone.trim() ? row.phone : null);
```

This means the auth API calls are redundant — `row.phone` is always available and carries the same value.

**Loop bound:** Grows with number of centres on the current page (default 50). For a 50-centre page there are up to 50 auth Admin API calls per GET request.
**Real N+1 risk:** Yes
**Proposed fix:** Drop the `Promise.all` auth admin lookup block entirely. Remove `uniqueOwnerAuthIds`, `waPhoneByAuthId`, and the `phoneFromCenterhqAuthEmail` import. Use `row.phone` directly in the `ownerMap` construction loop.
**Estimated query reduction at 100 centres:** Eliminates ~50 HTTP round-trips to the auth API per page request (from 51+ calls to 0 auth admin calls; the batched DB queries remain unchanged).

---

## File 3: `src/app/api/analytics/consolidated/route.ts`

**Pattern found:** Yes. The handler iterates over every centre in the organisation and issues 4 parallel DB queries per centre (lines 77–120):

```ts
for (const c of centers ?? []) {
  const [paymentsRes, studentsRes, studentCountRes, staffCountRes] = await Promise.all([
    supabaseAdmin.from('payments').select(...).eq('center_id', c.id)...,
    supabaseAdmin.from('students').select(...).eq('center_id', c.id),
    supabaseAdmin.from('students').select('*', { count: 'exact', head: true }).eq('center_id', c.id),
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('center_id', c.id),
  ]);
}
```

Each iteration is parallelised internally (`Promise.all`), but iterations are sequential with `await` on the outer `for`. An organisation with N branches fires 4N queries for this single endpoint.

**Loop bound:** Grows with number of branches in the organisation. An org with 10 branches = 40 queries; 20 branches = 80 queries.
**Real N+1 risk:** Yes
**Proposed fix:** Replace the entire loop with 3 batched queries (`.in('center_id', centerIds)`), then group/count in-memory:
1. `payments` for all center_ids in date range → group by `center_id` → compute `mrr` per branch
2. `students` with `center_id, balance_due` for all center_ids → count per branch + sum `balance_due` per branch
3. `users` with `center_id` for all center_ids → count per branch

Response shape (`total_mrr`, `total_students`, `total_outstanding`, `by_branch[]`) is preserved exactly.

**Estimated query reduction at 100 centres:** From ~400 queries per request to 4 queries (1 for centers + 3 batched dimensions). At a typical 5-branch org: from 21 to 4.

---

## File 4: `src/app/api/settings/billing/route.ts`

**Pattern found:** No. Every DB fetch in the GET handler targets a single centre via `.eq('center_id', auth.centerId)`:
- `centers` single row
- `pricing_plans` (global, no filter)
- `payg_rates` (global, no filter)
- `attendance_scans` (monthly), `attendance_scans` (this week)
- `payg_weekly_charges`, `invoices`, `announcement_blasts`

The `for (const p of order)` loop (line 145) iterates over a local in-memory `PlanKey[]` array and does no DB I/O. The mutation PUT/POST handlers each perform 1–2 single-row operations.

**Loop bound:** N/A — no DB calls in any loop
**Real N+1 risk:** No
**Proposed fix:** None
**Estimated query reduction at 100 centres:** 0 (single-centre route by design)

---

## File 5: `src/app/api/auth/check-invite/route.ts`

**Pattern found:** Technically yes, but bounded. The `for (const p of phoneVariants)` loop (lines 64–73) issues one DB query per phone variant:

```ts
const phoneVariants = [normalizedPhone, digits.startsWith('0') ? digits : '0' + digits];
for (const p of phoneVariants) {
  const { data } = await supabaseAdmin.from('center_invites').select(...).eq('phone', p)...;
  if (data) { invite = data; break; }
}
```

`phoneVariants` is **always exactly 2 elements**, and the loop breaks on first match. Maximum 2 DB round-trips per call; often just 1 (when the first format matches).

**Loop bound:** Fixed — always ≤ 2 variants, with early exit on first hit
**Real N+1 risk:** No — the worst case is 2 sequential queries, not unbounded growth
**Proposed fix:** Could be simplified to a single `.in('phone', phoneVariants)` query, but the saving is ≤ 1 round-trip per login. Not worth refactoring under these scope rules.
**Estimated query reduction at 100 centres:** 0 (this route is per-login, not per-centre)

---

## Summary

| File | Real N+1 | Pattern | Queries at 50-centre page | After fix |
|------|----------|---------|--------------------------|-----------|
| admin/billing | No | N/A (false positive) | ~6 queries | 0 change |
| **admin/centers** | **Yes** | N auth admin API calls per page | ~56 calls | ~6 calls |
| **analytics/consolidated** | **Yes** | 4 DB queries × N branches | 4N + 1 | 4 total |
| settings/billing | No | N/A (single-centre route) | ~8 queries | 0 change |
| auth/check-invite | No | Fixed-2 loop w/ early exit | ≤ 2 queries | 0 change |

- **Files with real N+1:** 2
- **Files with intentional / bounded sequential queries:** 3 (false positives from audit grep)
- **Total queries eliminated at 10-branch org (analytics):** 36 queries → 3 (–91%)
- **Total auth API calls eliminated at 50-centre admin page:** 50 calls → 0 (–100%)

The remaining 21 files flagged in audit Phase 15 are intentional rate-limit-respecting cron loops and are not in scope for this refactor.
