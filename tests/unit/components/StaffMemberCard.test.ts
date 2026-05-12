/**
 * Pure-logic tests for StaffMemberCard exported helpers.
 * No DOM rendering required (no @testing-library installed).
 */
import { describe, it, expect, vi } from 'vitest';

// Prevent module-level Supabase env-var throw during import
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

// next-intl useTranslations is only called inside the component render (never at module level)
vi.mock('next-intl', () => ({ useTranslations: vi.fn() }));
import {
  isRoleAlwaysGranted,
  GRANULAR_PERMISSION_FLAGS,
  SIX_NEW_FLAGS,
} from '@/components/settings/StaffMemberCard';
import type { CenterPermission } from '@/lib/centerPermissions';

describe('isRoleAlwaysGranted', () => {
  it('returns true for owner regardless of any flags', () => {
    expect(isRoleAlwaysGranted('owner')).toBe(true);
  });

  it('returns true for super_admin', () => {
    expect(isRoleAlwaysGranted('super_admin')).toBe(true);
  });

  it('returns false for assistant', () => {
    expect(isRoleAlwaysGranted('assistant')).toBe(false);
  });

  it('returns false for teacher', () => {
    expect(isRoleAlwaysGranted('teacher')).toBe(false);
  });
});

describe('GRANULAR_PERMISSION_FLAGS', () => {
  it('contains exactly 8 flags', () => {
    expect(GRANULAR_PERMISSION_FLAGS).toHaveLength(8);
  });

  it('includes all 6 new sensitive flags', () => {
    const flags: CenterPermission[] = [
      'can_manage_billing',
      'can_edit_center_profile',
      'can_delete_students',
      'can_manage_academic_calendar',
      'can_place_card_orders',
      'can_request_referral_payouts',
    ];
    for (const f of flags) {
      expect(GRANULAR_PERMISSION_FLAGS).toContain(f);
    }
  });

  it('includes the 2 existing payment flags', () => {
    expect(GRANULAR_PERMISSION_FLAGS).toContain('can_record_payments' as CenterPermission);
    expect(GRANULAR_PERMISSION_FLAGS).toContain('can_view_payments' as CenterPermission);
  });
});

describe('SIX_NEW_FLAGS', () => {
  it('contains exactly 6 flags', () => {
    expect(SIX_NEW_FLAGS).toHaveLength(6);
  });

  it('does not include the legacy payment flags', () => {
    expect(SIX_NEW_FLAGS).not.toContain('can_record_payments' as CenterPermission);
    expect(SIX_NEW_FLAGS).not.toContain('can_view_payments' as CenterPermission);
  });

  it('is a strict subset of GRANULAR_PERMISSION_FLAGS', () => {
    for (const f of SIX_NEW_FLAGS) {
      expect(GRANULAR_PERMISSION_FLAGS).toContain(f);
    }
  });
});
