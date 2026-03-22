/**
 * CEO daily briefing — 7am UTC (9am Cairo)
 * Sends chq_ceo_briefing template to CEO_PHONE
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendCeoBriefing, fetchCeoBriefingData } from '@/lib/whatsapp/flows/ceoBriefing';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!process.env.CEO_PHONE) {
    return NextResponse.json({ ok: false, error: 'CEO_PHONE not set' }, { status: 500 });
  }

  try {
    const data = await fetchCeoBriefingData();
    const result = await sendCeoBriefing(data);

    if (!result.success) {
      console.error('[ceo-briefing] Send failed:', result.error);
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error('[ceo-briefing] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
