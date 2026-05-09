import type { SupabaseClient } from '@supabase/supabase-js';

export type CardOrderTransitionRow = Record<string, unknown> & { to_status?: string };

function transitionToStatus(row: Record<string, unknown>): string {
  const v = row.to_status ?? row.new_status ?? row.status_after ?? row.next_status ?? '';
  return String(v ?? '').trim();
}

/** Shared loader for centre-scoped card order detail (API + server pages). */
export async function loadCardOrderDetailForCenter(
  admin: SupabaseClient,
  centerId: string,
  orderId: string,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; status: 404 | 500; message: string }> {
  const id = orderId.trim();
  if (!id) return { ok: false, status: 404, message: 'Not found' };

  const { data: row, error } = await admin
    .from('card_orders')
    .select(
      `
        id,
        center_id,
        status,
        payment_status,
        refund_status,
        cancelled_at,
        cancellation_reason,
        refund_requested_at,
        refund_paid_at,
        total_amount,
        quantity,
        price_per_card,
        delivery_fee,
        shipping_zone,
        delivery_address,
        delivery_governorate,
        delivery_phone,
        notes,
        card_style,
        created_at,
        students,
        tracking_number,
        bosta_order_id,
        bosta_shipment_id,
        paymob_transaction_id,
        paymob_order_id,
        delivered_at,
        bosta_updated_at
      `,
    )
    .eq('id', id)
    .eq('center_id', centerId)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, status: 404, message: 'Not found' };
  }

  const base = row as Record<string, unknown>;

  const [{ data: items }, { data: transitions }, { data: centerRow }, { data: taxCfg }] = await Promise.all([
    admin
      .from('card_order_items')
      .select('id, kind, quantity, student_id')
      .eq('card_order_id', id)
      .order('created_at', { ascending: true }),
    admin
      .from('card_order_status_transitions')
      .select('*')
      .eq('card_order_id', id)
      .order('created_at', { ascending: true }),
    admin.from('centers').select('name, delivery_address').eq('id', centerId).maybeSingle(),
    admin.from('platform_config').select('value').eq('key', 'ehg_tax_registration').maybeSingle(),
  ]);

  let shipRow: { tracking_number?: string | null; estimated_delivery_date?: string | null } | null = null;
  const hasTrack = typeof base.tracking_number === 'string' && base.tracking_number.trim().length > 0;
  if (!hasTrack) {
    const attempt = await admin
      .from('bosta_shipments')
      .select('tracking_number, estimated_delivery_date')
      .eq('card_order_id', id)
      .maybeSingle();
    if (!attempt.error && attempt.data) {
      shipRow = attempt.data as {
        tracking_number?: string | null;
        estimated_delivery_date?: string | null;
      };
    }
  }

  const studentIds = (items ?? [])
    .filter((r) => (r as { kind?: string }).kind === 'student' && (r as { student_id?: string }).student_id)
    .map((r) => String((r as { student_id?: string }).student_id));

  const namesById: Record<string, { name: string; student_number: string | null }> = {};
  if (studentIds.length) {
    const { data: studs } = await admin
      .from('students')
      .select('id, name, student_number')
      .in('id', [...new Set(studentIds)]);
    for (const s of studs ?? []) {
      const sr = s as { id: string; name: string | null; student_number: string | null };
      namesById[sr.id] = { name: sr.name ?? '', student_number: sr.student_number };
    }
  }

  const hydratedItems = (items ?? []).map((it) => {
    const r = it as { id?: string; kind?: string; quantity?: number; student_id?: string | null };
    if (r.kind === 'student' && r.student_id) {
      const meta = namesById[r.student_id];
      return {
        ...r,
        student_name: meta?.name ?? null,
        student_number: meta?.student_number ?? null,
      };
    }
    return { ...r, student_name: null, student_number: null };
  });

  const transitionPayload = (transitions ?? []).map((t) => {
    const tr = t as Record<string, unknown>;
    return {
      ...tr,
      to_status: transitionToStatus(tr) || tr.to_status,
    };
  });

  const tracking =
    (typeof base.tracking_number === 'string' && base.tracking_number.trim()) ||
    (shipRow?.tracking_number?.trim() ?? '') ||
    '';

  const taxReg =
    typeof taxCfg?.value === 'string'
      ? taxCfg.value
      : taxCfg?.value && typeof taxCfg.value === 'object' && taxCfg.value !== null && 'tax_id' in taxCfg.value
        ? String((taxCfg.value as { tax_id?: unknown }).tax_id ?? '')
        : '';

  const center = centerRow as { name?: string | null; delivery_address?: unknown } | null;

  let centerAddrText = '';
  const da = center?.delivery_address;
  if (da && typeof da === 'object' && !Array.isArray(da)) {
    const o = da as Record<string, unknown>;
    const parts = [o.street, o.city, o.governorate, o.building, o.landmark]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
    centerAddrText = parts.join(', ');
  }

  const payload = {
    ...base,
    receipt_center_name: center?.name ?? null,
    receipt_center_address: centerAddrText || null,
    items: hydratedItems,
    transitions: transitionPayload,
    bosta_tracking_number: tracking || null,
    bosta_estimated_delivery_at: shipRow?.estimated_delivery_date ?? null,
    ehg_tax_registration: taxReg || null,
  };

  return { ok: true, payload };
}
