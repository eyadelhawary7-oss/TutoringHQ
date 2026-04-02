import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import arMessages from '../../messages/ar.json';

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

type VendorNotifyJson = {
  vendorNotify: {
    header: string;
    ref: string;
    qty: string;
    center: string;
    notes: string;
    interactiveCta: string;
    platformFooter: string;
    buttonTitle: string;
    fallbackConfirm: string;
  };
};

function vn(): VendorNotifyJson['vendorNotify'] {
  return (arMessages as VendorNotifyJson).vendorNotify;
}

function buildInteractiveBodyText(
  ref: string,
  quantity: number,
  centerName: string,
  notes: string | null,
): string {
  const x = vn();
  const lines = [
    x.header,
    interpolate(x.ref, { ref }),
    interpolate(x.qty, { quantity }),
    interpolate(x.center, { centerName }),
    notes ? interpolate(x.notes, { notes }) : '',
    '',
    x.interactiveCta,
  ];
  return lines.filter(Boolean).join('\n');
}

function buildFallbackBodyText(
  ref: string,
  quantity: number,
  centerName: string,
  notes: string | null,
  readyToken: string,
): string {
  const x = vn();
  const lines = [
    x.header,
    interpolate(x.ref, { ref }),
    interpolate(x.qty, { quantity }),
    interpolate(x.center, { centerName }),
    notes ? interpolate(x.notes, { notes }) : '',
    '',
    interpolate(x.fallbackConfirm, { readyToken }),
  ];
  return lines.filter(Boolean).join('\n');
}

export async function notifyVendorOfNewOrder(orderId: string): Promise<void> {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
      console.warn('[vendorNotify] Missing Supabase admin');
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('card_orders')
      .select('vendor_sent_at')
      .eq('id', orderId)
      .maybeSingle();

    if (existing && (existing as { vendor_sent_at?: string | null }).vendor_sent_at) {
      return;
    }

    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, name, whatsapp_number')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!vendor?.whatsapp_number) {
      console.warn('[vendorNotify] No active vendor configured');
      return;
    }

    const { data: order } = await supabaseAdmin
      .from('card_orders')
      .select('id, quantity, notes, centers(name)')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) return;

    const prefix = (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
    const ref = `${prefix}-${String(order.id).substring(0, 8).toUpperCase()}`;
    const readyButtonId = `READY_${ref}`;

    const centerJoin = order.centers as { name?: string | null } | { name?: string | null }[] | null;
    const centerName = Array.isArray(centerJoin)
      ? centerJoin[0]?.name ?? '—'
      : centerJoin?.name ?? '—';

    const notesVal =
      order.notes != null && String(order.notes).trim() !== '' ? String(order.notes) : null;

    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const waToken = process.env.WHATSAPP_TOKEN;
    if (!phoneNumberId || !waToken) {
      console.warn('[vendorNotify] Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
      return;
    }

    const waUrl = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${waToken}`,
      'Content-Type': 'application/json',
    };
    const to = String(vendor.whatsapp_number).replace(/[^0-9]/g, '');

    const x = vn();
    const interactiveBody = JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: buildInteractiveBodyText(ref, Number(order.quantity ?? 0), centerName, notesVal),
        },
        footer: {
          text: x.platformFooter,
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: readyButtonId,
                title: x.buttonTitle,
              },
            },
          ],
        },
      },
    });

    const res = await fetch(waUrl, { method: 'POST', headers, body: interactiveBody });

    if (!res.ok) {
      const fallbackText = buildFallbackBodyText(
        ref,
        Number(order.quantity ?? 0),
        centerName,
        notesVal,
        readyButtonId,
      );
      const fallbackRes = await fetch(waUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: fallbackText },
        }),
      });
      if (!fallbackRes.ok) {
        console.error(
          '[vendorNotify] Both interactive + fallback failed:',
          await fallbackRes.text(),
        );
        return;
      }
      console.log('[vendorNotify] Sent plain text fallback for', ref);
    } else {
      console.log('[vendorNotify] Sent interactive button for', ref);
    }

    const { error: upErr } = await supabaseAdmin
      .from('card_orders')
      .update({
        vendor_id: vendor.id,
        vendor_sent_at: new Date().toISOString(),
      })
      .eq('id', orderId)
      .is('vendor_sent_at', null);

    if (upErr) {
      console.error('[vendorNotify] Failed to record vendor_sent_at:', upErr);
    }

    console.log(`[vendorNotify] Notified vendor for order ${orderId}`);
  } catch (err) {
    console.error('[vendorNotify] Error:', err);
  }
}
