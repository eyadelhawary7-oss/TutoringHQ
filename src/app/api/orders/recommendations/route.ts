import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';

export const dynamic = 'force-dynamic';

/** Order statuses that imply the centre already has / will receive cards for those line items. */
const BLOCKING_ORDER_STATUSES = [
  'delivered',
  'issued',
  'paid',
  'in_production',
  'in_transit',
  'vendor_assigned',
  'ready_for_pickup',
];

export async function GET(request: NextRequest) {
  const auth = await requireCenterAuth(request);
  if (!auth.ok) return auth.response;

  const { supabaseAdmin, centerId } = auth;

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const { data: blockingOrders, error: boErr } = await supabaseAdmin
    .from('card_orders')
    .select('id')
    .eq('center_id', centerId)
    .in('status', BLOCKING_ORDER_STATUSES);

  if (boErr) {
    console.error('[recommendations] orders', boErr.message);
    return NextResponse.json({ error: boErr.message }, { status: 500 });
  }

  const orderIds = (blockingOrders ?? []).map((o) => String((o as { id: string }).id)).filter(Boolean);

  const blockedStudentIds = new Set<string>();
  if (orderIds.length > 0) {
    const { data: blockingItems, error: biErr } = await supabaseAdmin
      .from('card_order_items')
      .select('student_id')
      .in('card_order_id', orderIds)
      .not('student_id', 'is', null);

    if (biErr) {
      console.error('[recommendations] items', biErr.message);
      return NextResponse.json({ error: biErr.message }, { status: 500 });
    }

    for (const row of blockingItems ?? []) {
      const sid = (row as { student_id?: string | null }).student_id;
      if (sid) blockedStudentIds.add(sid);
    }
  }

  const { data: allStudents, error: stErr } = await supabaseAdmin
    .from('students')
    .select('id, name, student_number, created_at, is_active')
    .eq('center_id', centerId)
    .eq('is_active', true)
    .order('name', { ascending: true })
    .limit(500);

  if (stErr) {
    return NextResponse.json({ error: stErr.message }, { status: 500 });
  }

  const students = (allStudents ?? []) as {
    id: string;
    name: string | null;
    student_number: string | null;
    created_at: string | null;
    is_active: boolean | null;
  }[];

  const withoutCards = students.filter((s) => !blockedStudentIds.has(s.id)).slice(0, 10);

  const recent = students
    .filter((s) => s.created_at && new Date(s.created_at) >= since)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 10);

  const { data: deliveredOrders, error: ordErr } = await supabaseAdmin
    .from('card_orders')
    .select('id, quantity, total_amount, created_at, status')
    .eq('center_id', centerId)
    .in('status', ['delivered', 'issued'])
    .order('created_at', { ascending: false })
    .limit(3);

  if (ordErr) {
    return NextResponse.json({ error: ordErr.message }, { status: 500 });
  }

  return NextResponse.json({
    studentsWithoutCards: withoutCards.map((s) => ({
      id: s.id,
      name: s.name ?? '',
      student_number: s.student_number,
    })),
    recentlyAddedStudents: recent.map((s) => ({
      id: s.id,
      name: s.name ?? '',
      student_number: s.student_number,
    })),
    lastDeliveredOrders: (deliveredOrders ?? []).map((o) => ({
      id: String((o as { id: string }).id),
      quantity: Number((o as { quantity?: number }).quantity ?? 0),
      total_amount: Number((o as { total_amount?: number }).total_amount ?? 0),
      created_at: String((o as { created_at?: string }).created_at ?? ''),
      status: String((o as { status?: string }).status ?? ''),
    })),
  });
}
