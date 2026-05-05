/**
 * WhatsApp Cloud API client (Direct Meta API — no Twilio, no Respond.io)
 * Env: WHATSAPP_PHONE_ID, WHATSAPP_TOKEN
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isTemplateApproved } from '@/lib/centerNotify';

const API_VERSION = 'v19.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

/** Mirrors centerNotify — Meta test / sandbox phone number ID. */
const WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313';

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

/** Same behavior as centerNotify.shouldSkipWaForTestPhoneId (recipient unused; signature for guard pattern). */
function shouldSkipWaForTestPhoneId(_phone: string): boolean {
  const id = waPhoneNumberId();
  return !id || id === WHATSAPP_META_TEST_PHONE_NUMBER_ID;
}

async function waSendingEnabled(admin: SupabaseClient): Promise<boolean> {
  const { data: cfg } = await admin
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  return cfg?.value !== false;
}

function getConfig() {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!phoneId || !token) {
    throw new Error('WHATSAPP_PHONE_ID and WHATSAPP_TOKEN must be set');
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return { phoneId, token, supabaseUrl, supabaseServiceKey };
}

/**
 * Normalize phone to E.164 Egyptian format: +2XXXXXXXXXX
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('01')) {
    return '+2' + digits;
  }
  if (digits.length === 10 && digits.startsWith('1')) {
    return '+2' + digits;
  }
  if (digits.startsWith('2') && digits.length >= 11) {
    return '+' + digits.slice(0, 12);
  }
  if (digits.length >= 10) {
    return '+2' + digits.slice(-10);
  }
  return '+2' + digits;
}

/**
 * Strip + for Meta API recipient
 */
function toRecipient(phone: string): string {
  const normalized = normalizePhone(phone);
  return normalized.replace(/^\+/, '');
}

function getSupabaseAdmin() {
  const { supabaseUrl, supabaseServiceKey } = getConfig();
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function logToQueue(
  centerId: string,
  toPhone: string,
  opts: {
    templateName?: string;
    variables?: Record<string, string>;
    body?: string;
    status: string;
    wabaMessageId?: string;
    errorMessage?: string;
  }
): Promise<void> {
  const admin = getSupabaseAdmin();
  await admin.from('wa_message_queue').insert({
    center_id: centerId,
    to_phone: toPhone,
    template_name: opts.templateName ?? null,
    variables: opts.variables ?? {},
    body: opts.body ?? null,
    status: opts.status,
    waba_message_id: opts.wabaMessageId ?? null,
    error_message: opts.errorMessage ?? null,
  });
}

export interface SendTemplateResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a template message via WhatsApp Cloud API.
 * Logs outbound to wa_message_queue.
 */
export async function sendTemplateMessage(
  centerId: string,
  to: string,
  templateName: string,
  variables: Record<string, string> = {}
): Promise<SendTemplateResult> {
  const admin = getSupabaseAdmin();
  if (!(await isTemplateApproved(templateName, admin))) {
    return { success: false, error: 'template_not_approved' };
  }
  if (!(await waSendingEnabled(admin))) {
    return { success: false, error: 'wa_sending_disabled' };
  }
  if (shouldSkipWaForTestPhoneId(to)) {
    return { success: false, error: 'skipped_meta_test_phone' };
  }

  const { phoneId, token } = getConfig();
  const recipient = toRecipient(to);
  const normalizedTo = normalizePhone(to);

  const components: { type: string; parameters?: { type: string; text: string }[] }[] = [];
  const varKeys = Object.keys(variables).sort();
  if (varKeys.length > 0) {
    components.push({
      type: 'body',
      parameters: varKeys.map((k) => ({ type: 'text', text: variables[k] })),
    });
  }

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'ar' },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message: string };
    };

    if (!res.ok) {
      const errMsg = data.error?.message ?? `HTTP ${res.status}`;
      await logToQueue(centerId, normalizedTo, {
        templateName,
        variables,
        status: 'failed',
        errorMessage: errMsg,
      });
      return { success: false, error: errMsg };
    }

    const messageId = data.messages?.[0]?.id;
    await logToQueue(centerId, normalizedTo, {
      templateName,
      variables,
      status: 'sent',
      wabaMessageId: messageId ?? undefined,
    });

    return { success: true, messageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logToQueue(centerId, normalizedTo, {
      templateName,
      variables,
      status: 'failed',
      errorMessage: errMsg,
    });
    return { success: false, error: errMsg };
  }
}

export interface SendFreeformResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a freeform text message (within 24hr window).
 * Logs outbound to wa_message_queue.
 */
export async function sendFreeformMessage(
  centerId: string,
  to: string,
  body: string
): Promise<SendFreeformResult> {
  const { phoneId, token } = getConfig();
  const recipient = toRecipient(to);
  const normalizedTo = normalizePhone(to);

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: { body },
  };

  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message: string };
    };

    if (!res.ok) {
      const errMsg = data.error?.message ?? `HTTP ${res.status}`;
      await logToQueue(centerId, normalizedTo, {
        body,
        status: 'failed',
        errorMessage: errMsg,
      });
      return { success: false, error: errMsg };
    }

    const messageId = data.messages?.[0]?.id;
    await logToQueue(centerId, normalizedTo, {
      body,
      status: 'sent',
      wabaMessageId: messageId ?? undefined,
    });

    return { success: true, messageId };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logToQueue(centerId, normalizedTo, {
      body,
      status: 'failed',
      errorMessage: errMsg,
    });
    return { success: false, error: errMsg };
  }
}

/**
 * Mark a message as read.
 */
export async function markMessageRead(messageId: string): Promise<boolean> {
  const { phoneId, token } = getConfig();

  try {
    const res = await fetch(`${GRAPH_BASE}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: { message: string } };
      console.error('[WhatsApp] markMessageRead failed:', data.error?.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[markMessageRead] failed:', err);
    return false;
  }
}
