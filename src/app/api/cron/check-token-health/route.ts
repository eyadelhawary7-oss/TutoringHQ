/**
 * Cron: Meta debug_token for WHATSAPP_TOKEN — alert CEO if expiring within 7 days.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { formatDate } from '@/lib/formatNumber';

export const dynamic = 'force-dynamic';

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

export async function POST(request: Request) {
  const cronStart = Date.now();
  const CRON_NAME = 'check-token-health';

  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ success: false }, { status: 200 });
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: pausedRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'cron_paused')
    .maybeSingle();
  if (pausedRow?.value === true) {
    return NextResponse.json({ skipped: 'cron_paused' }, { status: 200 });
  }

  try {
    const inputToken = process.env.WHATSAPP_TOKEN;
    const appId = process.env.WHATSAPP_APP_ID;
    const appSecret = process.env.WHATSAPP_APP_SECRET;

    if (!inputToken || !appId || !appSecret) {
      throw new Error('Missing WhatsApp/Meta configuration');
    }

    const accessToken = `${appId}|${appSecret}`;
    const metaUrl = new URL('https://graph.facebook.com/debug_token');
    metaUrl.searchParams.set('input_token', inputToken);
    metaUrl.searchParams.set('access_token', accessToken);

    let json: unknown;
    const res = await fetch(metaUrl.toString(), { cache: 'no-store' });
    json = await res.json();

    const root = json as { error?: { message?: string }; data?: { expires_at?: number | null } };
    if (root.error) {
      throw new Error(root.error.message ?? 'Meta debug_token error');
    }

    const expiresAt = root.data?.expires_at;
    let recordsProcessed = 0;
    let extra: Record<string, unknown> = {};

    if (expiresAt == null || expiresAt === 0) {
      extra = { status: 'permanent', skipped: true };
    } else {
      const nowSec = Date.now() / 1000;
      const thresholdSec = nowSec + SEVEN_DAYS_SEC;

      if (expiresAt >= thresholdSec) {
        extra = { status: 'ok', expires_at: expiresAt };
        recordsProcessed = 1;
      } else {
        const dateAr = formatDate(new Date(expiresAt * 1000), 'ar', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'Africa/Cairo',
        });

        const message = `⚠️ تنبيه: رمز WhatsApp سينتهي قريباً
ينتهي في: ${dateAr}
يرجى تجديده قبل انتهاء الصلاحية لتجنب انقطاع الخدمة.`;

        const ceoRaw = process.env.CEO_PHONE;
        const digits = ceoRaw?.replace(/\D/g, '') ?? '';
        const alertSent = digits ? await sendWhatsAppMessage(digits, message) : false;

        extra = { status: 'expiring_soon', expires_at: expiresAt, alert_sent: alertSent };
        recordsProcessed = 1;
      }
    }

    await supabase.from('cron_log').insert({
      cron_name: CRON_NAME,
      status: 'success',
      duration_ms: Date.now() - cronStart,
      records_processed: recordsProcessed,
      metadata: extra,
    });

    try {
      if (supabaseAdmin) {
        await supabaseAdmin.from('cron_health_log').upsert(
          {
            cron_name: 'check-token-health',
            last_success_at: new Date().toISOString(),
            failure_count: 0,
          },
          { onConflict: 'cron_name' },
        );
      }
    } catch (healthLogErr) {
      console.error('[check-token-health] cron_health_log:', healthLogErr);
    }

    return NextResponse.json({ success: true, ...extra });
  } catch (error) {
    console.error(`[${CRON_NAME}] Error:`, error);
    try {
      await supabase.from('cron_log').insert({
        cron_name: CRON_NAME,
        status: 'failure',
        duration_ms: Date.now() - cronStart,
        error_message: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown',
      });
    } catch (logErr) {
      console.error(`[${CRON_NAME}] cron_log:`, logErr);
    }
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
