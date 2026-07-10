import { describe, it, expect } from 'vitest';
import { resolveInternalScope, type StaffRow } from '@/lib/internalScope';

const staff = (id: string, role: string): StaffRow => ({ id, role });

describe('resolveInternalScope — CEO / org-wide roles', () => {
  it('super_admin (CEO) is never scoped', () => {
    const s = resolveInternalScope('super_admin', 'super_admin', null, []);
    expect(s).toEqual({ level: 'all', staffId: null, staffIds: [] });
  });

  it('phone super-admin (no admin_users row) is unscoped', () => {
    const s = resolveInternalScope('super_admin', null, null, []);
    expect(s.level).toBe('all');
  });

  it('accountant / internal_admin keep org-wide visibility', () => {
    expect(resolveInternalScope('internal_viewer', 'accountant', null, []).level).toBe('all');
    expect(resolveInternalScope('internal_admin', 'internal_admin', null, []).level).toBe('all');
  });
});

describe('resolveInternalScope — Manager (sales_manager)', () => {
  it('linked manager sees self + direct reports', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_manager', staff('sm-1', 'sm'), ['sr-1', 'sr-2']);
    expect(s.level).toBe('team');
    expect(s.staffId).toBe('sm-1');
    expect(s.staffIds).toEqual(['sm-1', 'sr-1', 'sr-2']);
  });

  it('deduplicates the manager id if it appears in the reports list', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_manager', staff('sm-1', 'sm'), ['sm-1', 'sr-1']);
    expect(s.staffIds).toEqual(['sm-1', 'sr-1']);
  });

  it('a manager with no reports sees only their own accounts', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_manager', staff('sm-1', 'sm'), []);
    expect(s.staffIds).toEqual(['sm-1']);
  });

  it('FAILS CLOSED: unlinked manager (no staff row) sees nothing', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_manager', null, []);
    expect(s.level).toBe('team');
    expect(s.staffIds).toEqual([]);
    expect(s.staffId).toBeNull();
  });
});

describe('resolveInternalScope — Rep (sales_rep)', () => {
  it('linked rep sees only their own accounts', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_rep', staff('sr-9', 'sr'), []);
    expect(s.level).toBe('own');
    expect(s.staffId).toBe('sr-9');
    expect(s.staffIds).toEqual(['sr-9']);
  });

  it('FAILS CLOSED: unlinked rep (no staff row) sees nothing', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_rep', null, []);
    expect(s.level).toBe('own');
    expect(s.staffIds).toEqual([]);
    expect(s.staffId).toBeNull();
  });

  it('a rep is never widened to org scope even if reps were passed in error', () => {
    const s = resolveInternalScope('internal_viewer', 'sales_rep', staff('sr-9', 'sr'), ['sr-1', 'sr-2']);
    expect(s.staffIds).toEqual(['sr-9']);
  });
});
