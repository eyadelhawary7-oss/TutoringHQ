import { describe, it, expect } from 'vitest';
import { requireAdminRole, type AdminContext, type InternalRole } from '@/lib/admin-auth';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeCtx(internalRole: InternalRole, adminRole: string | null = null): AdminContext {
  return {
    userId: 'user-x',
    internalRole,
    adminRole,
    supabaseAdmin: {} as SupabaseClient,
  };
}

describe('requireAdminRole — super_admin-only gate', () => {
  it('rejects internal_admin with 403 when permitted=["super_admin"]', async () => {
    const res = requireAdminRole(makeCtx('internal_admin'), ['super_admin']);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { error: string; current: string };
    expect(body.error).toBe('insufficient_admin_role');
    expect(body.current).toBe('internal_admin');
  });

  it('rejects internal_viewer with 403 when permitted=["super_admin"]', () => {
    const res = requireAdminRole(makeCtx('internal_viewer'), ['super_admin']);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('allows super_admin (returns null) when permitted=["super_admin"]', () => {
    expect(requireAdminRole(makeCtx('super_admin'), ['super_admin'])).toBeNull();
  });

  it('allows super_admin AND internal_admin when permitted=["super_admin","admin"]', () => {
    expect(requireAdminRole(makeCtx('super_admin'), ['super_admin', 'admin'])).toBeNull();
    expect(requireAdminRole(makeCtx('internal_admin'), ['super_admin', 'admin'])).toBeNull();
  });

  it('rejects internal_viewer when permitted=["super_admin","admin"]', () => {
    const res = requireAdminRole(makeCtx('internal_viewer'), ['super_admin', 'admin']);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('admin_users row shorthand: rejects role="internal_admin" when permitted=["super_admin"]', () => {
    const res = requireAdminRole({ role: 'internal_admin' }, ['super_admin']);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('admin_users row shorthand: allows role="super_admin" when permitted=["super_admin"]', () => {
    expect(requireAdminRole({ role: 'super_admin' }, ['super_admin'])).toBeNull();
  });
});

// Regression for the PDPL gate on admin GETs (finance / billing / overview /
// pricing-config). The accountant role collapses to internalRole='internal_viewer'
// in getAdminContext, so we need the raw admin_users.role to authorise it.
describe('requireAdminRole — adminRole-aware gates (FIX 1)', () => {
  const FINANCE_PERMITTED = ['super_admin', 'admin', 'internal_admin', 'accountant'] as const;
  const PRICING_PERMITTED = ['super_admin', 'admin', 'internal_admin'] as const;

  it('finance/billing/overview: super_admin allowed', () => {
    expect(requireAdminRole(makeCtx('super_admin', 'super_admin'), FINANCE_PERMITTED)).toBeNull();
  });

  it('finance/billing/overview: internal_admin allowed', () => {
    expect(
      requireAdminRole(makeCtx('internal_admin', 'internal_admin'), FINANCE_PERMITTED),
    ).toBeNull();
    // raw admin_users.role='admin' also collapses to internal_admin
    expect(requireAdminRole(makeCtx('internal_admin', 'admin'), FINANCE_PERMITTED)).toBeNull();
  });

  it('finance/billing/overview: accountant allowed via raw adminRole', async () => {
    // accountant collapses to internalRole='internal_viewer' but the raw role
    // matches and unlocks finance-class reads.
    const res = requireAdminRole(makeCtx('internal_viewer', 'accountant'), FINANCE_PERMITTED);
    expect(res).toBeNull();
  });

  it('finance/billing/overview: support_agent denied (PII leak class)', async () => {
    const res = requireAdminRole(makeCtx('internal_viewer', 'support_agent'), FINANCE_PERMITTED);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    const body = (await res!.json()) as { error: string };
    expect(body.error).toBe('insufficient_admin_role');
  });

  it('finance/billing/overview: sales_rep denied (PII leak class)', async () => {
    const res = requireAdminRole(makeCtx('internal_viewer', 'sales_rep'), FINANCE_PERMITTED);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('finance/billing/overview: internal_viewer with no admin role denied', () => {
    const res = requireAdminRole(makeCtx('internal_viewer', 'internal_viewer'), FINANCE_PERMITTED);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('finance/billing/overview: custom role denied (must be allowlisted)', () => {
    const res = requireAdminRole(makeCtx('internal_viewer', 'custom'), FINANCE_PERMITTED);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('pricing-config GET: accountant denied (tighter gate)', () => {
    const res = requireAdminRole(makeCtx('internal_viewer', 'accountant'), PRICING_PERMITTED);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('pricing-config GET: internal_admin allowed', () => {
    expect(
      requireAdminRole(makeCtx('internal_admin', 'internal_admin'), PRICING_PERMITTED),
    ).toBeNull();
  });

  it('pricing-config GET: super_admin allowed', () => {
    expect(
      requireAdminRole(makeCtx('super_admin', 'super_admin'), PRICING_PERMITTED),
    ).toBeNull();
  });

  it('SUPER_ADMIN_PHONES super-admin (no admin_users row, adminRole=null) still passes', () => {
    // adminRole is null for phone-based super-admins; internalRole is the
    // authoritative signal in that case.
    expect(requireAdminRole(makeCtx('super_admin', null), FINANCE_PERMITTED)).toBeNull();
    expect(requireAdminRole(makeCtx('super_admin', null), PRICING_PERMITTED)).toBeNull();
  });
});
