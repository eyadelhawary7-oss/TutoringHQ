import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveInternalScope,
  allowedCenterIds,
  allowedTeacherIds,
  type StaffRow,
  type InternalScope,
} from '@/lib/internalScope';

const staff = (id: string, role: string): StaffRow => ({ id, role });

// ── Recording Supabase stub for allowedCenterIds / allowedTeacherIds ──
// Each query is `.from(table).select(col).in(<col>, ids).eq('assignment_status','approved')`
// awaited as a thenable. The stub returns a different row list depending on whether the
// filter targeted staff_id or manager_staff_id, and records every .in() call so a test can
// prove reps never trigger a manager_staff_id query (no widening).
type Rows = Record<string, unknown>[];
interface StubConfig {
  centerByStaff?: Rows;
  centerByManager?: Rows;
  teacherByStaff?: Rows;
  teacherByManager?: Rows;
}
function makeStub(cfg: StubConfig) {
  const inCalls: { table: string; column: string; values: unknown[] }[] = [];
  function builder(table: string) {
    let lastCol = '';
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = () => b;
    b.in = (column: string, values: unknown[]) => {
      lastCol = column;
      inCalls.push({ table, column, values });
      return b;
    };
    b.then = (resolve: (v: { data: Rows; error: null }) => unknown) => {
      let data: Rows = [];
      if (table === 'center_assignments') {
        data = lastCol === 'manager_staff_id' ? (cfg.centerByManager ?? []) : (cfg.centerByStaff ?? []);
      } else if (table === 'teacher_assignments') {
        data = lastCol === 'manager_staff_id' ? (cfg.teacherByManager ?? []) : (cfg.teacherByStaff ?? []);
      }
      return resolve({ data, error: null });
    };
    return b;
  }
  const client = { from: (t: string) => builder(t) } as unknown as SupabaseClient;
  return { client, inCalls };
}

const scope = (level: InternalScope['level'], staffIds: string[]): InternalScope => ({
  level,
  staffId: staffIds[0] ?? null,
  staffIds,
});

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

describe('allowedCenterIds — DB scoping (Phase 4b two-level)', () => {
  it('level "all" (CEO) is unrestricted (null) and issues no query', async () => {
    const { client, inCalls } = makeStub({ centerByStaff: [{ center_id: 'x' }] });
    const ids = await allowedCenterIds(client, scope('all', []));
    expect(ids).toBeNull();
    expect(inCalls).toHaveLength(0);
  });

  it('level "own" (rep) matches staff_id only — never manager_staff_id (no widening)', async () => {
    const { client, inCalls } = makeStub({
      centerByStaff: [{ center_id: 'c1' }, { center_id: 'c2' }],
      centerByManager: [{ center_id: 'SHOULD_NOT_APPEAR' }],
    });
    const ids = await allowedCenterIds(client, scope('own', ['sr-1']));
    expect(ids).toEqual(['c1', 'c2']);
    // A rep must never trigger a manager_staff_id lookup.
    expect(inCalls.some((c) => c.column === 'manager_staff_id')).toBe(false);
    expect(inCalls.find((c) => c.column === 'staff_id')?.values).toEqual(['sr-1']);
  });

  it('level "team" (manager) unions staff_id and manager_staff_id matches, deduped', async () => {
    const { client, inCalls } = makeStub({
      centerByStaff: [{ center_id: 'c1' }, { center_id: 'c2' }],
      centerByManager: [{ center_id: 'c2' }, { center_id: 'c3' }],
    });
    const ids = await allowedCenterIds(client, scope('team', ['sm-1', 'sr-1']));
    expect(new Set(ids)).toEqual(new Set(['c1', 'c2', 'c3']));
    expect(inCalls.find((c) => c.column === 'staff_id')?.values).toEqual(['sm-1', 'sr-1']);
    expect(inCalls.find((c) => c.column === 'manager_staff_id')?.values).toEqual(['sm-1', 'sr-1']);
  });

  it('FAILS CLOSED: restricted scope with empty staffIds returns [] and issues no query', async () => {
    const { client, inCalls } = makeStub({ centerByStaff: [{ center_id: 'leak' }] });
    expect(await allowedCenterIds(client, scope('team', []))).toEqual([]);
    expect(await allowedCenterIds(client, scope('own', []))).toEqual([]);
    expect(inCalls).toHaveLength(0);
  });
});

describe('allowedTeacherIds — DB scoping (Phase 4b two-level)', () => {
  it('level "all" (CEO) is unrestricted (null) and issues no query', async () => {
    const { client, inCalls } = makeStub({ teacherByStaff: [{ teacher_id: 'x' }] });
    expect(await allowedTeacherIds(client, scope('all', []))).toBeNull();
    expect(inCalls).toHaveLength(0);
  });

  it('level "own" (rep) matches staff_id only — never manager_staff_id', async () => {
    const { client, inCalls } = makeStub({
      teacherByStaff: [{ teacher_id: 't1' }],
      teacherByManager: [{ teacher_id: 'SHOULD_NOT_APPEAR' }],
    });
    expect(await allowedTeacherIds(client, scope('own', ['sr-1']))).toEqual(['t1']);
    expect(inCalls.some((c) => c.column === 'manager_staff_id')).toBe(false);
  });

  it('level "team" (manager) unions staff_id and manager_staff_id matches, deduped', async () => {
    const { client } = makeStub({
      teacherByStaff: [{ teacher_id: 't1' }],
      teacherByManager: [{ teacher_id: 't1' }, { teacher_id: 't2' }],
    });
    const ids = await allowedTeacherIds(client, scope('team', ['sm-1']));
    expect(new Set(ids)).toEqual(new Set(['t1', 't2']));
  });

  it('FAILS CLOSED: restricted scope with empty staffIds returns [] and issues no query', async () => {
    const { client, inCalls } = makeStub({ teacherByStaff: [{ teacher_id: 'leak' }] });
    expect(await allowedTeacherIds(client, scope('team', []))).toEqual([]);
    expect(inCalls).toHaveLength(0);
  });
});
