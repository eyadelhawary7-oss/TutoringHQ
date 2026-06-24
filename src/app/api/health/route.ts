import { NextResponse } from 'next/server';
import { getPaymobApiKey } from '@/lib/paymobConfig';

export const dynamic = 'force-dynamic';

/**
 * Lightweight health JSON for uptime / env sanity. Always HTTP 200; never throws.
 */
export async function GET() {
  try {
    return NextResponse.json(
      {
        ok: true,
        t: Date.now(),
        status: 'ok',
        timestamp: new Date().toISOString(),
        paymob_mode: getPaymobApiKey()?.startsWith('Key_') ? 'live' : 'sandbox',
        wa_mode:
          process.env.WHATSAPP_PHONE_NUMBER_ID === '1013787185158313' ? 'test' : 'live',
        wa_secret_configured: !!process.env.WHATSAPP_APP_SECRET,
        wa_verify_token_configured: !!(
          process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        ),
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        t: Date.now(),
        status: 'ok',
        timestamp: new Date().toISOString(),
        paymob_mode: 'sandbox',
        wa_mode: 'live',
        version: 'local',
      },
      { status: 200 },
    );
  }
}
