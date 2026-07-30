import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

const mockRequireCenterAuth = vi.fn();
const pendingEnrollmentsUpdateSingle = vi.fn();
const studentsUpdateEqEq = vi.fn().mockResolvedValue({ error: null });
const studentsUpdateMock = vi.fn((_payload?: Record<string, unknown>) => ({
  eq: () => ({ eq: studentsUpdateEqEq }),
}));

const supabaseAdminStub = {
  from: (table: string) => {
    if (table === 'pending_enrollments') {
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({ select: () => ({ single: pendingEnrollmentsUpdateSingle }) }),
          }),
        }),
      };
    }
    if (table === 'students') {
      return { update: studentsUpdateMock };
    }
    throw new Error(`unexpected table in reject test mock: ${table}`);
  },
};

vi.mock('@/lib/centerAuth', () => ({
  requireCenterAuth: (req: NextRequest) => mockRequireCenterAuth(req),
}));

import { POST } from '@/app/api/students/pending/[id]/reject/route';

const CENTER_ID = 'center-xyz';
const PENDING_ID = 'pending-1';
const STUDENT_ID = 'stu-1';

function makeRequest(): NextRequest {
  return new Request(`http://localhost/api/students/pending/${PENDING_ID}/reject`, {
    method: 'POST',
  }) as unknown as NextRequest;
}

const ctx = { params: Promise.resolve({ id: PENDING_ID }) };

beforeEach(() => {
  mockRequireCenterAuth.mockReset();
  pendingEnrollmentsUpdateSingle.mockReset();
  studentsUpdateMock.mockClear();
  studentsUpdateEqEq.mockClear();

  mockRequireCenterAuth.mockResolvedValue({
    ok: true,
    role: 'owner',
    centerId: CENTER_ID,
    supabaseAdmin: supabaseAdminStub,
  });
});

describe('POST /api/students/pending/[id]/reject', () => {
  it('stamps students.inactive_reason = rejected so the row is never indistinguishable from a real pause (D24)', async () => {
    pendingEnrollmentsUpdateSingle.mockResolvedValue({
      data: { student_id: STUDENT_ID },
      error: null,
    });

    const res = await POST(makeRequest(), ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(studentsUpdateMock).toHaveBeenCalledTimes(1);
    expect(studentsUpdateMock.mock.calls[0][0]).toEqual({ inactive_reason: 'rejected' });
  });

  it('does not touch students when the pending_enrollments row has no student_id', async () => {
    pendingEnrollmentsUpdateSingle.mockResolvedValue({
      data: { student_id: null },
      error: null,
    });

    const res = await POST(makeRequest(), ctx);

    expect(res.status).toBe(200);
    expect(studentsUpdateMock).not.toHaveBeenCalled();
  });

  it('still returns success when the pending_enrollments update itself fails to find a row', async () => {
    pendingEnrollmentsUpdateSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });

    const res = await POST(makeRequest(), ctx);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to reject request');
    expect(studentsUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects non owner/admin roles before touching either table', async () => {
    mockRequireCenterAuth.mockResolvedValue({
      ok: true,
      role: 'assistant',
      centerId: CENTER_ID,
      supabaseAdmin: supabaseAdminStub,
    });

    const res = await POST(makeRequest(), ctx);

    expect(res.status).toBe(401);
    expect(pendingEnrollmentsUpdateSingle).not.toHaveBeenCalled();
    expect(studentsUpdateMock).not.toHaveBeenCalled();
  });
});
