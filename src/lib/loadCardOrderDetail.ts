import type { SupabaseClient } from '@supabase/supabase-js';

export type CardOrderTransitionRow = Record<string, unknown> & { to_status?: string };

function transitionToStatus(row: Record<string, unknown>): string {
  const v = row.to_status ?? row.new_status ?? row.status_after ?? row.next_status ?? '';
  return String(v ?? '').trim();
}

const CARD_ORDER_DETAIL_COLUMNS = `
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
      `;

function formatCenterAddrFromJson(da: unknown): string {
  if (!da || typeof da !== 'object' || Array.isArray(da)) return '';
  const o = da as Record<string, unknown>;
  const parts = [o.street, o.city, o.governorate, o.building, o.landmark]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter(Boolean);
  return parts.join(', ');
}

async function buildHydratedPayload(
  admin: SupabaseClient,
  id: string,
  base: Record<string, unknown>,
  centerForReceipt: { name?: string | null; delivery_address?: unknown } | null,
  taxCfgRow: { value?: unknown } | null,
): Promise<Record<string, unknown>> {
  const [{ data: items }, { data: transitions }] = await Promise.all([
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
  ]);

  let shipRow: Record<string, unknown> | null = null;
  const hasTrack = typeof base.tracking_number === 'string' && base.tracking_number.trim().length > 0;
  const attempt = await admin.from('bosta_shipments').select('*').eq('card_order_id', id).maybeSingle();
  if (!attempt.error && attempt.data) {
    shipRow = attempt.data as Record<string, unknown>;
    if (hasTrack && shipRow && shipRow.tracking_number == null) {
      shipRow = { ...shipRow, tracking_number: base.tracking_number };
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
    (typeof shipRow?.tracking_number === 'string' && shipRow.tracking_number.trim()) ||
    '';

  const taxCfg = taxCfgRow;
  const taxReg =
    typeof taxCfg?.value === 'string'
      ? taxCfg.value
      : taxCfg?.value && typeof taxCfg.value === 'object' && taxCfg.value !== null && 'tax_id' in taxCfg.value
        ? String((taxCfg.value as { tax_id?: unknown }).tax_id ?? '')
        : '';

  const center = centerForReceipt;

  let centerAddrText = '';
  const da = center?.delivery_address;
  centerAddrText = formatCenterAddrFromJson(da);

  return {
    ...base,
    receipt_center_name: center?.name ?? null,
    receipt_center_address: centerAddrText || null,
    items: hydratedItems,
    transitions: transitionPayload,
    bosta_tracking_number: tracking || null,
    bosta_estimated_delivery_at:
      (typeof shipRow?.estimated_delivery_date === 'string' ? shipRow.estimated_delivery_date : null) ?? null,
    ehg_tax_registration: taxReg || null,
    _bosta_shipment_row: shipRow,
  };
}

function derivePaidAtIso(transitions: CardOrderTransitionRow[]): string | null {
  const sorted = [...transitions].sort((a, b) => {
    const ta = String(a.created_at ?? '');
    const tb = String(b.created_at ?? '');
    return new Date(ta).getTime() - new Date(tb).getTime();
  });
  for (const t of sorted) {
    const to = String(transitionToStatus(t as Record<string, unknown>) ?? '').toLowerCase();
    if (to === 'paid') {
      const c = t.created_at;
      if (typeof c === 'string' && c) return c;
    }
  }
  return null;
}

async function fetchWebhookInboxPaymob(
  admin: SupabaseClient,
  paymobTransactionId: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  const tid = typeof paymobTransactionId === 'string' ? paymobTransactionId.trim() : '';
  if (!tid) return null;
  const { data } = await admin.from('webhook_inbox').select('*').eq('idempotency_key', `paymob:${tid}`).maybeSingle();
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

async function fetchWebhookInboxBostaForTracking(
  admin: SupabaseClient,
  tracking: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  const tr = typeof tracking === 'string' ? tracking.trim() : '';
  if (!tr) return null;
  const { data: rows } = await admin
    .from('webhook_inbox')
    .select('*')
    .eq('source', 'bosta')
    .order('created_at', { ascending: false })
    .limit(40);
  const list = rows ?? [];
  for (const row of list) {
    const payload = (row as { payload?: unknown }).payload;
    try {
      const s = JSON.stringify(payload ?? {});
      if (s.includes(tr)) return row as Record<string, unknown>;
    } catch {
      /* skip */
    }
  }
  return null;
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
    .select(CARD_ORDER_DETAIL_COLUMNS)
    .eq('id', id)
    .eq('center_id', centerId)
    .maybeSingle();

  if (error || !row) {
    return { ok: false, status: 404, message: 'Not found' };
  }

  const base = row as Record<string, unknown>;

  const [{ data: centerRow }, { data: taxCfg }] = await Promise.all([
    admin.from('centers').select('name, delivery_address').eq('id', centerId).maybeSingle(),
    admin.from('platform_config').select('value').eq('key', 'ehg_tax_registration').maybeSingle(),
  ]);

  const payload = await buildHydratedPayload(
    admin,
    id,
    base,
    centerRow as { name?: string | null; delivery_address?: unknown } | null,
    taxCfg,
  );
  const { _bosta_shipment_row: _bsr, ...rest } = payload;
  void _bsr;
  return { ok: true, payload: rest };
}

export type AdminCardOrderExtra = {
  centre_snapshot: {
    center_id: string;
    name: string | null;
    address_text: string | null;
    plan: string | null;
    plan_price: number | null;
    subscription_status: string | null;
  };
  derived_paid_at: string | null;
  paymob_webhook_inbox: Record<string, unknown> | null;
  bosta_webhook_inbox: Record<string, unknown> | null;
  bosta_shipment_status: string | null;
  bosta_shipment_updated_at: string | null;
  bosta_shipping_cost: number | null;
};

/** Admin loader: arbitrary order id (no centre membership check). */
export async function loadCardOrderDetailForAdmin(
  admin: SupabaseClient,
  orderId: string,
): Promise<
  | { ok: true; payload: Record<string, unknown> & AdminCardOrderExtra }
  | { ok: false; status: 404 | 500; message: string }
> {
  const id = orderId.trim();
  if (!id) return { ok: false, status: 404, message: 'Not found' };

  const { data: row, error } = await admin.from('card_orders').select(CARD_ORDER_DETAIL_COLUMNS).eq('id', id).maybeSingle();

  if (error || !row) {
    return { ok: false, status: 404, message: 'Not found' };
  }

  const base = row as Record<string, unknown>;
  const resolvedCenterId = String(base.center_id ?? '').trim();
  if (!resolvedCenterId) return { ok: false, status: 404, message: 'Not found' };

  const [{ data: centerRow }, { data: taxCfg }] = await Promise.all([
    admin
      .from('centers')
      .select('name, delivery_address, plan, all_in_price, subscription_status')
      .eq('id', resolvedCenterId)
      .maybeSingle(),
    admin.from('platform_config').select('value').eq('key', 'ehg_tax_registration').maybeSingle(),
  ]);

  const rawPayload = await buildHydratedPayload(
    admin,
    id,
    base,
    centerRow as { name?: string | null; delivery_address?: unknown } | null,
    taxCfg,
  );
  const shipRow = rawPayload._bosta_shipment_row as Record<string, unknown> | null;
  const { _bosta_shipment_row: _, ...payloadBase } = rawPayload;

  const transitions = (payloadBase.transitions as CardOrderTransitionRow[]) ?? [];
  const derivedPaidAt = derivePaidAtIso(transitions);

  const trackingStr =
    typeof payloadBase.bosta_tracking_number === 'string' ? payloadBase.bosta_tracking_number.trim() : '';

  const [paymobWebhook, bostaWebhook] = await Promise.all([
    fetchWebhookInboxPaymob(admin, base.paymob_transaction_id as string | undefined),
    fetchWebhookInboxBostaForTracking(admin, trackingStr || null),
  ]);

  const c = centerRow as {
    name?: string | null;
    delivery_address?: unknown;
    plan?: string | null;
    all_in_price?: number | null;
    subscription_status?: string | null;
  } | null;

  const centre_snapshot: AdminCardOrderExtra['centre_snapshot'] = {
    center_id: resolvedCenterId,
    name: c?.name ?? null,
    address_text: formatCenterAddrFromJson(c?.delivery_address) || null,
    plan: c?.plan ?? null,
    plan_price: c?.all_in_price != null ? Number(c.all_in_price) : null,
    subscription_status: c?.subscription_status ?? null,
  };

  const extra: AdminCardOrderExtra = {
    centre_snapshot,
    derived_paid_at: derivedPaidAt,
    paymob_webhook_inbox: paymobWebhook,
    bosta_webhook_inbox: bostaWebhook,
    bosta_shipment_status: shipRow?.status != null ? String(shipRow.status) : null,
    bosta_shipment_updated_at:
      (typeof shipRow?.updated_at === 'string' ? shipRow.updated_at : null) ??
      (typeof shipRow?.created_at === 'string' ? shipRow.created_at : null),
    bosta_shipping_cost: (() => {
      const fromShip = shipRow?.shipping_cost;
      if (fromShip != null && Number.isFinite(Number(fromShip))) return Number(fromShip);
      const df = base.delivery_fee;
      return df != null && Number.isFinite(Number(df)) ? Number(df) : null;
    })(),
  };

  return {
    ok: true,
    payload: {
      ...payloadBase,
      ...extra,
    },
  };
}
