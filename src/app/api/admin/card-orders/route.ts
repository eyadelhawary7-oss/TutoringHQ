import { requireSuperAdminApi } from '@/lib/admin-auth';
import type {
  AdminCardOrderRow,
  AdminCardOrderStudent,
  CardOrderFulfillmentStatus,
} from '@/types/admin-card-orders';
import { NextResponse } from 'next/server';

const VALID_STATUSES: CardOrderFulfillmentStatus[] = [
  'pending',
  'paid',
  'printing',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'confirmed',
];

function mapStatus(raw: string | null | undefined): CardOrderFulfillmentStatus {
  const s = (raw ?? '').toLowerCase();
  if (VALID_STATUSES.includes(s as CardOrderFulfillmentStatus)) {
    return s as CardOrderFulfillmentStatus;
  }
  return 'pending';
}

function parseStudents(raw: unknown): AdminCardOrderStudent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const r = item as Record<string, unknown>;
    return {
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      student_number: String(r.student_number ?? r.number ?? ''),
      qr_code: typeof r.qr_code === 'string' ? r.qr_code : null,
    };
  });
}

type CentersJoin = {
  name?: string | null;
  phone?: string | null;
  logo_url?: string | null;
  card_color?: string | null;
} | null;

function pickCenterJoin(row: Record<string, unknown>): CentersJoin {
  const c = row.centers;
  if (Array.isArray(c)) return (c[0] as CentersJoin) ?? null;
  if (c && typeof c === 'object') return c as CentersJoin;
  return null;
}

const STATUS_UPDATE_ALLOWED = [
  'pending',
  'paid',
  'printing',
  'ready_for_pickup',
  'shipped',
  'delivered',
  'confirmed',
];

async function updateOrderStatus(
  supabaseAdmin: import('@supabase/supabase-js').SupabaseClient,
  orderId: string,
  status: string,
): Promise<{ ok: true } | { ok: false; message: string; status: number }> {
  if (!STATUS_UPDATE_ALLOWED.includes(status)) {
    return { ok: false, message: 'Invalid status', status: 400 };
  }
  const { error } = await supabaseAdmin.from('card_orders').update({ status }).eq('id', orderId);
  if (error) {
    return { ok: false, message: error.message, status: 500 };
  }
  return { ok: true };
}

export async function GET(request: Request) {
  const auth = await requireSuperAdminApi(request);
  if (!auth.ok) {
    return auth.response;
  }

  const { supabaseAdmin } = auth;

  const { data: rows, error } = await supabaseAdmin
    .from('card_orders')
    .select(
      `
      id,
      center_id,
      status,
      quantity,
      price_per_card,
      delivery_fee,
      total_amount,
      delivery_address,
      notes,
      created_at,
      payment_status,
      paymob_order_id,
      paymob_transaction_id,
      students,
      vendor_sent_at,
      vendor_notify_failed,
      bosta_order_id,
      tracking_number,
      centers ( name, phone, logo_url, card_color ),
      shipping_zone
    `,
    )
    .not('payment_status', 'in', '(pending_payment,failed)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/admin/card-orders]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const list = rows ?? [];

  const orders: AdminCardOrderRow[] = list.map((row, i) => {
    const r = row as Record<string, unknown>;
    const center = pickCenterJoin(r);
    const students = parseStudents(r.students);
    return {
      id: String(r.id ?? ''),
      center_id: String(r.center_id ?? ''),
      orderNumber: `ORD-${String(i + 1).padStart(3, '0')}`,
      center_name: center?.name ?? '',
      center_phone: center?.phone ?? null,
      center_logo_url: center?.logo_url ?? null,
      card_color: typeof center?.card_color === 'string' && center.card_color ? center.card_color : '#0D9488',
      students,
      quantity: Number(r.quantity ?? 0),
      price_per_card: Number(r.price_per_card ?? 0),
      delivery_fee: Number(r.delivery_fee ?? 0),
      shipping_zone: r.shipping_zone != null ? String(r.shipping_zone) : null,
      total_amount: Number(r.total_amount ?? 0),
      delivery_address: r.delivery_address != null ? String(r.delivery_address) : null,
      notes: r.notes != null ? String(r.notes) : null,
      status: mapStatus(r.status as string),
      created_at:
        typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
      payment_status: r.payment_status != null ? String(r.payment_status) : null,
      vendor_sent_at: r.vendor_sent_at != null ? String(r.vendor_sent_at) : null,
      vendor_notify_failed: Boolean(r.vendor_notify_failed),
      bosta_order_id: r.bosta_order_id != null ? String(r.bosta_order_id) : null,
      tracking_number: r.tracking_number != null ? String(r.tracking_number) : null,
    };
  });

  return NextResponse.json({ orders });
}

async function handleOrderStatusUpdate(request: Request) {
  const { getAdminContext } = await import('@/lib/admin-auth');
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const orderId = (body.orderId ?? body.id) as string | undefined;
  const { status } = body;
  if (!orderId || !status) {
    return NextResponse.json({ error: 'orderId and status required' }, { status: 400 });
  }

  const result = await updateOrderStatus(ctx.supabaseAdmin, orderId, status);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ success: true });
}

export async function PUT(request: Request) {
  return handleOrderStatusUpdate(request);
}

export async function PATCH(request: Request) {
  return handleOrderStatusUpdate(request);
}
