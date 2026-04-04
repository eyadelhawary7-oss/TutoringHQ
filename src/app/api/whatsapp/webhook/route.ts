/**
 * WhatsApp Cloud API webhook (Direct Meta API)
 * GET: verify token
 * POST: handle statuses + inbound messages (signature-verified, fast 200)
 * Env: WHATSAPP_VERIFY_TOKEN or WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizePhone,
  sendFreeformMessage,
  sendTemplateMessage,
} from '@/lib/whatsapp/client';
import { pauseOnboardingFlow } from '@/lib/whatsapp/flows/onboarding';
import { handleVendorReadySignal, isVendorInboundPhone } from '@/lib/vendorWebhook';

/*
 * ⚠️ WHATSAPP_APP_SECRET SETUP
 *
 * Current Vercel env var WHATSAPP_APP_SECRET is incorrect.
 * To fix:
 *   1. Go to Meta Developer Console:
 *      https://developers.facebook.com/apps/258060157715714098/settings/basic/
 *   2. Copy "App Secret" (click Show)
 *   3. Run: vercel env rm WHATSAPP_APP_SECRET production
 *      Then: vercel env add WHATSAPP_APP_SECRET production
 *      Paste the correct value
 *   4. Redeploy: vercel --prod
 *
 * Until fixed: all incoming WA messages return 403
 * This does NOT block outgoing messages
 */

const HOLDING_HOURS = 4;

/** Meta sends sha256=<hex> (64 hex chars), not base64. */
function hexSignatureToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error('Invalid X-Hub-Signature-256 format');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Verify X-Hub-Signature-256 using HMAC-SHA256 (Edge-compatible crypto.subtle).
 * Meta: prefix sha256= then HMAC-SHA256(body) as lowercase hex. Timing-safe compare.
 */
async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<void> {
  if (!secret || !signatureHeader) {
    throw new Error('Missing signature or WHATSAPP_APP_SECRET');
  }
  const expectedHex = signatureHeader.replace(/^sha256=/i, '').trim();
  if (!expectedHex) throw new Error('Invalid X-Hub-Signature-256 format');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const rawBytes = new TextEncoder().encode(rawBody);
  const signature = await crypto.subtle.sign('HMAC', key, rawBytes);
  const computedBytes = new Uint8Array(signature);
  const expectedBytes = hexSignatureToBytes(expectedHex);

  if (expectedBytes.length !== computedBytes.length) {
    throw new Error('Signature mismatch');
  }
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ computedBytes[i];
  }
  if (diff !== 0) {
    throw new Error('Signature mismatch');
  }
}

