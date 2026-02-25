import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';

export async function GET(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized - admin access required' }, { status: 401 });
  }

  const supabaseAdmin = ctx.supabaseAdmin;
  const { data: orders, error } = await supabaseAdmin
    .from('card_orders')
    .select(`
      id,
      center_id,
      created_by,
      students,
      quantity,
      price_per_card,
      delivery_fee,
      total_amount,
      status,
      delivery_address,
      notes,
      created_at,
      centers(name, phone, logo_url)
    `)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ordersWithCenter = (orders || []).map((o: Record<string, unknown>) => {
    const centers = o.centers as { name?: string; phone?: string; logo_url?: string } | null;
    const { centers: _, ...rest } = o;
    return {
      ...rest,
      center_name: centers?.name ?? '—',
      center_phone: centers?.phone ?? null,
      center_logo_url: centers?.logo_url ?? null,
    };
  });

  return NextResponse.json({ orders: ordersWithCenter });
}

export async function PUT(request: Request) {
  const ctx = await getAdminContext(request);
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { orderId, status } = body;
  if (!orderId || !status) {
    return NextResponse.json({ error: 'orderId and status required' }, { status: 400 });
  }
  const validStatuses = ['pending', 'confirmed', 'printing', 'shipped', 'delivered'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  const { error } = await ctx.supabaseAdmin
    .from('card_orders')
    .update({ status })
    .eq('id', orderId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
