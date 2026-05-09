import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeWhatsAppNumber, sendWhatsAppMessage } from '@/lib/whatsapp';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';

/**
 * Sends a one-time WhatsApp to the centre owner after paid checkout success UI loads.
 * Idempotent: claims `checkout_owner_wa_sent_at` only when still null, then sends (clears on send failure).
 */
export async function notifyCheckoutSuccessOwnerOnce(
  admin: SupabaseClient,
  orderId: string,
  viewerUserId: string,
): Promise<void> {
  const { data: viewer } = await admin.from('users').select('center_id').eq('id', viewerUserId).maybeSingle();
  const viewerCenter = (viewer as { center_id?: string | null } | null)?.center_id ?? null;
  if (!viewerCenter) return;

  const sentAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await admin
    .from('card_orders')
    .update({ checkout_owner_wa_sent_at: sentAt })
    .eq('id', orderId)
    .eq('center_id', viewerCenter)
    .eq('payment_status', 'paid')
    .is('checkout_owner_wa_sent_at', null)
    .select('id, quantity, total_amount');

  if (claimErr || !claimed?.length) return;

  const row = claimed[0] as {
    id: string;
    quantity?: number | null;
    total_amount?: number | null;
  };

  const owners = await ownerContactByCenterId(admin, [viewerCenter]);
  const oc = owners.get(viewerCenter);
  if (!oc) {
    await admin.from('card_orders').update({ checkout_owner_wa_sent_at: null }).eq('id', row.id);
    return;
  }

  const { data: centerRow } = await admin.from('centers').select('name, phone').eq('id', viewerCenter).maybeSingle();
  const centerPhone = (centerRow as { phone?: string | null } | null)?.phone ?? null;
  const centerName = String((centerRow as { name?: string | null } | null)?.name ?? '').trim() || 'Centre';

  const toRaw = await resolveOwnerWaPhone(admin, oc.authId, oc.userPhone, centerPhone);
  const to = toRaw ? normalizeWhatsAppNumber(toRaw) : '';
  if (!to) {
    await admin.from('card_orders').update({ checkout_owner_wa_sent_at: null }).eq('id', row.id);
    return;
  }

  const qty = Math.round(Number(row.quantity ?? 0));
  const total = Number(row.total_amount ?? 0);
  const shortId = String(orderId).replace(/-/g, '').slice(0, 8).toUpperCase();

  const lines = [
    `✅ CenterHQ — تم تأكيد دفع طلب البطاقات`,
    `المركز: ${centerName}`,
    `رقم الطلب: ${shortId}`,
    `الكمية: ${qty} بطاقة`,
    `الإجمالي: ${Number.isFinite(total) ? total.toFixed(2) : '—'} ج.م`,
    '',
    `✅ CenterHQ — Card order payment confirmed`,
    `Centre: ${centerName}`,
    `Order ref: ${shortId}`,
    `Qty: ${qty} cards`,
    `Total: ${Number.isFinite(total) ? total.toFixed(2) : '—'} EGP`,
  ];

  const ok = await sendWhatsAppMessage(to, lines.join('\n'));
  if (!ok) {
    await admin.from('card_orders').update({ checkout_owner_wa_sent_at: null }).eq('id', row.id);
  }
}
