import { describe, it, expect } from 'vitest';
import {
  USERS_PROTECTED_COLUMNS,
  findProtectedUsersWrite,
} from '@/lib/dbProxyProtectedColumns';

describe('USERS_PROTECTED_COLUMNS', () => {
  it('includes role (the prior P0 column)', () => {
    expect(USERS_PROTECTED_COLUMNS.has('role')).toBe(true);
  });

  it('includes every can_* permission flag', () => {
    const expected = [
      'can_record_payments',
      'can_view_payments',
      'can_manage_billing',
      'can_edit_center_profile',
      'can_delete_students',
      'can_manage_academic_calendar',
      'can_place_card_orders',
      'can_request_referral_payouts',
    ];
    for (const key of expected) {
      expect(USERS_PROTECTED_COLUMNS.has(key), `missing protection for ${key}`).toBe(true);
    }
  });
});

describe('findProtectedUsersWrite', () => {
  it('returns "role" for the prior-P0 self-escalation payload', () => {
    // The exact payload a centre owner would have used to escalate via /api/db
    // before this hardening: PATCH users with role='super_admin' on self.
    expect(findProtectedUsersWrite({ role: 'super_admin' })).toBe('role');
  });

  it('returns the permission key when a can_* flag is in the payload', () => {
    expect(findProtectedUsersWrite({ can_manage_billing: true })).toBe('can_manage_billing');
  });

  it('returns null for benign update payloads (display_name, phone, etc.)', () => {
    expect(findProtectedUsersWrite({ display_name: 'Aya', phone: '+201000000000' })).toBeNull();
  });

  it('returns the first protected key when an array of rows is supplied', () => {
    const data = [
      { display_name: 'A' },
      { role: 'super_admin', display_name: 'B' },
    ];
    expect(findProtectedUsersWrite(data)).toBe('role');
  });

  it('returns null for empty or non-object data', () => {
    expect(findProtectedUsersWrite(null)).toBeNull();
    expect(findProtectedUsersWrite(undefined)).toBeNull();
    expect(findProtectedUsersWrite({})).toBeNull();
    expect(findProtectedUsersWrite([])).toBeNull();
    expect(findProtectedUsersWrite('not an object')).toBeNull();
  });
});
