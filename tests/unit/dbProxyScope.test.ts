import { describe, it, expect } from 'vitest';
import { planScope, applyForcedData, TABLE_SCOPE, ATTENDANCE_WRITER_ROLES } from '@/lib/dbProxyScope';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const FOREIGN = '22222222-2222-2222-2222-222222222222';

const ctxMember = { isSuperAdmin: false, actorCenterId: ACTOR };
const ctxSuper = { isSuperAdmin: true, actorCenterId: ACTOR };

describe('planScope — direct-scope tables', () => {
  it('SELECT on students with cross-tenant center_id filter is rejected', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: [{ column: 'center_id', op: 'eq', value: FOREIGN }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('CROSS_TENANT_FILTER_REJECTED');
    }
  });

  it('SELECT on students with no center_id filter returns direct plan (route force-appends .eq)', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: [{ column: 'is_active', op: 'eq', value: true }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('direct');
    if (plan.kind === 'direct') {
      expect(plan.column).toBe('center_id');
      expect(plan.centerId).toBe(ACTOR);
    }
  });

  it('SELECT on students with own center_id filter is allowed', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: [{ column: 'center_id', op: 'eq', value: ACTOR }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('direct');
  });

  it('SELECT with IN filter containing a foreign center_id is rejected', () => {
    const plan = planScope({
      table: 'payments',
      operation: 'select',
      filters: [{ column: 'center_id', op: 'in', value: [ACTOR, FOREIGN] }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') expect(plan.code).toBe('CROSS_TENANT_FILTER_REJECTED');
  });

  it('SELECT with neq center_id filter targeting own center is rejected', () => {
    // .neq('center_id', actor) would return all other tenants.
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: [{ column: 'center_id', op: 'neq', value: ACTOR }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
  });

  it('UPDATE on centers with foreign id filter is rejected (scope column = id)', () => {
    const plan = planScope({
      table: 'centers',
      operation: 'update',
      filters: [{ column: 'id', op: 'eq', value: FOREIGN }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') expect(plan.code).toBe('CROSS_TENANT_FILTER_REJECTED');
  });

  it('INSERT on centers is forbidden for non-super-admin', () => {
    const plan = planScope({
      table: 'centers',
      operation: 'insert',
      filters: undefined,
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') expect(plan.code).toBe('INSERT_FORBIDDEN');
  });

  it('rejects callers with no associated center_id', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: undefined,
      ctx: { isSuperAdmin: false, actorCenterId: null },
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') expect(plan.code).toBe('NO_CENTER');
  });
});

describe('planScope — forbidden tables', () => {
  it('non-super-admin gets 403 on demo_requests', () => {
    const plan = planScope({
      table: 'demo_requests',
      operation: 'select',
      filters: undefined,
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('TABLE_NOT_PERMITTED_VIA_PROXY');
    }
  });

  it('non-super-admin gets 403 on whatsapp_incoming', () => {
    const plan = planScope({
      table: 'whatsapp_incoming',
      operation: 'select',
      filters: undefined,
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') expect(plan.code).toBe('TABLE_NOT_PERMITTED_VIA_PROXY');
  });

  it('super-admin bypasses forbidden-table block', () => {
    const plan = planScope({
      table: 'demo_requests',
      operation: 'select',
      filters: undefined,
      ctx: ctxSuper,
    });
    expect(plan.kind).toBe('super_admin_bypass');
  });
});

describe('planScope — teacher deny (Model B, centre-less)', () => {
  const ctxTeacher = { isSuperAdmin: false, actorCenterId: null, role: 'teacher' };

  it('direct table (students) denies with TEACHER_PROXY_UNSUPPORTED', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: undefined,
      ctx: ctxTeacher,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('TEACHER_PROXY_UNSUPPORTED');
    }
  });

  it('indirect table (student_group_members) denies with TEACHER_PROXY_UNSUPPORTED', () => {
    const plan = planScope({
      table: 'student_group_members',
      operation: 'select',
      filters: undefined,
      ctx: ctxTeacher,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('TEACHER_PROXY_UNSUPPORTED');
    }
  });

  it('forbidden table (demo_requests) denies with TEACHER_PROXY_UNSUPPORTED (precedes forbidden branch)', () => {
    const plan = planScope({
      table: 'demo_requests',
      operation: 'select',
      filters: undefined,
      ctx: ctxTeacher,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('TEACHER_PROXY_UNSUPPORTED');
    }
  });

  it('teacher with a stray non-null actorCenterId still denies, never falling through to direct scope', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: undefined,
      ctx: { isSuperAdmin: false, actorCenterId: 'some-uuid', role: 'teacher' },
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('TEACHER_PROXY_UNSUPPORTED');
    }
  });

  it('super-admin precedence: isSuperAdmin=true with role teacher still bypasses', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: undefined,
      ctx: { isSuperAdmin: true, actorCenterId: null, role: 'teacher' },
    });
    expect(plan.kind).toBe('super_admin_bypass');
  });

  it('regression: owner role on a direct table still returns the normal direct plan', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: undefined,
      ctx: { isSuperAdmin: false, actorCenterId: ACTOR, role: 'owner' },
    });
    expect(plan.kind).toBe('direct');
    if (plan.kind === 'direct') {
      expect(plan.column).toBe('center_id');
      expect(plan.centerId).toBe(ACTOR);
    }
  });
});

describe('planScope — attendance write allow-list (owner/assistant only)', () => {
  const attInsert = (role: string | null) =>
    planScope({
      table: 'attendance_scans',
      operation: 'insert',
      filters: undefined,
      ctx: { isSuperAdmin: false, actorCenterId: ACTOR, role },
    });

  it('the allow-list is exactly {owner, assistant}', () => {
    expect([...ATTENDANCE_WRITER_ROLES].sort()).toEqual(['assistant', 'owner']);
  });

  it('OWNER may record attendance (direct plan)', () => {
    const plan = attInsert('owner');
    expect(plan.kind).toBe('direct');
    if (plan.kind === 'direct') {
      expect(plan.column).toBe('center_id');
      expect(plan.centerId).toBe(ACTOR);
    }
  });

  it('ASSISTANT may record attendance (direct plan)', () => {
    expect(attInsert('assistant').kind).toBe('direct');
  });

  it('ADMIN is denied ATTENDANCE_ROLE_FORBIDDEN (privileged elsewhere, but not on the attendance allow-list)', () => {
    const plan = attInsert('admin');
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(403);
      expect(plan.code).toBe('ATTENDANCE_ROLE_FORBIDDEN');
    }
  });

  it('an unexpected or blank role is denied ATTENDANCE_ROLE_FORBIDDEN (no more anyone-but-teacher)', () => {
    expect(attInsert(null).kind).toBe('deny');
    const p = attInsert('');
    expect(p.kind).toBe('deny');
    if (p.kind === 'deny') expect(p.code).toBe('ATTENDANCE_ROLE_FORBIDDEN');
  });

  it('TEACHER is still denied earlier — TEACHER_PROXY_UNSUPPORTED takes precedence', () => {
    const plan = attInsert('teacher');
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') expect(plan.code).toBe('TEACHER_PROXY_UNSUPPORTED');
  });

  it('SUPER-ADMIN bypasses the allow-list (can insert attendance regardless of role)', () => {
    const plan = planScope({
      table: 'attendance_scans',
      operation: 'insert',
      filters: undefined,
      ctx: { isSuperAdmin: true, actorCenterId: ACTOR, role: 'admin' },
    });
    expect(plan.kind).toBe('super_admin_bypass');
  });

  it('READS are unaffected: an admin SELECT on attendance_scans still returns a direct plan', () => {
    const asAdmin = planScope({
      table: 'attendance_scans',
      operation: 'select',
      filters: undefined,
      ctx: { isSuperAdmin: false, actorCenterId: ACTOR, role: 'admin' },
    });
    expect(asAdmin.kind).toBe('direct'); // reading attendance is NOT restricted to owner/assistant
  });

  it('the allow-list is attendance-specific: an assistant INSERT on students is unaffected (direct plan)', () => {
    const plan = planScope({
      table: 'students',
      operation: 'insert',
      filters: undefined,
      ctx: { isSuperAdmin: false, actorCenterId: ACTOR, role: 'assistant' },
    });
    expect(plan.kind).toBe('direct');
  });
});

describe('planScope — super-admin bypass', () => {
  it('super-admin can target any center on a direct-scope table', () => {
    const plan = planScope({
      table: 'students',
      operation: 'select',
      filters: [{ column: 'center_id', op: 'eq', value: FOREIGN }],
      ctx: ctxSuper,
    });
    expect(plan.kind).toBe('super_admin_bypass');
  });

  it('super-admin can insert into centers', () => {
    const plan = planScope({
      table: 'centers',
      operation: 'insert',
      filters: undefined,
      ctx: ctxSuper,
    });
    expect(plan.kind).toBe('super_admin_bypass');
  });
});

describe('planScope — indirect tables', () => {
  it('returns indirect plan for student_group_members', () => {
    const plan = planScope({
      table: 'student_group_members',
      operation: 'select',
      filters: [{ column: 'group_id', op: 'eq', value: 'abc' }],
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('indirect');
    if (plan.kind === 'indirect') expect(plan.centerId).toBe(ACTOR);
  });

  it('returns indirect plan for attendance_overrides', () => {
    const plan = planScope({
      table: 'attendance_overrides',
      operation: 'insert',
      filters: undefined,
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('indirect');
  });
});

describe('planScope — unknown table', () => {
  it('rejects with TABLE_NOT_ALLOWED', () => {
    const plan = planScope({
      table: 'arbitrary_table',
      operation: 'select',
      filters: undefined,
      ctx: ctxMember,
    });
    expect(plan.kind).toBe('deny');
    if (plan.kind === 'deny') {
      expect(plan.status).toBe(400);
      expect(plan.code).toBe('TABLE_NOT_ALLOWED');
    }
  });
});

describe('applyForcedData — payload overwrite', () => {
  it('INSERT on students forces center_id to caller, overwriting client value', () => {
    const data = { name: 'Aya', center_id: FOREIGN, parent_phone: '01000000000' };
    const result = applyForcedData(data, 'students', 'insert', 'center_id', ACTOR) as Record<string, unknown>;
    expect(result.center_id).toBe(ACTOR);
    expect(result.name).toBe('Aya');
    // Original data is not mutated
    expect(data.center_id).toBe(FOREIGN);
  });

  it('INSERT with array data forces center_id on every row', () => {
    const data = [
      { name: 'A', center_id: FOREIGN },
      { name: 'B', center_id: FOREIGN },
    ];
    const result = applyForcedData(data, 'students', 'insert', 'center_id', ACTOR) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0].center_id).toBe(ACTOR);
    expect(result[1].center_id).toBe(ACTOR);
  });

  it('UPDATE on students strips a client-supplied foreign center_id', () => {
    // Prevents an attacker from reassigning their own student to another center.
    const data = { name: 'Aya', center_id: FOREIGN };
    const result = applyForcedData(data, 'students', 'update', 'center_id', ACTOR) as Record<string, unknown>;
    expect(result.center_id).toBe(ACTOR);
  });

  it('SELECT/DELETE do not touch data', () => {
    const data = { center_id: FOREIGN };
    expect(applyForcedData(data, 'students', 'select', 'center_id', ACTOR)).toBe(data);
    expect(applyForcedData(data, 'students', 'delete', 'center_id', ACTOR)).toBe(data);
  });

  it('centers table is excluded — id (primary key) is never forced', () => {
    const data = { name: 'Centre A', id: FOREIGN };
    const result = applyForcedData(data, 'centers', 'update', 'id', ACTOR) as Record<string, unknown>;
    expect(result.id).toBe(FOREIGN);
  });
});

describe('TABLE_SCOPE — coverage', () => {
  it('covers every table the legacy proxy historically allowed', () => {
    const legacy = [
      'payments', 'students', 'student_groups', 'attendance_scans', 'attendance_overrides',
      'rooms', 'schedule_slots', 'centers', 'users', 'subjects',
      'subscriptions', 'whatsapp_messages', 'whatsapp_incoming',
      'permissions', 'demo_requests', 'center_invites', 'student_group_members',
      'wa_templates', 'paid_parents', 'reminder_settings',
      'card_orders',
    ];
    for (const t of legacy) {
      expect(TABLE_SCOPE[t], `missing scope rule for ${t}`).toBeDefined();
    }
  });
});
