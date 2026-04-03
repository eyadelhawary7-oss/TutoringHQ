/**
 * Cron: Meta debug_token for WHATSAPP_TOKEN — alert CEO if expiring within 7 days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const inputToken = process.env.WHATSAPP_TOKEN;
  const appId = process.env.WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  if (!inputToken || !appId || !appSecret) {
    return NextResponse.json({ error: 'Missing WhatsApp/Meta configuration' }, { status: 500 });
  }

  const accessToken = `${appId}|${appSecret}`;
  const url = new URL('https://graph.facebook.com/debug_token');
  url.searchParams.set('input_token', inputToken);
  url.searchParams.set('access_token', accessToken);

  let json: unknown;
  try {
    const res = await fetch(url.toString(), { cache: 'no-store' });
    json = await res.json();
  } catch (e) {
    console.error('[check-token-health] fetch debug_token:', e);
    return NextResponse.json({ error: 'Failed to reach Meta API' }, { status: 502 });
  }

  const root = json as { error?: { message?: string }; data?: { expires_at?: number | null } };
  if (root.error) {
    console.error('[check-token-health] Meta error:', root.error);
    return NextResponse.json(
      { error: root.error.message ?? 'Meta debug_token error' },
      { status: 502 },
    );
  }

  const expiresAt = root.data?.expires_at;

  if (expiresAt == null || expiresAt === 0) {
    return NextResponse.json({ status: 'permanent', skipped: true }, { status: 200 });
  }

  const nowSec = Date.now() / 1000;
  const thresholdSec = nowSec + SEVEN_DAYS_SEC;

  if (expiresAt >= thresholdSec) {
    return NextResponse.json({ status: 'ok', expires_at: expiresAt }, { status: 200 });
  }

  const dateAr = new Date(expiresAt * 1000).toLocaleDateString('ar-EG', {
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

  return NextResponse.json(
    { status: 'expiring_soon', expires_at: expiresAt, alert_sent: alertSent },
    { status: 200 },
  );
}
