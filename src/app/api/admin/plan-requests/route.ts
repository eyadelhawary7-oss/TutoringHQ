import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { supabaseAdmin } = ctx;

    const { data: requests, error } = await supabaseAdmin
      .from('plan_requests')
      .select(`
        id, center_id, current_plan, requested_plan, status,
        requested_at, approved_at, rejected_at, notes
      `)
      .order('requested_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const centerIds = [...new Set((requests || []).map((r: { center_id: string }) => r.center_id))];
    const { data: centers } = await supabaseAdmin
      .from('centers')
      .select('id, name')
      .in('id', centerIds);

    const centerMap = new Map((centers || []).map((c: { id: string; name: string }) => [c.id, c.name]));

    const rows = (requests || []).map((r: { center_id: string; [k: string]: unknown }) => ({
      ...r,
      centerName: centerMap.get(r.center_id) ?? '—',
    }));

    return NextResponse.json({ requests: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await getAdminContext(request);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { supabaseAdmin, userId } = ctx;
    const body = await request.json();
    const { requestId, action, notes } = body;

    if (!requestId || !action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'requestId and action (approve|reject) required' }, { status: 400 });
    }

    const { data: pr, error: fetchErr } = await supabaseAdmin
      .from('plan_requests')
      .select('id, center_id, current_plan, requested_plan, status')
      .eq('id', requestId)
      .single();

    if (fetchErr || !pr || pr.status !== 'pending') {
      return NextResponse.json({ error: 'Request not found or not pending' }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === 'reject') {
      await supabaseAdmin
        .from('plan_requests')
        .update({ status: 'rejected', rejected_at: now, notes: notes || null })
        .eq('id', requestId);

      try {
        await supabaseAdmin.from('audit_log').insert({
          center_id: pr.center_id,
          user_id: userId,
          action: 'admin_plan_request_rejected',
          entity_type: 'plan_requests',
          details: { request_id: requestId, requested_plan: pr.requested_plan },
        });
      } catch {
        // ignore
      }

      return NextResponse.json({ success: true, action: 'rejected' });
    }

    await supabaseAdmin
      .from('centers')
      .update({
        plan: pr.requested_plan,
        pending_plan_change: null,
        pending_billing_type: pr.requested_plan === 'payg' ? 'payg' : 'fixed',
      })
      .eq('id', pr.center_id);

    await supabaseAdmin
      .from('plan_requests')
      .update({ status: 'approved', approved_at: now, notes: notes || null })
      .eq('id', requestId);

    try {
      await supabaseAdmin.from('audit_log').insert({
        center_id: pr.center_id,
        user_id: userId,
        action: 'admin_plan_request_approved',
        entity_type: 'plan_requests',
        details: { request_id: requestId, old_plan: pr.current_plan, new_plan: pr.requested_plan },
      });
    } catch {
      // ignore
    }

    return NextResponse.json({ success: true, action: 'approved' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
