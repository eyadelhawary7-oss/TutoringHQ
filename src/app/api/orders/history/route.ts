import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const ACTIVE_STATUSES = ['paid', 'vendor_assigned', 'in_production', 'ready_for_pickup', 'in_transit'];
const DELIVERED_STATUSES = ['delivered', 'issued'];
const CANCELLED_STATUSES = ['cancelled', 'refunded'];
const FAILED_STATUSES = ['failed'];

function parseFilter(raw: string | null): 'all' | 'active' | 'delivered' | 'cancelled' | 'failed' {
  const x = (raw ?? 'all').trim().toLowerCase();
  if (x === 'active' || x === 'delivered' || x === 'cancelled' || x === 'failed') return x;
  return 'all';
}

function parseSort(raw: string | null): 'created_at' | 'status' | 'quantity' | 'total_amount' {
  const x = (raw ?? 'created_at').trim().toLowerCase();
  if (x === 'status' || x === 'quantity' || x === 'total_amount') return x;
  return 'created_at';
}

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;
  const { supabaseAdmin, centerId } = auth;

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Math.round(Number(sp.get('page') ?? '1')) || 1);
  const filter = parseFilter(sp.get('filter'));
  const sort = parseSort(sp.get('sort'));
  const dirParam = (sp.get('dir') ?? 'desc').trim().toLowerCase();
  const ascending = dirParam === 'asc';
  const q = (sp.get('q') ?? '').trim();

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  async function matchingIdsForSearch(search: string): Promise<string[] | null> {
    if (!search) return null;
    const ids = new Set<string>();

    const { data: byFrag } = await supabaseAdmin
      .from('card_orders')
      .select('id')
      .eq('center_id', centerId)
      .ilike('id', `%${search}%`);

    for (const r of byFrag ?? []) ids.add((r as { id: string }).id);

    const compact = search.replace(/-/g, '').toUpperCase();
    if (compact.length >= 6) {
      const { data: recent } = await supabaseAdmin
        .from('card_orders')
        .select('id')
        .eq('center_id', centerId)
        .order('created_at', { ascending: false })
        .limit(800);

      for (const r of recent ?? []) {
        const id = (r as { id: string }).id;
        if (id.replace(/-/g, '').toUpperCase().endsWith(compact)) ids.add(id);
      }
    }

    const { data: studs } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('center_id', centerId)
      .ilike('name', `%${search}%`);

    const studIds = (studs ?? []).map((s: { id: string }) => s.id);
    if (studIds.length) {
      const { data: lines } = await supabaseAdmin
        .from('card_order_items')
        .select('card_order_id')
        .in('student_id', studIds);

      const orderIds = [...new Set((lines ?? []).map((l: { card_order_id: string }) => l.card_order_id))];
      if (orderIds.length) {
        const { data: scoped } = await supabaseAdmin
          .from('card_orders')
          .select('id')
          .eq('center_id', centerId)
          .in('id', orderIds);

        for (const r of scoped ?? []) ids.add((r as { id: string }).id);
      }
    }

    return [...ids];
  }

  let query = supabaseAdmin
    .from('card_orders')
    .select(
      // `tracking_number` verified present on public.card_orders in the live
      // catalogue (information_schema.columns) before being added here — it
      // backs §01's row-level "Track shipment" action.
      'id, center_id, students, quantity, price_per_card, delivery_fee, shipping_zone, total_amount, status, delivery_address, notes, created_at, tracking_number',
      { count: 'exact' },
    )
    .eq('center_id', centerId);

  if (filter === 'active') query = query.in('status', ACTIVE_STATUSES);
  else if (filter === 'delivered') query = query.in('status', DELIVERED_STATUSES);
  else if (filter === 'cancelled') query = query.in('status', CANCELLED_STATUSES);
  else if (filter === 'failed') query = query.in('status', FAILED_STATUSES);

  const idFilter = await matchingIdsForSearch(q);
  if (q && idFilter && idFilter.length === 0) {
    return NextResponse.json({ orders: [], total: 0, page, pageSize: PAGE_SIZE });
  }
  if (idFilter && idFilter.length) {
    query = query.in('id', idFilter);
  }

  query = query.order(sort, { ascending, nullsFirst: false }).range(from, to);

  const { data: rows, error, count } = await query;

  if (error) {
    console.error('[orders/history]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    orders: rows ?? [],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  });
}
