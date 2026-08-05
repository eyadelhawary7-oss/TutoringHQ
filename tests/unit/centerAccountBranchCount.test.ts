import { describe, it, expect } from 'vitest';
import { resolveBranchCount } from '@/lib/centerAccountMetrics';

/**
 * `Merged-Admin-Accounts` §01 — the MANAGE list's Branches row.
 *
 * The row exists because a branch in this product is a `centers` row grouped by
 * `centers.organization_id` (the definition `/api/branches` uses), not a row in
 * a `branches` table — there isn't one. These cases pin the one judgement that
 * derivation needs: what a centre with NO organisation is worth.
 */
describe('resolveBranchCount', () => {
  it('counts a centre with no organisation as one branch, not zero', () => {
    // Every ordinary single-site centre lands here. Zero would render
    // "Branches 0" across the whole product and read as a data problem.
    expect(resolveBranchCount(null, null)).toBe(1);
    expect(resolveBranchCount(undefined, undefined)).toBe(1);
    // The org count is irrelevant without an org id — it is never consulted.
    expect(resolveBranchCount(null, 7)).toBe(1);
  });

  it('returns the organisation-wide centre count when the centre has an org', () => {
    expect(resolveBranchCount('org-1', 3)).toBe(3);
    expect(resolveBranchCount('org-1', 1)).toBe(1);
  });

  it('returns null when an org centre count did not come back', () => {
    // Distinct from zero on purpose: the row drops its figure rather than
    // asserting a number the query never established.
    expect(resolveBranchCount('org-1', null)).toBeNull();
    expect(resolveBranchCount('org-1', undefined)).toBeNull();
  });

  it('passes a genuine zero through rather than rewriting it', () => {
    // An org whose centres all vanished is a real, if odd, state. It is not the
    // "no organisation" case and must not be silently promoted to 1.
    expect(resolveBranchCount('org-1', 0)).toBe(0);
  });
});
