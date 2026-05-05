import type { SupabaseClient } from '@supabase/supabase-js';
import { isTemplateApproved } from '@/lib/centerNotify';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getAdminOrSupportWhatsAppDigits } from '@/lib/supportWhatsApp';

/** Gate freeform vendor-failure admin alerts on vendor pipeline template approval in Meta registry. */
const VENDOR_FAILURE_WA_TEMPLATE = 'chq_vendor_new_order';

const WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313';

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function shouldSkipWaForTestPhoneId(): boolean {
  const phoneId = waPhoneNumberId();
  return !phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID;
}

async function waSendingEnabled(supabase: SupabaseClient): Promise<boolean> {
  const { data: cfg } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  return cfg?.value !== false;
}

interface AdminFailureOpts {
  ref: string;
  quantity: number;
  orderId: string;
  reason: string;
}

export async function notifyAdminOfVendorFailure(opts: AdminFailureOpts): Promise<void> {
  try {
    const adminTo = getAdminOrSupportWhatsAppDigits();
    if (!adminTo) {
      console.warn(
        '[notifyAdminFailure] Set ADMIN_WHATSAPP_NUMBER or NEXT_PUBLIC_SUPPORT_WHATSAPP to enable admin WhatsApp alerts',
      );
      return;
    }

    const messageBody = [
      '⚠️ تنبيه — CenterHQ',
      '',
      'فشل إرسال طلب الطباعة للمورد تلقائياً',
      `رقم الطلب: ${opts.ref}`,
      `عدد البطاقات: ${opts.quantity}`,
      `السبب: ${opts.reason}`,
      '',
      '⚡ يرجى التواصل مع المورد يدوياً وإرسال ملف البطاقات',
    ].join('\n');

    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseAdmin();
    } catch {
      console.warn('[notifyAdminFailure] skipped — Supabase admin client not configured');
      return;
    }

    if (!(await isTemplateApproved(VENDOR_FAILURE_WA_TEMPLATE, supabase))) {
      console.warn(
        `[notifyAdminFailure] skipped — template not approved: ${VENDOR_FAILURE_WA_TEMPLATE}`,
      );
      return;
    }

    if (!(await waSendingEnabled(supabase))) {
      console.warn('[notifyAdminFailure] skipped — wa_sending_enabled is false');
      return;
    }

    if (shouldSkipWaForTestPhoneId()) {
      console.warn(
        '[notifyAdminFailure] skipped — Meta test PHONE_NUMBER_ID or missing phone number ID',
      );
      return;
    }

    const graphPhoneId = waPhoneNumberId();
    const token = process.env.WHATSAPP_TOKEN;
    if (!graphPhoneId || !token) {
      console.warn('[notifyAdminFailure] skipped — missing WHATSAPP_TOKEN or phone number ID');
      return;
    }

    const res = await fetch(`https://graph.facebook.com/v18.0/${graphPhoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: adminTo,
        type: 'text',
        text: { body: messageBody },
      }),
    });

    if (!res.ok) {
      console.error('[notifyAdminFailure] Failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[notifyAdminFailure] Unexpected error:', err);
    // Never throw
  }
}
