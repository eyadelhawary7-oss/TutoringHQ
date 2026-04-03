import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Lightweight health JSON for uptime / env sanity. Always HTTP 200; never throws.
 */
export async function GET() {
  try {
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        paymob_mode: process.env.PAYMOB_API_KEY?.startsWith('Key_') ? 'live' : 'sandbox',
        wa_mode:
          process.env.WHATSAPP_PHONE_NUMBER_ID === '1013787185158313' ? 'test' : 'live',
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local',
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json(
      {
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
