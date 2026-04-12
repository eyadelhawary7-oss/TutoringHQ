/**
 * WhatsApp Cloud API — inbound webhook (Automation 8a).
 * Public route: GET verification, POST inbound (signature-verified when secret set).
 * Always responds 200 on POST so Meta does not retry.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function okBody(body = 'OK'): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

function verifyMetaSignature(rawBody: string, request: Request): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
  if (!appSecret) {
    console.warn(
      '[whatsapp-inbound] WHATSAPP_APP_SECRET is not set; webhook HMAC verification skipped',
    );
    return true;
  }

  const sig = request.headers.get('x-hub-signature-256') ?? '';
  const expected =
    'sha256=' + createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    console.warn('[whatsapp-inbound] Invalid x-hub-signature-256');
    return false;
  }
  return true;
}

function lastDigitsForMatch(fromRaw: string, len = 10): string {
  const digits = fromRaw.replace(/\D/g, '');
  return digits.length >= len ? digits.slice(-len) : digits;
}

type MetaMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
};

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return okBody();
  }

  if (!verifyMetaSignature(rawBody, request)) {
    return okBody();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return okBody();
  }

  const b = body as {
    entry?: Array<{
      changes?: Array<{
        value?: { messages?: MetaMessage[] };
      }>;
    }>;
  };

  const entry = b?.entry?.[0];
  const change = entry?.changes?.[0];
  const message = change?.value?.messages?.[0];

  if (!message) {
    return okBody();
  }

  const fromPhone = String(message.from ?? '');
  const admin = supabaseAdmin;

  async function insertLog(opts: {
    messageText: string;
    centerId: string | null;
  }): Promise<string | null> {
    if (!admin) {
      console.warn('[whatsapp-inbound] supabaseAdmin not configured; skip log insert');
      return null;
    }
    const { data, error } = await admin
      .from('whatsapp_inbound_log')
      .insert({
        from_phone: fromPhone,
        message_text: opts.messageText,
        center_id: opts.centerId,
        matched_faq: false,
        received_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[whatsapp-inbound] whatsapp_inbound_log insert:', error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  }

  if (message.type !== 'text') {
    await insertLog({ messageText: '', centerId: null });
    return okBody();
  }

  const messageText = message.text?.body ?? '';

  const suffix = lastDigitsForMatch(fromPhone);
  let centerId: string | null = null;
  if (suffix && admin) {
    const pattern = `%${suffix}%`;
    const { data: row, error: qErr } = await admin
      .from('centers')
      .select('id')
      .ilike('owner_phone', pattern)
      .limit(1)
      .maybeSingle();
    if (qErr) {
      console.error('[whatsapp-inbound] centers lookup:', qErr.message);
    } else if (row && typeof (row as { id?: string }).id === 'string') {
      centerId = (row as { id: string }).id;
    }
  }

  await insertLog({ messageText, centerId });

  return okBody();
}
