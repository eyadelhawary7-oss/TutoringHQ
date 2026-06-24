// process-outbox handler for `send_billing_nudge_wa` jobs. Sends the nudge
// WhatsApp template and, on success, stamps the ledger row 'sent'. Throws on
// send failure so process-outbox applies its existing retry → dead-letter logic.

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendNudgeWhatsapp } from './send';

interface NudgeWaJobPayload {
  nudgeId?: string;
  toPhone?: string;
  templateName?: string;
  params?: string[];
}

export async function processBillingNudgeWaOutboxJob(
  payload: unknown,
  admin: SupabaseClient,
): Promise<boolean> {
  const { nudgeId, toPhone, templateName, params } = (payload ?? {}) as NudgeWaJobPayload;
  if (!toPhone || !templateName) {
    // Malformed job — nothing to send. Mark sent? No: record skipped, treat done.
    if (nudgeId) {
      await admin
        .from('billing_nudges')
        .update({
          channel_whatsapp_status: 'skipped',
          whatsapp_error: 'missing_phone_or_template',
          updated_at: new Date().toISOString(),
        })
        .eq('id', nudgeId);
    }
    return true;
  }

  // Throws on any failure → process-outbox retries / dead-letters the job.
  await sendNudgeWhatsapp({ toPhone, templateName, params: params ?? [] });

  if (nudgeId) {
    await admin
      .from('billing_nudges')
      .update({ channel_whatsapp_status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', nudgeId);
  }
  return true;
}
