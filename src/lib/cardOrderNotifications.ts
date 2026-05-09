import { sendTemplateMessage } from '@/lib/whatsapp/client';
import { ownerContactByCenterId, resolveOwnerWaPhone } from '@/lib/ownerPhone';
import { supabaseAdmin } from '@/lib/supabase-admin';

const GENERIC_STATUS_TEMPLATE = 'chq_card_order_status_update';

/** Meta body variables — order must match template registration in Business Manager. */
const BODY_ORDER_GENERIC = ['order_id', 'status_label', 'centre_name'] as const;
const BODY_ORDER_PAIR = ['order_id', 'centre_name'] as const;

function shortOrderRef(orderId: string): string {
  return orderId.replace(/-/g, '').slice(-8).toUpperCase();
}

function labelForStatus(status: string): string {
  const s = status.trim().toLowerCase().replace(/-/g, '_');
  const map: Record<string, string> = {
    pending_payment: 'Pending payment',
    paid: 'Paid',
    vendor_assigned: 'Assigned to vendor',
    in_production: 'In production',
    ready_for_pickup: 'Ready for pickup',
    in_transit: 'In transit',
    delivered: 'Delivered',
    issued: 'Cards issued',
    cancelled: 'Cancelled',
    refunded: 'Refunded',
    failed: 'Payment failed',
    pending: 'Pending',
    shipped: 'Shipped',
    confirmed: 'Confirmed',
  };
  return map[s] ?? status;
}

function pickDedicatedTemplate(
  toStatus: string,
): { templateName: string; parameterOrder: readonly string[] } | null {
  const s = toStatus.trim().toLowerCase().replace(/-/g, '_');
  switch (s) {
    case 'paid':
      return { templateName: 'chq_card_order_paid', parameterOrder: BODY_ORDER_PAIR };
    case 'in_production':
      return { templateName: 'chq_card_order_in_production', parameterOrder: BODY_ORDER_PAIR };
    case 'in_transit':
      return { templateName: 'chq_card_order_in_transit', parameterOrder: BODY_ORDER_PAIR };
    case 'delivered':
      return { templateName: 'chq_card_order_delivered', parameterOrder: BODY_ORDER_PAIR };
    case 'cancelled':
      return { templateName: 'chq_card_order_cancelled', parameterOrder: BODY_ORDER_PAIR };
    case 'refunded':
      return { templateName: 'chq_card_order_refunded', parameterOrder: BODY_ORDER_PAIR };
    default:
      return null;
  }
}

async function insertInAppForCenterStaff(params: {
  centerId: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
}): Promise<void> {
  const admin = supabaseAdmin;
  if (!admin) return;

  const { data: staff, error } = await admin
    .from('users')
    .select('id')
    .eq('center_id', params.centerId)
    .in('role', ['owner', 'assistant']);

  if (error || !staff?.length) return;

  const rows = (staff as { id: string }[]).map((u) => ({
    user_id: u.id,
    center_id: params.centerId,
    kind: params.kind,
    title: params.title,
    body: params.body,
    href: params.href,
  }));

  await admin.from('in_app_notifications').insert(rows);
}

/**
 * WhatsApp + in-app notification after a card order lifecycle status change.
 * Idempotent per (orderId, toStatus) via `card_order_status_wa_dedupe`.
 * Enqueues `webhook_outbox` job `send_card_order_status_wa` for resilient Meta sends.
 */
export async function sendCardOrderStatusUpdate(
  orderId: string,
  _fromStatus: string,
  toStatus: string,
): Promise<void> {
  const admin = supabaseAdmin;
  if (!admin) return;

  const normTo = toStatus.trim().toLowerCase();

  const { error: dedupeErr } = await admin.from('card_order_status_wa_dedupe').insert({
    card_order_id: orderId,
    to_status: normTo,
  });

  if (dedupeErr) {
    if ((dedupeErr as { code?: string }).code === '23505') {
      return;
    }
    console.error('[cardOrderNotifications] dedupe insert:', dedupeErr.message);
    return;
  }

  const { data: ord, error: ordErr } = await admin
    .from('card_orders')
    .select('id, center_id')
    .eq('id', orderId)
    .maybeSingle();

  if (ordErr || !ord) {
    console.warn('[cardOrderNotifications] order not found', orderId);
    return;
  }

  const centerId = String((ord as { center_id: string }).center_id);
  const shortRef = shortOrderRef(orderId);

  const { data: center } = await admin.from('centers').select('name, phone').eq('id', centerId).maybeSingle();
  const centreName = String((center as { name?: string | null } | null)?.name ?? '').trim() || 'Centre';

  const ownerMap = await ownerContactByCenterId(admin, [centerId]);
  const oc = ownerMap.get(centerId);
  const ownerPhone = await resolveOwnerWaPhone(
    admin,
    oc?.authId ?? null,
    oc?.userPhone ?? null,
    (center as { phone?: string | null } | null)?.phone ?? null,
  );

  const dedicated = pickDedicatedTemplate(normTo);
  const templateName = dedicated?.templateName ?? GENERIC_STATUS_TEMPLATE;
  const parameterOrder = dedicated?.parameterOrder ?? BODY_ORDER_GENERIC;

  const variables: Record<string, string> =
    templateName === GENERIC_STATUS_TEMPLATE
      ? {
          order_id: shortRef,
          status_label: labelForStatus(normTo),
          centre_name: centreName,
        }
      : {
          order_id: shortRef,
          centre_name: centreName,
        };

  await insertInAppForCenterStaff({
    centerId,
    kind: 'card_order_status_update',
    title: `Order #${shortRef}`,
    body: labelForStatus(normTo),
    href: `/orders/${orderId}`,
  });

  if (!ownerPhone?.trim()) {
    return;
  }

  const { error: obErr } = await admin.from('webhook_outbox').insert({
    job_type: 'send_card_order_status_wa',
    payload: {
      centerId,
      toPhone: ownerPhone.trim(),
      templateName,
      variables,
      bodyParameterOrder: [...parameterOrder],
    },
    status: 'pending',
    attempt_count: 0,
    max_attempts: 8,
    next_attempt_at: new Date().toISOString(),
  });

  if (obErr) {
    console.error('[cardOrderNotifications] webhook_outbox:', obErr.message);
  }
}

export async function processCardOrderStatusWaOutboxJob(payload: unknown): Promise<boolean> {
  const p = payload as {
    centerId?: string;
    toPhone?: string;
    templateName?: string;
    variables?: Record<string, string>;
    bodyParameterOrder?: string[];
  };
  const centerId = p.centerId?.trim();
  const toPhone = p.toPhone?.trim();
  const templateName = p.templateName?.trim();
  if (!centerId || !toPhone || !templateName) {
    return false;
  }

  const res = await sendTemplateMessage(centerId, toPhone, templateName, p.variables ?? {}, {
    bodyParameterOrder: p.bodyParameterOrder,
  });

  const skipOk =
    res.error === 'template_not_approved' ||
    res.error === 'wa_sending_disabled' ||
    res.error === 'skipped_meta_test_phone';

  return res.success === true || skipOk;
}
