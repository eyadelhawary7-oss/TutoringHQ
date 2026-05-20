import { describe, it, expect } from 'vitest';
import { requireAdminRole, type AdminContext, type InternalRole } from '@/lib/admin-auth';
import type { SupabaseClient } from '@supabase/supabase-js';

function makeCtx(internalRole: InternalRole): AdminContext {
  return {
    userId: 'user-x',
    internalRole,
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
