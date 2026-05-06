import { NextRequest, NextResponse } from 'next/server';
import { sendScanNotification } from '@/lib/whatsapp/flows/parentNotifications';
import { requireCenterAuth } from '@/lib/centerAuth';
import { parseBodyWithLimit, ValidationError } from '@/lib/validate';

export async function POST(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof ValidationError ? e.message : 'Invalid request body';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const studentId = typeof body.student_id === 'string' ? body.student_id.trim() : '';
  const result =
    (body.result as 'attended' | 'absent' | 'pending_payment' | undefined) ?? 'attended';
  const scannedAtRaw = body.scanned_at;
  const scannedAt =
    typeof scannedAtRaw === 'string' && scannedAtRaw.trim()
      ? scannedAtRaw.trim()
      : new Date().toISOString();

  if (!studentId) {
    return NextResponse.json({ error: 'student_id required' }, { status: 400 });
  }

  try {
    const notification = await sendScanNotification({
      studentId,
      result,
      scannedAt,
      centerId: auth.centerId,
    });
    return NextResponse.json({ ok: true, notification }, { status: 200 });
  } catch (error) {
    console.error('[notify-scan] Error:', error);
    return NextResponse.json(
      {
        ok: true,
        notification: {
          sent: false,
          reason: error instanceof Error ? error.message : 'unexpected_error',
        },
      },
      { status: 200 },
    );
  }
}
