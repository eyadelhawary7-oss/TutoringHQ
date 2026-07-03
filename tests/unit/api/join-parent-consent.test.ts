import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

// Public join routes create an inactive student + a pending_enrollment. We only
// need to observe the students insert payload and assert the consent gate, so
// the admin client is a small hand-rolled double. The factory is hoisted, so it
// references the vi.fn()s lazily inside closures.
const studentsInsert = vi.fn();
const pendingInsert = vi.fn().mockResolvedValue({ error: null });

function fromImpl(table: string) {
  if (table === 'student_groups') {
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'group-1', subject: 'Math' }, error: null }) }) }),
      }),
    };
  }
  if (table === 'centers') {
    return {
      select: () => ({ or: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'center-1' }, error: null }) }) }) }),
    };
  }
  if (table === 'students') {
    return {
      insert: (...a: unknown[]) => {
        studentsInsert(...a);
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'student-1' }, error: null }) }) };
      },
    };
  }
  if (table === 'pending_enrollments') {
    return { insert: (...a: unknown[]) => pendingInsert(...a) };
  }
  throw new Error(`unexpected table ${table}`);
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => fromImpl(t) }),
}));
vi.mock('@/lib/ratelimit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => Promise.resolve({ success: true }),
  rateLimitExceededResponse: () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }),
}));

import { POST as pendingEnrollmentPost } from '@/app/api/join/pending-enrollment/route';
import { POST as joinByLinkPost } from '@/app/api/join/[center_code]/[group_id]/route';

const GROUP_UUID = '11111111-1111-1111-1111-111111111111';

function req(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  studentsInsert.mockClear();
  pendingInsert.mockClear();
});

describe('POST /api/join/pending-enrollment — parent consent gate', () => {
  const base = {
    center_id: 'center-1',
    group_id: GROUP_UUID,
    student_name: 'Ali',
    student_phone: '01000000000',
  };

  it('rejects with 403 when parent consent is absent and inserts no student', async () => {
    const res = await pendingEnrollmentPost(req('http://localhost/api/join/pending-enrollment', base) as never);
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe('PARENT_CONSENT_REQUIRED');
    expect(studentsInsert).not.toHaveBeenCalled();
  });

  it('rejects when parent_consent is false', async () => {
    const res = await pendingEnrollmentPost(
      req('http://localhost/api/join/pending-enrollment', { ...base, parent_consent: false }) as never,
    );
    expect(res.status).toBe(403);
    expect(studentsInsert).not.toHaveBeenCalled();
  });

  it('stamps parent_self_enroll_consent_at when consent is given', async () => {
    const res = await pendingEnrollmentPost(
      req('http://localhost/api/join/pending-enrollment', { ...base, parent_consent: true }) as never,
    );
    expect(res.status).toBe(200);
    expect(studentsInsert).toHaveBeenCalledTimes(1);
    const payload = studentsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof payload.parent_self_enroll_consent_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.parent_self_enroll_consent_at as string))).toBe(false);
  });
});

describe('POST /api/join/[center_code]/[group_id] — parent consent gate', () => {
  const ctx = { params: Promise.resolve({ center_code: 'center-1', group_id: GROUP_UUID }) };
  const base = { name: 'Ali', phone: '01000000000' };

  it('rejects with 403 when parent consent is absent and inserts no student', async () => {
    const res = await joinByLinkPost(
      req(`http://localhost/api/join/center-1/${GROUP_UUID}`, base) as never,
      ctx,
    );
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe('PARENT_CONSENT_REQUIRED');
    expect(studentsInsert).not.toHaveBeenCalled();
  });

  it('stamps parent_self_enroll_consent_at when consent is given', async () => {
    const res = await joinByLinkPost(
      req(`http://localhost/api/join/center-1/${GROUP_UUID}`, { ...base, parent_consent: true }) as never,
      ctx,
    );
    expect(res.status).toBe(200);
    expect(studentsInsert).toHaveBeenCalledTimes(1);
    const payload = studentsInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof payload.parent_self_enroll_consent_at).toBe('string');
    expect(Number.isNaN(Date.parse(payload.parent_self_enroll_consent_at as string))).toBe(false);
  });
});
