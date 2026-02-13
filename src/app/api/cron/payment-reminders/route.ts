import { NextRequest, NextResponse } from 'next/server';

function verifyCronRequest(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return false;
  }
  return true;
}

// WhatsApp integration removed. Cron kept for future use.
// To re-enable, configure WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.
export async function GET(req: NextRequest) {
  try {
    if (!verifyCronRequest(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      totalSent: 0,
      centersProcessed: 0,
      results: [],
      message: 'WhatsApp reminders disabled. Contact support@centerhq.com to enable.',
    });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
