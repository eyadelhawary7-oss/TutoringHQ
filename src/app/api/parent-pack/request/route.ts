import { NextRequest, NextResponse } from 'next/server';
import { requireOwnerAdminCenter } from '@/lib/requireOwnerAdminCenter';
import type { SupabaseClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

async function tryAutoApprovePack(supabase: SupabaseClient, centerId: string): Promise<boolean> {
  const { data: flagRow } = await supabase
    .from('platform_config')
    .select('value')
    .eq('key', 'auto_approve_pack')
    .maybeSingle();

  if (!flagRow?.value) return false;

  const { data: center } = await supabase
    .from('centers')
    .select(
      `status, subscription_status, billing_status,
        next_payment_due, plan, pack_custom_invoice_minimum`,
    )
    .eq('id', centerId)
    .maybeSingle();

  if (!center) return false;

  const c = center as {
    status?: string | null;
    subscription_status?: string | null;
    billing_status?: string | null;
    next_payment_due?: string | null;
    plan?: string | null;
    pack_custom_invoice_minimum?: number | null;
  };

  const daysUntilDue = c.next_payment_due
    ? Math.floor((new Date(c.next_payment_due).getTime() - Date.now()) / 86400000)
    : -1;

  const conditionsMet =
    c.status === 'active' &&
    c.subscription_status === 'active' &&
    ['active', 'paid'].includes(String(c.billing_status ?? '')) &&
    daysUntilDue > 14 &&
    (c.plan !== 'top_centers' || Number(c.pack_custom_invoice_minimum ?? 0) > 0);

  if (!conditionsMet) return false;

  const requiredNames = ['chq_parent_welcome', 'chq_parent_absence'] as const;
  const { data: templates } = await supabase
    .from('wa_meta_templates')
    .select('template_name, status')
    .in('template_name', [...requiredNames]);

  const statusByName = new Map((templates ?? []).map((t) => [t.template_name, t.status]));
  const allActive = requiredNames.every((name) => statusByName.get(name) === 'APPROVED');
  if (!allActive) return false;

  const { error: updErr } = await supabase
    .from('centers')
    .update({
      pack_request_status: 'approved',
      pack_approved_at: new Date().toISOString(),
      parent_pack_enabled: true,
    })
    .eq('id', centerId);

  if (updErr) {
    console.error('[tryAutoApprovePack] update', updErr);
    return false;
  }

  const { error: prErr } = await supabase
    .from('pack_requests')
    .update({ status: 'approved' })
    .eq('center_id', centerId)
    .eq('status', 'pending_approval');

  if (prErr) {
    console.error('[tryAutoApprovePack] pack_requests', prErr);
  }

  return true;
}

export async function POST(request: NextRequest) {
  const ctx = await requireOwnerAdminCenter(request);
  if (ctx instanceof NextResponse) return ctx;

  const { supabaseAdmin, centerId } = ctx;

  const { data: center, error: fetchErr } = await supabaseAdmin
    .from('centers')
    .select('pack_request_status')
    .eq('id', centerId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[POST /api/parent-pack/request]', fetchErr);
    return NextResponse.json({ error: 'Failed to load center' }, { status: 500 });
  }

  const status = center?.pack_request_status as string | undefined;
  if (status === 'approved') {
    return NextResponse.json({ error: 'already_active' }, { status: 400 });
  }
  if (status === 'pending') {
    return NextResponse.json({ error: 'already_pending' }, { status: 400 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from('centers')
    .update({
      pack_request_status: 'pending',
      pack_requested_at: new Date().toISOString(),
      pack_rejection_reason: null,
    })
    .eq('id', centerId);

  if (updateErr) {
    console.error('[POST /api/parent-pack/request] update', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  const { data: openPack } = await supabaseAdmin
    .from('pack_requests')
    .select('id')
    .eq('center_id', centerId)
    .not('status', 'in', '(issued,cancelled)')
    .maybeSingle();

  if (!openPack) {
    const { error: insErr } = await supabaseAdmin.from('pack_requests').insert({
      center_id: centerId,
      status: 'pending_approval',
    });
    if (insErr) {
      console.error('[POST /api/parent-pack/request] pack_requests insert', insErr);
    }
  }

  const autoApproved = await tryAutoApprovePack(supabaseAdmin, centerId);
  return NextResponse.json({ success: true, autoApproved });
}
