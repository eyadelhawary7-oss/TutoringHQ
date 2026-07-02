/**
 * WhatsApp Cloud API webhook (Direct Meta API)
 * GET: verify token
 * POST: handle statuses + inbound messages (signature-verified, fast 200)
 * Env: WHATSAPP_VERIFY_TOKEN or WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { readRawBodyWithLimit, ValidationError } from '@/lib/validate';
import { hmacSha256Hex, timingSafeEqualUtf8 } from '@/lib/verifyHmac';
import { newParentPortalToken, getParentPortalLifetimeDays } from '@/lib/parentPortalToken';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizePhone,
  sendFreeformMessage,
  sendTemplateMessage,
} from '@/lib/whatsapp/client';
import { pauseOnboardingFlow } from '@/lib/whatsapp/flows/onboarding';
import {
  handleVendorReadySignal,
  handleVendorTypedReadyMessage,
  isVendorInboundPhone,
  isVendorTypedReadyKeyword,
} from '@/lib/vendorWebhook';

const HOLDING_HOURS = 4;

const WA_BODY_LIMIT = 64 * 1024;

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
    // Active flow: run flow logic (placeholder - wire to flow engine later)
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
            await handleVendorReadySignal(readyPayload, adminClient, fromPhone);
            continue;
          }

          if (
            !readyPayload &&
            textBody &&
            isVendorTypedReadyKeyword(textBody) &&
            (await isVendorInboundPhone(adminClient, fromPhone))
          ) {
            await handleVendorTypedReadyMessage(fromPhone, adminClient);
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
              // H6: lifetime from platform_config (interim 30-day default),
              // no longer a hard-coded 1 year.
              const lifetimeDays = await getParentPortalLifetimeDays(admin);
              const expiresAt = new Date();
              expiresAt.setDate(expiresAt.getDate() + lifetimeDays);
              for (const st of list) {
                await admin.from('students').update({
                  parent_consent_given: true,
                  parent_consent_at: now,
                  parent_phone_verified: true,
                }).eq('id', st.id);
                // H6: store only the hash; the raw token would go in the portal
                // link sent to the parent (link delivery is a separate flow).
                const { hash } = newParentPortalToken();
                await admin.from('parent_portal_tokens').insert({
                  student_id: st.id,
                  token_hash: hash,
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
  try {
    const rawBody = await readRawBodyWithLimit(request, WA_BODY_LIMIT);

    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      Sentry.captureMessage('whatsapp webhook missing WHATSAPP_APP_SECRET', {
        level: 'warning',
        tags: { provider: 'whatsapp' },
      });
      return new Response(null, { status: 401 });
    }

    const signatureHeader = request.headers.get('x-hub-signature-256');
    if (!signatureHeader) {
      return new Response(null, { status: 401 });
    }

    const expectedHex = hmacSha256Hex(appSecret, rawBody);
    const expectedSignature = `sha256=${expectedHex}`;
    const receivedNorm = signatureHeader.trim().toLowerCase();
    const expectedNorm = expectedSignature.toLowerCase();
    if (!timingSafeEqualUtf8(receivedNorm, expectedNorm)) {
      Sentry.captureMessage('WhatsApp webhook signature mismatch', {
        level: 'warning',
        tags: { provider: 'whatsapp' },
      });
      return new Response(null, { status: 401 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return new Response(null, { status: 401 });
    }

    processWebhookPayload(payload).catch((err) => {
      console.error('[WhatsApp webhook] processWebhookPayload error:', err);
      Sentry.captureException(err);
    });

    return NextResponse.json({ received: true });
  } catch (e) {
    if (e instanceof ValidationError && e.message === 'Request payload too large') {
      Sentry.captureMessage('whatsapp webhook payload limit exceeded', {
        level: 'warning',
        tags: { provider: 'whatsapp' },
      });
      return new Response(null, { status: 413 });
    }
    Sentry.captureException(e, { tags: { provider: 'whatsapp' } });
    return new Response(null, { status: 401 });
  }
}
