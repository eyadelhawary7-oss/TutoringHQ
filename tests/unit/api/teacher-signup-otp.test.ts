import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashOtp, TEACHER_SIGNUP_OTP_TEMPLATE } from '@/lib/teacherSignupOtp';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

type Dup = { data: { id: string } | null; error: { message: string } | null };

const usersDupMaybeSingle = vi.fn<() => Promise<Dup>>();
const otpDeleteIs = vi.fn<() => Promise<{ error: null }>>(async () => ({ error: null }));
const otpInsert = vi.fn<(p: Record<string, unknown>) => Promise<{ error: null }>>(
  async () => ({ error: null }),
);
const outboxInsert = vi.fn<(p: Record<string, unknown>) => Promise<{ error: null }>>(
  async () => ({ error: null }),
);

const adminClient = {
  from: (table: string) => {
    if (table === 'users') {
      return {
        select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: usersDupMaybeSingle }) }) }),
      };
    }
    if (table === 'teacher_signup_otps') {
      return {
        delete: () => ({ eq: () => ({ is: otpDeleteIs }) }),
        insert: otpInsert,
      };
    }
    if (table === 'webhook_outbox') {
      return { insert: outboxInsert };
    }
    throw new Error(`unexpected table in send-otp mock: ${table}`);
  },
};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => adminClient,
}));

const mockRateLimit = vi.fn(async () => ({ success: true, remaining: 3, reset: 0 }));
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...(args as [])),
}));

vi.mock('@sentry/nextjs', () => ({
  withScope: (fn: (s: { setTag: (k: string, v: string) => void }) => void) => {
    fn({ setTag: () => undefined });
  },
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST } from '@/app/api/auth/teacher/signup/send-otp/route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/teacher/signup/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  usersDupMaybeSingle.mockReset();
  otpDeleteIs.mockClear();
  otpInsert.mockClear();
  outboxInsert.mockClear();
  mockRateLimit.mockReset();
  usersDupMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockRateLimit.mockResolvedValue({ success: true, remaining: 3, reset: 0 });
  delete process.env.VERCEL_ENV;
  delete process.env.TEACHER_SIGNUP_OTP_TEST_ECHO;
});

describe('POST /api/auth/teacher/signup/send-otp', () => {
  it('invalid phone -> 400 INVALID_PHONE, nothing stored', async () => {
    const res = await POST(makeRequest({ phone: '12345' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_PHONE');
    expect(otpInsert).not.toHaveBeenCalled();
  });

  it('already-registered phone -> 409, no OTP stored', async () => {
    usersDupMaybeSingle.mockResolvedValueOnce({ data: { id: 'u1' }, error: null });
    const res = await POST(makeRequest({ phone: '01012345678' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('PHONE_ALREADY_REGISTERED');
    expect(otpInsert).not.toHaveBeenCalled();
  });

  it('stores the OTP hashed (never the raw code) and queues the WA stub', async () => {
    const res = await POST(makeRequest({ phone: '01012345678' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: boolean; maskedPhone: string; devCode?: string };
    expect(body.sent).toBe(true);
    expect(body.maskedPhone).toContain('•');
    // Flag off -> no code echoed.
    expect(body.devCode).toBeUndefined();

    // Prior unverified codes cleared, then a new hashed row inserted.
    expect(otpDeleteIs).toHaveBeenCalled();
    const otpPayload = otpInsert.mock.calls[0][0];
    expect(otpPayload.phone).toBe('+201012345678');
    expect(otpPayload).not.toHaveProperty('code');
    expect(typeof otpPayload.code_hash).toBe('string');
    expect((otpPayload.code_hash as string)).toMatch(/^[a-f0-9]{64}$/);

    // Delivery goes through the gated/stubbed WhatsApp path (outbox queue).
    const outboxPayload = outboxInsert.mock.calls[0][0] as {
      job_type: string;
      payload: { templateName: string };
    };
    expect(outboxPayload.job_type).toBe('send_teacher_signup_otp_wa');
    expect(outboxPayload.payload.templateName).toBe(TEACHER_SIGNUP_OTP_TEMPLATE);
  });

  it('non-prod dev echo: returns the real code and it matches the stored hash', async () => {
    process.env.TEACHER_SIGNUP_OTP_TEST_ECHO = '1'; // VERCEL_ENV unset -> non-prod
    const res = await POST(makeRequest({ phone: '01012345678' }));
    const body = (await res.json()) as { devCode?: string };
    expect(body.devCode).toMatch(/^\d{6}$/);
    const otpPayload = otpInsert.mock.calls[0][0] as { code_hash: string };
    expect(hashOtp(body.devCode as string)).toBe(otpPayload.code_hash);
  });

  it('dev echo NEVER fires in production even with the flag set', async () => {
    process.env.VERCEL_ENV = 'production';
    process.env.TEACHER_SIGNUP_OTP_TEST_ECHO = '1';
    const res = await POST(makeRequest({ phone: '01012345678' }));
    const body = (await res.json()) as { devCode?: string };
    expect(body.devCode).toBeUndefined();
  });

  it('rate limited -> 429', async () => {
    mockRateLimit.mockResolvedValueOnce({ success: false, remaining: 0, reset: 0 });
    const res = await POST(makeRequest({ phone: '01012345678' }));
    expect(res.status).toBe(429);
    expect(otpInsert).not.toHaveBeenCalled();
  });
});
