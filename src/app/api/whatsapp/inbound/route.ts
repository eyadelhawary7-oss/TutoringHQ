/**
 * WhatsApp Cloud API — inbound webhook (Automation 8a + 8b).
 * Public route: GET verification, POST inbound (HMAC fail-closed; same verification
 * pattern as /api/whatsapp/webhook). POST responds 200 JSON on success so Meta does not retry.
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { readRawBodyWithLimit, ValidationError } from '@/lib/validate';
import { hmacSha256Hex, timingSafeEqualUtf8 } from '@/lib/verifyHmac';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { normalizeWhatsAppNumber, sendWhatsAppMessage } from '@/lib/whatsapp';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { formatCurrency } from '@/lib/formatNumber';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WA_BODY_LIMIT = 64 * 1024;

const FAQ_PATTERNS = [
  {
    triggers: ['كيف أضيف طالب', 'add student', 'إضافة طالب'],
    response:
      'لإضافة طالب: افتح التطبيق > الطلاب > إضافة طالب. تحتاج الاسم والرقم فقط.',
    key: 'add_student',
  },
  {
    triggers: ['كيف أسجل حضور', 'attendance', 'سكان', 'scan'],
    response: 'لتسجيل الحضور: افتح السكانر من القائمة الرئيسية وامسح QR كود الطالب.',
    key: 'attendance',
  },
  {
    triggers: ['نسيت رمز', 'forgot pin', 'PIN', 'كلمة السر'],
    response:
      'لإعادة تعيين الرمز: centerhq.app/ar/forgot-password — ستصلك رسالة على رقمك.',
    key: 'forgot_pin',
  },
  {
    triggers: ['كيف أجدد', 'renewal', 'تجديد', 'فاتورة'],
    response: 'التجديد يتم تلقائياً. ستصلك رسالة قبل 7 أيام من موعد التجديد.',
    key: 'renewal',
  },
  {
    triggers: ['باقة واتساب', 'باقة الواتساب', 'حزمة واتساب', 'whatsapp pack', 'إشعارات الأهالي'],
    response: `باقة واتساب الأهالي بـ ${formatCurrency(12, 'ar')}/ولي أمر/شهر. فعّلها من الإعدادات > الإشعارات.`,
    key: 'wa_pack',
  },
  {
    triggers: ['كيف أضيف مجموعة', 'group', 'مجموعة', 'فصل'],
    response:
      'لإضافة مجموعة: افتح التطبيق > المجموعات > إضافة مجموعة. حدد المادة والمعلم والوقت.',
    key: 'add_group',
  },
  {
    triggers: ['السعر', 'price', 'اشتراك', 'باقات'],
    response: `باقاتنا تبدأ من ${formatCurrency(1999, 'ar')}/شهر. زور centerhq.app لتفاصيل كل باقة.`,
    key: 'pricing',
  },
  {
    triggers: ['مشكلة', 'problem', 'error', 'خطأ', 'bug'],
    response: 'عذراً لهذه المشكلة. سيتواصل معك فريقنا خلال ساعات.',
    key: 'problem',
  },
  {
    triggers: ['كيف أطبع كروت', 'print', 'بطاقات', 'QR كروت'],
    response:
      'لطباعة كروت QR: الطلاب > طباعة الكروت. يمكنك اختيار عدد الكروت وإرسالها للطباعة.',
    key: 'print_cards',
  },
  {
    triggers: ['تواصل', 'contact', 'كلم', 'speak'],
    response: 'فريقنا متاح طوال أيام الأسبوع. سيرد عليك أحد المختصين قريباً.',
    key: 'contact',
  },
] as const;

function postOk(): NextResponse {
  return NextResponse.json({ ok: true }, { status: 200 });
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

function lastDigitsForMatch(fromRaw: string, len = 10): string {
  const digits = fromRaw.replace(/\D/g, '');
  return digits.length >= len ? digits.slice(-len) : digits;
}

type MetaMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
};

function extractMetaMessageId(payload: Record<string, unknown>): string | null {
  try {
    const entry = (payload.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
    const changes = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
    const value = changes?.value as Record<string, unknown> | undefined;
    const messages = value?.messages as unknown[] | undefined;
    const msg0 = messages?.[0] as Record<string, unknown> | undefined;
    const id = msg0?.id;
    if (id === null || id === undefined) return null;
    return typeof id === 'string' ? id : String(id);
  } catch {
    return null;
  }
}

async function resolveCenterForInbound(
  admin: NonNullable<typeof supabaseAdmin>,
  fromRaw: string,
): Promise<string | null> {
  const suffix = lastDigitsForMatch(fromRaw);
  if (!suffix) return null;
  const pattern = `%${suffix}%`;

  const { data: centerRow, error: cErr } = await admin
    .from('centers')
    .select('id')
    .ilike('phone', pattern)
    .limit(1)
    .maybeSingle();
  if (cErr) {
    console.error('[whatsapp-inbound] centers lookup:', cErr.message);
  } else if (centerRow && typeof (centerRow as { id?: string }).id === 'string') {
    return (centerRow as { id: string }).id;
  }

  const { data: userRow, error: uErr } = await admin
    .from('users')
    .select('center_id')
    .eq('role', 'owner')
    .not('center_id', 'is', null)
    .ilike('phone', pattern)
    .limit(1)
    .maybeSingle();
  if (uErr) {
    console.error('[whatsapp-inbound] users lookup:', uErr.message);
    return null;
  }
  const cid = (userRow as { center_id?: string | null } | null)?.center_id;
  return typeof cid === 'string' ? cid : null;
}

/** Outbound wa_message_queue requires a real center_id; use direct Graph when none. */
async function sendInboundText(centerId: string | null, toRaw: string, body: string): Promise<void> {
  try {
    if (centerId) {
      await sendFreeformMessage(centerId, toRaw, body);
    } else {
      const ok = await sendWhatsAppMessage(normalizeWhatsAppNumber(toRaw), body);
      if (!ok) {
        console.warn('[whatsapp-inbound] WhatsApp fallback send failed (no center_id for queue)');
      }
    }
  } catch (e) {
    console.error('[whatsapp-inbound] outbound text failed:', e);
  }
}

