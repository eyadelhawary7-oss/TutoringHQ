/**
 * WhatsApp Cloud API — inbound webhook (Automation 8a + 8b).
 * Public route: GET verification, POST inbound (signature-verified when secret set).
 * POST always responds 200 JSON so Meta does not retry.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { sendFreeformMessage } from '@/lib/whatsapp/client';
import { normalizeWhatsAppNumber, sendWhatsAppMessage } from '@/lib/whatsapp';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    triggers: ['باقة الواتساب', 'whatsapp pack', 'إشعارات الأهالي'],
    response: 'باقة واتساب الأهالي بـ 12 جنيه/ولي أمر/شهر. فعّلها من الإعدادات > الإشعارات.',
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
    response: 'باقاتنا تبدأ من 1,999 جنيه/شهر. زور centerhq.app لتفاصيل كل باقة.',
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

export async function POST(request: Request) {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return postOk();
  }

  if (!verifyMetaSignature(rawBody, request)) {
    return postOk();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return postOk();
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
    return postOk();
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
    return postOk();
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

  return postOk();
}
