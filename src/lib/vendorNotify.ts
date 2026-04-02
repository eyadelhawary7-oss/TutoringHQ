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
    footer1: string;
    footer2: string;
  };
};

function notifyLines(ref: string, quantity: number, centerName: string, notes: string | null): string {
  const vn = (arMessages as VendorNotifyJson).vendorNotify;
  const lines = [
    vn.header,
    interpolate(vn.ref, { ref }),
    interpolate(vn.qty, { quantity }),
    interpolate(vn.center, { centerName }),
    notes ? interpolate(vn.notes, { notes }) : '',
    vn.footer1,
    vn.footer2,
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

    const centerJoin = order.centers as { name?: string | null } | { name?: string | null }[] | null;
    const centerName = Array.isArray(centerJoin)
      ? centerJoin[0]?.name ?? '—'
      : centerJoin?.name ?? '—';

    const notesVal =
      order.notes != null && String(order.notes).trim() !== '' ? String(order.notes) : null;

    const message = notifyLines(ref, Number(order.quantity ?? 0), centerName, notesVal);

    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const waToken = process.env.WHATSAPP_TOKEN;
    if (!phoneNumberId || !waToken) {
      console.warn('[vendorNotify] Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
      return;
    }

    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(vendor.whatsapp_number).replace(/[^0-9]/g, ''),
        type: 'text',
        text: { body: message },
      }),
    });

    if (!res.ok) {
      console.error('[vendorNotify] WA send failed:', await res.text());
      return;
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
