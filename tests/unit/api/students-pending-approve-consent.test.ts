import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const rpcMock = vi.fn();
const studentsUpdateEqEq = vi.fn().mockResolvedValue({ error: null });
const studentsUpdateMock = vi.fn((_payload?: Record<string, unknown>) => ({
  eq: () => ({ eq: studentsUpdateEqEq }),
}));
const studentsSelectMaybeSingle = vi.fn();
const logAdminAction = vi.fn().mockResolvedValue(undefined);
const afterStudentWriteParentPackEffects = vi.fn().mockResolvedValue(undefined);

const supabaseAdminStub = {
  rpc: rpcMock,
  from: (table: string) => {
    if (table === 'students') {
      return {
        update: studentsUpdateMock,
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: studentsSelectMaybeSingle }) }) }),
      };
    }
    throw new Error(`unexpected table in approve test mock: ${table}`);
  },
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: NextRequest) => mockRequireCenterAuth(req),
}));
vi.mock('@/lib/audit', () => ({
  logAdminAction: (...args: unknown[]) => logAdminAction(...args),
}));
vi.mock('@/lib/studentParentPackWelcome', () => ({
  afterStudentWriteParentPackEffects: (...args: unknown[]) =>
    afterStudentWriteParentPackEffects(...args),
}));

import { POST } from '@/app/api/students/pending/[id]/approve/route';

const USER_ID = 'user-abc';
const CENTER_ID = 'center-xyz';
const STUDENT_ID = 'stu-1';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request(`http://localhost/api/students/pending/${STUDENT_ID}/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const ctx = { params: Promise.resolve({ id: STUDENT_ID }) };

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  rpcMock.mockReset();
  studentsUpdateMock.mockClear();
  studentsUpdateEqEq.mockClear();
  studentsSelectMaybeSingle.mockReset();
  logAdminAction.mockClear();
  afterStudentWriteParentPackEffects.mockClear();

  mockRequireCenterAuth.mockResolvedValue({
    ok: true,
    userId: USER_ID,
    centerId: CENTER_ID,
    supabaseAdmin: supabaseAdminStub,
  });
  rpcMock.mockResolvedValue({ data: { new_student_count: 5 }, error: null });
  studentsSelectMaybeSingle.mockResolvedValue({
    data: { id: STUDENT_ID, name: 'Ali', parent_phone: null, parent_pack_opted_in: false },
    error: null,
  });
});

describe('POST /api/students/pending/[id]/approve — guardian consent gate', () => {
  it('rejects with 403 when guardian consent is not confirmed and never approves', async () => {
    const res = await POST(makeRequest({ groupIds: ['g1'] }), ctx);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.code).toBe('GUARDIAN_CONSENT_REQUIRED');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(studentsUpdateMock).not.toHaveBeenCalled();
  });

  it('approves and stamps guardian_consent_confirmed_at/_by when confirmed', async () => {
    const res = await POST(
      makeRequest({ groupIds: ['g1'], guardianConsentConfirmed: true }),
      ctx,
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(studentsUpdateMock).toHaveBeenCalledTimes(1);
    const updatePayload = studentsUpdateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload.guardian_consent_confirmed_by).toBe(USER_ID);
    expect(typeof updatePayload.guardian_consent_confirmed_at).toBe('string');
  });
});
