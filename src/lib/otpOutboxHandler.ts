// process-outbox handler for the two phone-OTP job types:
//   - send_enrollment_otp_wa     (student self-enrollment: /api/join/g/[groupId]/send-otp)
//   - send_teacher_signup_otp_wa (teacher signup: /api/auth/teacher/signup/send-otp)
//
// Both enqueue { toPhone, templateName, params } into webhook_outbox. Delivery
// goes through the center-agnostic nudge sender: these flows have no center_id,
// so they cannot use whatsapp/client.sendTemplateMessage (wa_message_queue's
// center_id is NOT NULL). Throws on any failure so process-outbox applies its
// retry → dead-letter path — an undeliverable OTP blocks a live signup or
// enrollment and must surface loudly, never be silently marked done.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isTemplateApproved, waSendingEnabled } from '@/lib/centerNotify';
import { sendNudgeWhatsapp } from '@/lib/nudges/send';

export const ENROLLMENT_OTP_JOB_TYPE = 'send_enrollment_otp_wa';

interface OtpWaJobPayload {
  toPhone?: string;
  templateName?: string;
  params?: string[];
}

export interface OtpOutboxDeps {
  isApproved: typeof isTemplateApproved;
  sendingEnabled: typeof waSendingEnabled;
  send: typeof sendNudgeWhatsapp;
}

const defaultDeps: OtpOutboxDeps = {
  isApproved: isTemplateApproved,
  sendingEnabled: waSendingEnabled,
  send: sendNudgeWhatsapp,
};

export async function processOtpWaOutboxJob(
  payload: unknown,
  admin: SupabaseClient,
  deps: OtpOutboxDeps = defaultDeps,
): Promise<boolean> {
  const { toPhone, templateName, params } = (payload ?? {}) as OtpWaJobPayload;
  if (!toPhone || !templateName) {
    // Malformed job — nothing sendable; treat as done (matches the
    // billing-nudge handler's contract for missing phone/template).
    return true;
  }

  // Same gates as every other template send: the platform kill switch and the
  // wa_meta_templates approval row. Throw rather than skip — a gated OTP still
  // has a user waiting on it, so it must retry and then dead-letter visibly.
  if (!(await deps.sendingEnabled(admin))) {
    throw new Error('wa_sending_disabled');
  }
  if (!(await deps.isApproved(templateName, admin))) {
    throw new Error('template_not_approved');
  }

  // Both OTP templates are Arabic (EGY).
  await deps.send({ toPhone, templateName, params: params ?? [], languageCode: 'ar_EG' });
  return true;
}
