import { describe, expect, it } from 'vitest';
import { isSuspendedRouteExempt as isSuspendedExempt } from '@/lib/suspendedRouteExempt';

/**
 * The suspended-redirect exemption must let a suspended centre reach the standalone
 * /reactivate page and the existing /suspended landing, and nothing else. Any drift
 * here is a P0 — it would either lock owners out of paying (false negatives) or open
 * up the dashboard to suspended centres (false positives).
 */
describe('proxy isSuspendedExempt', () => {
  it('exempts the standalone reactivation route', () => {
    expect(isSuspendedExempt('/reactivate')).toBe(true);
    expect(isSuspendedExempt('/reactivate/return')).toBe(true);
  });

  it('exempts the existing suspended landing page and its children', () => {
    expect(isSuspendedExempt('/suspended')).toBe(true);
    expect(isSuspendedExempt('/suspended/details')).toBe(true);
  });

  it('does NOT exempt the dashboard, students, payments, or settings billing routes', () => {
    expect(isSuspendedExempt('/dashboard')).toBe(false);
    expect(isSuspendedExempt('/students')).toBe(false);
    expect(isSuspendedExempt('/payments')).toBe(false);
    expect(isSuspendedExempt('/settings')).toBe(false);
    expect(isSuspendedExempt('/settings/billing')).toBe(false);
  });

  it('does NOT exempt admin or other authenticated routes', () => {
    expect(isSuspendedExempt('/admin')).toBe(false);
    expect(isSuspendedExempt('/admin/centers')).toBe(false);
    expect(isSuspendedExempt('/scan')).toBe(false);
    expect(isSuspendedExempt('/groups')).toBe(false);
    expect(isSuspendedExempt('/schedule')).toBe(false);
    expect(isSuspendedExempt('/attendance')).toBe(false);
    expect(isSuspendedExempt('/whatsapp')).toBe(false);
    expect(isSuspendedExempt('/notifications')).toBe(false);
  });

  it('rejects look-alike paths that share a string prefix but a different segment', () => {
    expect(isSuspendedExempt('/reactivate-foo')).toBe(false);
    expect(isSuspendedExempt('/reactivatex')).toBe(false);
    expect(isSuspendedExempt('/suspendedfoo')).toBe(false);
    expect(isSuspendedExempt('/suspended-archive')).toBe(false);
  });

  it('does NOT exempt the API surface (API auth is handled separately)', () => {
    expect(isSuspendedExempt('/api/reactivate/start')).toBe(false);
    expect(isSuspendedExempt('/api/db')).toBe(false);
  });
});