/** Lowercase hex HMAC-SHA256 of raw body (for dev logging vs X-Hub-Signature-256). */
async function computeExpectedSignatureHex(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const rawBytes = new TextEncoder().encode(rawBody);
  const signature = await crypto.subtle.sign('HMAC', key, rawBytes);
  const computedBytes = new Uint8Array(signature);
  return Array.from(computedBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Minimal type for wa_* table access (not in generated schema) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WaDbClient = any; // Supabase client with wa_* tables

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve center_id from contact phone (users, students, or centers) */
async function resolveCenterForPhone(
  admin: ReturnType<typeof createClient>,
  phone: string
): Promise<string | null> {
  const normalized = normalizePhone(phone);
  const phones = [...new Set([normalized, phone].filter((p) => p.length > 0))];

  const { data: user } = await admin
    .from('users')
    .select('center_id')
    .in('phone', phones)
    .not('center_id', 'is', null)
    .limit(1)
    .maybeSingle();
  const userRow = user as { center_id?: string } | null;
  if (userRow?.center_id) return userRow.center_id;

  const { data: studentByPhone } = await admin
    .from('students')
    .select('center_id')
    .in('phone', phones)
    .not('center_id', 'is', null)
    .limit(1)
    .maybeSingle();
  const studentByPhoneRow = studentByPhone as { center_id?: string } | null;
  if (studentByPhoneRow?.center_id) return studentByPhoneRow.center_id;

  const { data: studentByParent } = await admin
    .from('students')
    .select('center_id')
    .in('parent_phone', phones)
    .not('center_id', 'is', null)
    .limit(1)
    .maybeSingle();
  const studentRow = studentByParent as { center_id?: string } | null;
  if (studentRow?.center_id) return studentRow.center_id;

  const { data: center } = await admin
    .from('centers')
    .select('id')
    .in('phone', phones)
    .limit(1)
    .maybeSingle();
  const centerRow = center as { id?: string } | null;
  return centerRow?.id ?? null;
}

/** Run keyword matching against wa_keyword_routes */
async function matchKeyword(
  db: WaDbClient,
  text: string
): Promise<{ responseTemplate: string; category: string } | null> {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  const result = (await (db.from('wa_keyword_routes').select(
    'keywords, match_type, response_template, category'
  ) as unknown as PromiseLike<{ data: unknown }>)) as { data: unknown };
  const routes = result.data as unknown[] | null;

  if (!routes || routes.length === 0) return null;

  for (const r of routes as { keywords: string[]; match_type: string; response_template: string; category: string }[]) {
    const keywords = r.keywords ?? [];
    const matchType = r.match_type ?? 'any';
    const matches =
      matchType === 'exact'
        ? keywords.some((k) => k.toLowerCase() === trimmed)
        : matchType === 'all'
          ? keywords.every((k) => trimmed.includes(k.toLowerCase()))
          : keywords.some((k) => trimmed.includes(k.toLowerCase()));

    if (matches) {
      return { responseTemplate: r.response_template, category: r.category };
    }
  }
  return null;
}

/** Process inbound message: flows, keywords, human queue, holding */
async function processInboundMessage(
  db: WaDbClient,
  fromPhone: string,
  messageId: string,
  body: string,
  centerId: string | null
): Promise<void> {
  const normalized = normalizePhone(fromPhone);

  if (!centerId) {
    return;
  }

  const { data: convData } = await db
    .from('wa_conversations')
    .select('id, current_flow, is_in_human_queue, last_message_at')
    .eq('center_id', centerId)
    .eq('contact_phone', normalized)
    .maybeSingle();

  const conv = convData as {
    id?: string;
    current_flow?: string | null;
    is_in_human_queue?: boolean;
    last_message_at?: string | null;
  } | null;

  const now = new Date().toISOString();
  const lastAt = conv?.last_message_at ? new Date(conv.last_message_at).getTime() : 0;
  const hoursSince = (Date.now() - lastAt) / (1000 * 60 * 60);

  await db.from('wa_conversations').upsert(
    {
      center_id: centerId,
      contact_phone: normalized,
      last_message_at: now,
      updated_at: now,
    },
    { onConflict: 'center_id,contact_phone' }
  );

  if (conv?.current_flow) {
    // Active flow: run flow logic (placeholder — wire to flow engine later)
    return;
  }

  const match = await matchKeyword(db, body);

  if (match) {
    await db
      .from('wa_conversations')
      .update({
        is_in_human_queue: false,
        current_flow: null,
        flow_step: null,
        updated_at: now,
      })
      .eq('center_id', centerId)
      .eq('contact_phone', normalized);

    await sendTemplateMessage(centerId, fromPhone, match.responseTemplate, {});
    return;
  }

  const inHumanQueue = conv?.is_in_human_queue ?? false;

  if (hoursSince >= HOLDING_HOURS && inHumanQueue) {
    await sendFreeformMessage(
      centerId,
      fromPhone,
      'شكراً لتواصلك. فريقنا سيرد عليك قريباً.'
    );
    return;
  }

  await db
    .from('wa_conversations')
    .update({
      is_in_human_queue: true,
      updated_at: now,
    })
    .eq('center_id', centerId)
    .eq('contact_phone', normalized);
}

export async function GET(request: Request) {
  // Webhook verification request from Meta (must respond before POST events).
  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN ?? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && verifyToken && token === verifyToken) {
    return new NextResponse(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

/** Process webhook payload (runs async after 200 response) */
async function processWebhookPayload(body: Record<string, unknown>): Promise<void> {
  const object = (body as { object?: string }).object;
  if (object !== 'whatsapp_business_account') {
    return;
  }

  const entries = (body as { entry?: unknown[] }).entry ?? [];
  const admin = getSupabaseAdmin();
  const db = admin as unknown as {
    from: (t: string) => {
      select: (s: string) => { eq: (a: string, b: string) => { eq: (a2: string, b2: string) => { maybeSingle: () => Promise<{ data: unknown }> } } };
      update: (d: object) => { eq: (a: string, b: string) => { eq?: (a2: string, b2: string) => Promise<unknown> } };
      upsert: (d: object, o: { onConflict: string }) => Promise<unknown>;
    };
  };

  for (const entry of entries) {
    const changes = (entry as { changes?: unknown[] }).changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== 'object') continue;

      const v = value as Record<string, unknown>;

      if (v.statuses) {
        const statuses = v.statuses as Array<{
          id: string;
          status?: string;
          recipient_id?: string;
        }>;
        for (const s of statuses) {
          const wabaId = s.id;
          const status = s.status ?? 'sent';
          if (wabaId) {
            await db
              .from('wa_message_queue')
              .update({
                status: status === 'read' ? 'read' : status === 'delivered' ? 'delivered' : 'sent',
                updated_at: new Date().toISOString(),
              })
              .eq('waba_message_id', wabaId);
          }
        }
      }

      if (v.messages) {
        const messages = v.messages as Array<{
          id: string;
          from: string;
          type?: string;
          text?: { body: string };
          interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
        }>;
        const adminClient = admin as unknown as SupabaseClient;

        for (const msg of messages) {
          const fromPhone = msg.from;
          const messageId = msg.id;

          const ix = msg.interactive as
            | { type?: string; button_reply?: { id?: string; title?: string } }
            | undefined;

          let buttonId: string | undefined;
          if (msg.type === 'interactive') {
            if (ix?.type === 'button_reply') {
              buttonId = ix.button_reply?.id;
            } else if (ix?.button_reply?.id) {
              buttonId = ix.button_reply.id;
            }
          }

          const textBody = msg.type === 'text' ? (msg.text?.body ?? '').trim() : '';

          const readyPayload =
            typeof buttonId === 'string' && buttonId.startsWith('READY_')
              ? buttonId
              : textBody.startsWith('READY_')
                ? textBody
                : null;

          if (readyPayload && (await isVendorInboundPhone(adminClient, fromPhone))) {
            await handleVendorReadySignal(readyPayload, adminClient);
            continue;
          }

          let text = msg.type === 'text' ? msg.text?.body ?? '' : '';

          const centerId = await resolveCenterForPhone(
            admin as unknown as ReturnType<typeof createClient>,
            fromPhone
          );

          if (msg.type === 'interactive' && msg.interactive?.button_reply?.title) {
            const buttonTitle = msg.interactive.button_reply.title;
            if (buttonTitle.includes('مشكلة') || buttonTitle.includes('problem') || buttonTitle === '❌ عندي مشكلة') {
              if (centerId) {
                await pauseOnboardingFlow(centerId);
                const normalized = normalizePhone(fromPhone);
                const now = new Date().toISOString();
                await db.from('wa_conversations').upsert(
                  { center_id: centerId, contact_phone: normalized, is_in_human_queue: true, updated_at: now },
                  { onConflict: 'center_id,contact_phone' }
                );
              }
              continue;
            }
            if (buttonTitle === 'وافق' || buttonTitle.includes('وافق')) {
              const normalized = normalizePhone(fromPhone);
              const { data: toConsent } = await admin
                .from('students')
                .select('id, center_id')
                .eq('parent_phone', normalized)
                .eq('parent_consent_given', false);
              const list = (toConsent ?? []) as { id: string; center_id: string }[];
              const now = new Date().toISOString();
              const expiresAt = new Date();
              expiresAt.setFullYear(expiresAt.getFullYear() + 1);
              for (const st of list) {
                await admin.from('students').update({
                  parent_consent_given: true,
                  parent_consent_at: now,
                  parent_phone_verified: true,
                }).eq('id', st.id);
                const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join('');
                await admin.from('parent_portal_tokens').insert({
                  student_id: st.id,
                  token,
                  expires_at: expiresAt.toISOString(),
                });
              }
              if (list.length > 0 && centerId) {
                await sendFreeformMessage(
                  centerId,
                  fromPhone,
                  'شكراً لموافقتك! ستتلقى إشعارات عن حضور ابنك/ابنتك والمستحقات. للاطلاع على التفاصيل، سنرسل لك رابط البوابة قريباً.'
                );
              }
              continue;
            }
            text = buttonTitle;
          }

          if (centerId) {
            processInboundMessage(db, fromPhone, messageId, text, centerId).catch((err) => {
              console.error('[WhatsApp webhook] processInboundMessage error:', err);
              Sentry.captureException(err);
            });
          }
        }
      }
    }
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  const signatureHeader = request.headers.get('x-hub-signature-256');
  const secret = process.env.WHATSAPP_APP_SECRET;
  const receivedSignature = signatureHeader?.replace(/^sha256=/i, '').trim() ?? '';

  if (!secret) {
    console.error('[WA webhook] WHATSAPP_APP_SECRET not set');
    return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
  }

  if (process.env.NODE_ENV !== 'production') {
    const expectedSignature = await computeExpectedSignatureHex(body, secret);
    console.log('[WA webhook] Signature check:', {
      expected: expectedSignature?.slice(0, 10),
      received: receivedSignature?.slice(0, 10),
    });
  }

  console.log('[WA webhook] Verifying signature...');
  console.log(
    '[WA webhook] x-hub-signature-256 header present:',
    !!request.headers.get('x-hub-signature-256'),
  );
  console.log('[WA webhook] WHATSAPP_APP_SECRET set:', !!process.env.WHATSAPP_APP_SECRET);

  try {
    await verifySignature(body, signatureHeader, secret);
  } catch (err) {
    console.error('[WA webhook] Signature mismatch');
    console.error('[WA webhook] Expected prefix: sha256=<64-hex-chars> (Meta HMAC-SHA256 of raw body)');
    console.error('[WA webhook] Header received:', signatureHeader?.slice(0, 20));
    console.error('[WhatsApp webhook] Signature verification failed:', err);
    Sentry.captureException(err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const response = NextResponse.json({ status: 'ok' });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return response;
  }

  processWebhookPayload(payload).catch((err) => {
    console.error('[WhatsApp webhook] processWebhookPayload error:', err);
    Sentry.captureException(err);
  });

  return response;
}
