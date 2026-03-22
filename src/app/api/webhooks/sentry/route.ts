import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import crypto from 'crypto';

function verifySentrySignature(body: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(body, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(digest)
    );
  } catch {
    return false;
  }
}

function truncate(str: string | undefined | null, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const sentrySecret = process.env.SENTRY_WEBHOOK_SECRET;
  if (sentrySecret) {
    const signature = request.headers.get('sentry-hook-signature') || '';
    if (!verifySentrySignature(rawBody, signature, sentrySecret)) {
      console.warn('[Sentry Webhook] Invalid signature — rejecting');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = payload?.action as string | undefined;

  if (!action || !['created', 'triggered'].includes(action)) {
    return NextResponse.json({ skipped: true, action: action ?? 'unknown' });
  }

  const issue = (payload?.data as Record<string, unknown>)?.issue as Record<string, unknown> | undefined ?? {};
  const title = truncate(issue?.title as string, 80);
  const culprit = truncate(issue?.culprit as string, 60);
  const level = ((issue?.level as string) || 'error').toUpperCase();
  const issueUrl = (issue?.permalink || issue?.web_url || '') as string;
  const levelEmoji = level === 'FATAL' ? '🔴' : level === 'ERROR' ? '🟠' : '🟡';

  const lines: string[] = [
    `${levelEmoji} *CenterHQ Alert*`,
    '',
    `*${level}* — ${title}`,
  ];
  if (culprit) lines.push(`📍 ${culprit}`);
  if (issueUrl) lines.push('', `🔗 ${issueUrl}`);
  lines.push('', `_تحقق فوراً إذا كانت تؤثر على السكانر أو المدفوعات_`);

  const message = lines.join('\n');

  const rawAdminPhone = process.env.ADMIN_WHATSAPP_NUMBER;
  if (!rawAdminPhone) {
    console.warn('[Sentry Webhook] ADMIN_WHATSAPP_NUMBER not set');
    return NextResponse.json({ sent: false, reason: 'No admin phone configured' });
  }

  const adminPhone = rawAdminPhone
    .replace(/^\+/, '')
    .replace(/^0(\d{10})$/, '20$1');

  const sent = await sendWhatsAppMessage(adminPhone, message);
  return NextResponse.json({ sent, level, title });
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'centerhq-sentry-webhook' });
}
