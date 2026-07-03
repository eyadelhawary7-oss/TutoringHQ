import { describe, it, expect, vi } from 'vitest';

// The handler's default deps pull in centerNotify → supabase-admin ('server-only').
// Tests inject their own deps, so stub the modules out.
vi.mock('@/lib/centerNotify', () => ({
  isTemplateApproved: vi.fn(),
  waSendingEnabled: vi.fn(),
}));
vi.mock('@/lib/nudges/send', () => ({ sendNudgeWhatsapp: vi.fn() }));

import { processOtpWaOutboxJob, type OtpOutboxDeps } from '@/lib/otpOutboxHandler';
import type { SupabaseClient } from '@supabase/supabase-js';

const admin = {} as SupabaseClient;

function makeDeps(over: Partial<{ approved: boolean; enabled: boolean; sendError: string | null }> = {}) {
  const send = vi.fn(async () => ({ wabaMessageId: 'wamid.1' }));
  if (over.sendError) send.mockRejectedValue(new Error(over.sendError));
  const deps: OtpOutboxDeps = {
    isApproved: vi.fn(async () => over.approved ?? true),
    sendingEnabled: vi.fn(async () => over.enabled ?? true),
    send,
  };
  return { deps, send };
}

describe('processOtpWaOutboxJob', () => {
  it('sends an enrollment OTP with params in payload order and ar_EG language', async () => {
    const { deps, send } = makeDeps();
    const ok = await processOtpWaOutboxJob(
      {
        toPhone: '+201234567890',
        templateName: 'chq_enrollment_otp',
        params: ['مجموعة الفيزياء', '123456'],
      },
      admin,
      deps,
    );
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith({
      toPhone: '+201234567890',
      templateName: 'chq_enrollment_otp',
      params: ['مجموعة الفيزياء', '123456'],
      languageCode: 'ar_EG',
    });
  });

  it('sends a teacher-signup OTP (single param)', async () => {
    const { deps, send } = makeDeps();
    const ok = await processOtpWaOutboxJob(
      { toPhone: '+201098765432', templateName: 'chq_teacher_signup_otp', params: ['654321'] },
      admin,
      deps,
    );
    expect(ok).toBe(true);
    expect(send).toHaveBeenCalledWith({
      toPhone: '+201098765432',
      templateName: 'chq_teacher_signup_otp',
      params: ['654321'],
      languageCode: 'ar_EG',
    });
  });

  it('throws when the template is not APPROVED (retry/dead-letter, not silent skip)', async () => {
    const { deps, send } = makeDeps({ approved: false });
    await expect(
      processOtpWaOutboxJob(
        { toPhone: '+201234567890', templateName: 'chq_enrollment_otp', params: ['x', 'y'] },
        admin,
        deps,
      ),
    ).rejects.toThrow('template_not_approved');
    expect(send).not.toHaveBeenCalled();
  });

  it('throws when wa_sending_enabled is off', async () => {
    const { deps, send } = makeDeps({ enabled: false });
    await expect(
      processOtpWaOutboxJob(
        { toPhone: '+201234567890', templateName: 'chq_enrollment_otp', params: ['x', 'y'] },
        admin,
        deps,
      ),
    ).rejects.toThrow('wa_sending_disabled');
    expect(send).not.toHaveBeenCalled();
  });

  it('treats a malformed payload (missing phone/template) as done without sending', async () => {
    const { deps, send } = makeDeps();
    expect(await processOtpWaOutboxJob({}, admin, deps)).toBe(true);
    expect(await processOtpWaOutboxJob(null, admin, deps)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('propagates send failures so process-outbox retries', async () => {
    const { deps } = makeDeps({ sendError: 'whatsapp_send_failed_500: boom' });
    await expect(
      processOtpWaOutboxJob(
        { toPhone: '+201234567890', templateName: 'chq_enrollment_otp', params: ['x', 'y'] },
        admin,
        deps,
      ),
    ).rejects.toThrow('whatsapp_send_failed_500');
  });
});
