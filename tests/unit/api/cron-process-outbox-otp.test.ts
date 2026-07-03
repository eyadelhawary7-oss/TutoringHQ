import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.CRON_SECRET = 'cron-secret-123';

type Row = Record<string, unknown>;

let queuedJobs: Row[] = [];
const updates: { table: string; payload: Row; id?: unknown }[] = [];

// Minimal thenable query-builder fake covering the chains process-outbox uses:
//   select('*').in().lte().order().limit()          → job fetch
//   update(p).eq('id', id).in('status', …).select() → atomic claim
//   update(p).eq('id', id)                          → done / failed / dead
//   insert(p) / upsert(p)                           → cron_log / cron_health_log
function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  const state: { updatePayload?: Row; id?: unknown } = {};
  const chain = () => builder;
  builder.select = () => {
    if (state.updatePayload !== undefined) {
      // claim path: update().eq().in().select('id')
      return Promise.resolve({ data: [{ id: state.id }], error: null });
    }
    return builder;
  };
  builder.update = (payload: Row) => {
    state.updatePayload = payload;
    return builder;
  };
  builder.eq = (_col: string, value: unknown) => {
    state.id = value;
    if (state.updatePayload !== undefined) {
      updates.push({ table, payload: state.updatePayload, id: value });
    }
    return builder;
  };
  builder.in = chain;
  builder.lte = chain;
  builder.order = chain;
  builder.limit = chain;
  builder.insert = () => Promise.resolve({ error: null });
  builder.upsert = () => Promise.resolve({ error: null });
  builder.then = (resolve: (v: unknown) => unknown) => {
    const result =
      state.updatePayload !== undefined
        ? { error: null }
        : { data: queuedJobs, error: null };
    return Promise.resolve(result).then(resolve);
  };
  return builder;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (table: string) => makeBuilder(table) },
}));

const sendNudgeWhatsapp = vi.fn(async () => ({ wabaMessageId: 'wamid.test' }));
vi.mock('@/lib/nudges/send', () => ({
  sendNudgeWhatsapp: (...args: unknown[]) => sendNudgeWhatsapp(...(args as [])),
}));

vi.mock('@/lib/centerNotify', () => ({
  isTemplateApproved: vi.fn(async () => true),
  waSendingEnabled: vi.fn(async () => true),
  sendPaymentConfirmed: vi.fn(async () => ({ success: true })),
}));

vi.mock('@/lib/cardOrderNotifications', () => ({
  processCardOrderStatusWaOutboxJob: vi.fn(async () => true),
}));
vi.mock('@/lib/nudges/outboxHandler', () => ({
  processBillingNudgeWaOutboxJob: vi.fn(async () => true),
}));
vi.mock('@/lib/ceo', () => ({ createAction: vi.fn(async () => undefined) }));
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn(),
}));

import { GET } from '@/app/api/cron/process-outbox/route';

function makeRequest(): Request {
  return new Request('http://localhost/api/cron/process-outbox', {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
}

beforeEach(() => {
  queuedJobs = [];
  updates.length = 0;
  sendNudgeWhatsapp.mockClear();
});

describe('GET /api/cron/process-outbox — OTP job types', () => {
  it('picks up a queued OTP of each type, sends it, and marks the row done', async () => {
    queuedJobs = [
      {
        id: 'job-enroll',
        job_type: 'send_enrollment_otp_wa',
        payload: {
          toPhone: '+201234567890',
          templateName: 'chq_enrollment_otp',
          params: ['مجموعة الفيزياء', '123456'],
        },
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
      },
      {
        id: 'job-teacher',
        job_type: 'send_teacher_signup_otp_wa',
        payload: {
          toPhone: '+201098765432',
          templateName: 'chq_teacher_signup_otp',
          params: ['654321'],
        },
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
      },
    ];

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ processed: 2, failed: 0, dead: 0 });

    expect(sendNudgeWhatsapp).toHaveBeenCalledTimes(2);
    expect(sendNudgeWhatsapp).toHaveBeenCalledWith({
      toPhone: '+201234567890',
      templateName: 'chq_enrollment_otp',
      params: ['مجموعة الفيزياء', '123456'],
      languageCode: 'ar_EG',
    });
    expect(sendNudgeWhatsapp).toHaveBeenCalledWith({
      toPhone: '+201098765432',
      templateName: 'chq_teacher_signup_otp',
      params: ['654321'],
      languageCode: 'ar_EG',
    });

    // Neither job may be left in the queue: each is claimed then marked done.
    for (const id of ['job-enroll', 'job-teacher']) {
      const jobUpdates = updates
        .filter((u) => u.table === 'webhook_outbox' && u.id === id)
        .map((u) => u.payload.status);
      expect(jobUpdates).toEqual(['processing', 'done']);
    }
  });

  it('marks an OTP job failed (with retry scheduled) when the send throws', async () => {
    sendNudgeWhatsapp.mockRejectedValueOnce(new Error('whatsapp_send_failed_500: boom'));
    queuedJobs = [
      {
        id: 'job-enroll-fail',
        job_type: 'send_enrollment_otp_wa',
        payload: {
          toPhone: '+201234567890',
          templateName: 'chq_enrollment_otp',
          params: ['مجموعة الفيزياء', '123456'],
        },
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
      },
    ];

    const res = await GET(makeRequest());
    const json = await res.json();

    expect(json).toEqual({ processed: 0, failed: 1, dead: 0 });
    const jobUpdates = updates
      .filter((u) => u.table === 'webhook_outbox' && u.id === 'job-enroll-fail')
      .map((u) => u.payload);
    expect(jobUpdates[0]).toEqual({ status: 'processing' });
    expect(jobUpdates[1]).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      error_message: expect.stringContaining('whatsapp_send_failed_500'),
    });
  });
});
