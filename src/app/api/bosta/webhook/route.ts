import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ received: true });
  }

  const supabaseAdmin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ received: true });
  }

  const data = body.data as Record<string, unknown> | undefined;
  const trackingNumber =
    (typeof data?.trackingNumber === 'string' ? data.trackingNumber : null) ??
    (typeof body.trackingNumber === 'string' ? body.trackingNumber : null) ??
    (typeof data?._id === 'string' ? data._id : null);

  const bostaStatus =
    (typeof data?.status === 'string' ? data.status : null) ??
    (typeof body.status === 'string' ? body.status : null) ??
    (typeof body.type === 'string' ? body.type : null);

  if (!trackingNumber || !bostaStatus) {
    return NextResponse.json({ received: true });
  }

  const statusMap: Record<string, string> = {
    DELIVERED: 'delivered',
    RECEIVED: 'shipped',
    NOT_DELIVERED: 'shipped',
    CANCELLED: 'paid',
    OUT_FOR_DELIVERY: 'shipped',
  };

  const key = String(bostaStatus).toUpperCase().replace(/-/g, '_');
  const newStatus = statusMap[key];
  if (!newStatus) {
    console.log(`[bosta-webhook] Unhandled status: ${bostaStatus}`);
    return NextResponse.json({ received: true });
  }

  const { data: order } = await supabaseAdmin
    .from('card_orders')
    .select('id, status')
    .eq('tracking_number', trackingNumber)
    .maybeSingle();

  if (!order) {
    console.warn(`[bosta-webhook] No order for tracking: ${trackingNumber}`);
    return NextResponse.json({ received: true });
  }

  const ord = order as { id: string };
  const updateData: { status: string; delivered_at?: string } = { status: newStatus };
  if (newStatus === 'delivered') {
    updateData.delivered_at = new Date().toISOString();
  }

  const { error } = await supabaseAdmin.from('card_orders').update(updateData).eq('id', ord.id);
  if (error) {
    console.error('[bosta-webhook] update:', error);
  } else {
    console.log(`[bosta-webhook] Order ${ord.id} → ${newStatus}`);
  }

  return NextResponse.json({ received: true });
}
