/**
 * FIX 2 — teacher reassignment is now wired into the teacher-assignment route, matching the
 * center full-admin branch EXACTLY: a rep change calls reassignCommissions('teacher', …);
 * a non-rep field change calls createCommissionsForTeacher(). Previously it did NOTHING.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdminContext, InternalRole } from '@/lib/admin-auth';

const h = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://teacher-reassign-test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-key';

  let maybeSingle: Record<string, unknown[]> = {};
  let single: Record<string, unknown> = {};

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'not', 'in', 'limit', 'eq']) b[m] = () => b;
    b.update = () => b;
    b.maybeSingle = async () => {
      const q = maybeSingle[table];
      return { data: q && q.length ? q.shift() : null, error: null };
    };
    b.single = async () => ({ data: single[table] ?? null, error: null });
    return b;
  }

  const fakeClient = { from: (t: string) => makeBuilder(t) };
  return {
    fakeClient,
    set: (cfg: { maybeSingle?: Record<string, unknown[]>; single?: Record<string, unknown> }) => {
      maybeSingle = cfg.maybeSingle ?? {};
      single = cfg.single ?? {};
    },
    reset: () => {
      maybeSingle = {};
      single = {};
    },
  };
});

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: () => h.fakeClient };
});

const mockedGetAdminContext = vi.fn();
vi.mock('@/lib/admin-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/admin-auth')>('@/lib/admin-auth');
  return { ...actual, getAdminContext: (req: Request) => mockedGetAdminContext(req) };
});

const reassignMock = vi.fn().mockResolvedValue(undefined);
const createCommissionsForTeacherMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/commissions', () => ({
  reassignCommissions: (...a: unknown[]) => reassignMock(...a),
  createCommissionsForTeacher: (...a: unknown[]) => createCommissionsForTeacherMock(...a),
}));

import * as teacherIdRoute from '@/app/api/admin/teacher-assignments/[id]/route';

function ceo(): AdminContext {
  return {
    userId: 'ceo-1',
    internalRole: 'super_admin' as InternalRole,
    adminRole: 'super_admin',
    supabaseAdmin: h.fakeClient as unknown as AdminContext['supabaseAdmin'],
  };
}

function jsonReq(body: unknown): Request {
  return new Request('https://t.test/api/admin/teacher-assignments/a1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockedGetAdminContext.mockReset();
  reassignMock.mockClear();
  createCommissionsForTeacherMock.mockClear();
  h.reset();
});

describe('PATCH /teacher-assignments/[id] — commission wiring (CEO full-admin)', () => {
  it('a rep change calls reassignCommissions("teacher", teacherId, newRep)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(ceo());
    h.set({
      maybeSingle: {
        teacher_assignments: [
          { teacher_id: 't1', sourced_by: 'sr', staff_id: 'rep-a', manager_staff_id: null },
        ],
      },
      single: { teacher_assignments: { id: 'a1', staff_id: 'rep-b' } },
    });

    const res = await teacherIdRoute.PATCH(jsonReq({ staff_id: 'rep-b' }), params('a1'));
    expect(res.status).toBe(200);
    expect(reassignMock).toHaveBeenCalledWith('teacher', 't1', 'rep-b');
    expect(createCommissionsForTeacherMock).not.toHaveBeenCalled();
  });

  it('a non-rep field change calls createCommissionsForTeacher (no reassignment)', async () => {
    mockedGetAdminContext.mockResolvedValueOnce(ceo());
    h.set({
      maybeSingle: {
        teacher_assignments: [
          { teacher_id: 't1', sourced_by: 'sr', staff_id: 'rep-a', manager_staff_id: null },
        ],
      },
      single: { teacher_assignments: { id: 'a1', sourced_by: 'eyad' } },
    });

    const res = await teacherIdRoute.PATCH(jsonReq({ sourced_by: 'eyad' }), params('a1'));
    expect(res.status).toBe(200);
    expect(createCommissionsForTeacherMock).toHaveBeenCalledWith('t1');
    expect(reassignMock).not.toHaveBeenCalled();
  });
});