async function processInboundMessage(payload: Record<string, unknown>): Promise<void> {
  const b = payload as {
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
    return;
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
    return;
  }

  const messageText = message.text?.body ?? '';

  let centerId: string | null = null;
  if (admin) {
    centerId = await resolveCenterForInbound(admin, fromPhone);
  }

  const logId = await insertLog({ messageText, centerId });

  const normalized = messageText
    .toLowerCase()
    .replace(/[^\w\s\u0600-\u06FF]/g, '')
    .trim();

  let matched: (typeof FAQ_PATTERNS)[number] | null = null;
  for (const faq of FAQ_PATTERNS) {
    if (faq.triggers.some((t) => normalized.includes(t.toLowerCase()))) {
      matched = faq;
      break;
    }
  }

  if (matched) {
    await sendInboundText(centerId, fromPhone, matched.response);
    if (logId && admin) {
      const { error: upErr } = await admin
        .from('whatsapp_inbound_log')
        .update({ matched_faq: true, faq_trigger: matched.key })
        .eq('id', logId);
      if (upErr) {
        console.error('[whatsapp-inbound] whatsapp_inbound_log update:', upErr.message);
      }
    }
  } else {
    const salesPhone = process.env.SALES_MANAGER_PHONE?.trim();
    if (salesPhone) {
      const forwardBody = `رسالة واردة من ${fromPhone}: ${messageText}`;
      await sendInboundText(centerId, salesPhone, forwardBody);
    }
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await readRawBodyWithLimit(request, WA_BODY_LIMIT);

    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      Sentry.captureMessage('whatsapp inbound missing WHATSAPP_APP_SECRET', {
        level: 'warning',
        tags: { provider: 'whatsapp', route: 'inbound' },
      });
      return new NextResponse(null, { status: 401 });
    }

    const signatureHeader = request.headers.get('x-hub-signature-256');
    if (!signatureHeader) {
      return new NextResponse(null, { status: 401 });
    }

    const expectedHex = hmacSha256Hex(appSecret, rawBody);
    const expectedSignature = `sha256=${expectedHex}`;
    const receivedNorm = signatureHeader.trim().toLowerCase();
    const expectedNorm = expectedSignature.toLowerCase();
    if (!timingSafeEqualUtf8(receivedNorm, expectedNorm)) {
      Sentry.captureMessage('WhatsApp inbound signature mismatch', {
        level: 'warning',
        tags: { provider: 'whatsapp', route: 'inbound' },
      });
      return new NextResponse(null, { status: 401 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new NextResponse(null, { status: 401 });
    }

    try {
      const messageId = extractMetaMessageId(payload);

      if (messageId && supabaseAdmin) {
        const idempotencyKey = 'meta:' + messageId;

        const { data: existing } = await supabaseAdmin
          .from('webhook_inbox')
          .select('id, processed')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existing && (existing as { processed?: boolean }).processed === true) {
          return postOk();
        }

        await supabaseAdmin.from('webhook_inbox').upsert(
          {
            idempotency_key: idempotencyKey,
            source: 'meta',
            payload,
            processed: false,
          },
          { onConflict: 'idempotency_key' },
        );

        await processInboundMessage(payload);

        await supabaseAdmin
          .from('webhook_inbox')
          .update({
            processed: true,
            processed_at: new Date().toISOString(),
          })
          .eq('idempotency_key', idempotencyKey);
      } else {
        await processInboundMessage(payload);
      }

      return postOk();
    } catch (handlerErr) {
      console.error('[whatsapp-inbound] handler error:', handlerErr);
      return postOk();
    }
  } catch (e) {
    if (e instanceof ValidationError && e.message === 'Request payload too large') {
      Sentry.captureMessage('whatsapp inbound payload limit exceeded', {
        level: 'warning',
        tags: { provider: 'whatsapp', route: 'inbound' },
      });
      return new NextResponse(null, { status: 413 });
    }
    Sentry.captureException(e, { tags: { provider: 'whatsapp', route: 'inbound' } });
    return new NextResponse(null, { status: 401 });
  }
}
