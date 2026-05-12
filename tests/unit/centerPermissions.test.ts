import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission } from '@/lib/centerPermissions';
import type { CenterAuthContext, CenterPermissions } from '@/lib/centerAuth';
import type { SupabaseClient } from '@supabase/supabase-js';

const allFalsePermissions: CenterPermissions = {
  can_record_payments: false,
  can_view_payments: false,
  can_manage_billing: false,
  can_edit_center_profile: false,
  can_delete_students: false,
  can_manage_academic_calendar: false,
  can_place_card_orders: false,
  can_request_referral_payouts: false,
};

function makeAuth(role: string, overrides: Partial<CenterPermissions> = {}): CenterAuthContext {
  return {
    ok: true,
    userId: 'user-1',
    centerId: 'center-1',
    role,
    permissions: { ...allFalsePermissions, ...overrides },
    supabaseAdmin: {} as SupabaseClient,
  };
}

describe('hasPermission', () => {
  it('returns true for owner regardless of flag value', () => {
    const auth = makeAuth('owner', { can_manage_billing: false });
    expect(hasPermission(auth, 'can_manage_billing')).toBe(true);
  });

  it('returns true for super_admin regardless of flag value', () => {
    const auth = makeAuth('super_admin', { can_delete_students: false });
    expect(hasPermission(auth, 'can_delete_students')).toBe(true);
  });

  it('returns true for assistant when flag is true', () => {
    const auth = makeAuth('assistant', { can_record_payments: true });
    expect(hasPermission(auth, 'can_record_payments')).toBe(true);
  });

  it('returns false for assistant when flag is false', () => {
    const auth = makeAuth('assistant');
    expect(hasPermission(auth, 'can_place_card_orders')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('returns null for a permitted user', () => {
    const auth = makeAuth('owner');
    expect(requirePermission(auth, 'can_manage_billing')).toBeNull();
  });

  it('returns null for assistant when flag is true', () => {
    const auth = makeAuth('assistant', { can_view_payments: true });
    expect(requirePermission(auth, 'can_view_payments')).toBeNull();
  });

  it('returns a 403 Response for a denied assistant', async () => {
    const auth = makeAuth('assistant');
    const result = requirePermission(auth, 'can_request_referral_payouts');
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('403 response body includes the correct permission field', async () => {
    const auth = makeAuth('assistant');
    const result = requirePermission(auth, 'can_edit_center_profile') as Response;
    const body = await result.json();
    expect(body.permission).toBe('can_edit_center_profile');
    expect(body.error).toBe('permission_required');
  });

  it('type-check: passing an invalid permission string is a TypeScript error', () => {
    const auth = makeAuth('assistant');
    // @ts-expect-error 'not_a_real_permission' is not assignable to CenterPermission
    hasPermission(auth, 'not_a_real_permission');
  });
});
