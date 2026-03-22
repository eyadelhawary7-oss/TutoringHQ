import { NextResponse } from 'next/server';
import { getAdminContext } from '@/lib/admin-auth';
import { adminPlanRequestsSchema } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';

const PLAN_MONTHLY: Record<string, number> = {
  starter: 2000, pro: 4500, business: 6500, enterprise: 9000, top_centers: 0, payg: 0,
};

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
      .select('id, name, phone, is_early_adopter, early_adopter_price')
      .in('id', centerIds);

    const centerMap = new Map((centers || []).map((c: { id: string; name: string; phone?: string; is_early_adopter?: boolean; early_adopter_price?: number }) => [c.id, c]));

    const rows = (requests || []).map((r: { center_id: string; current_plan?: string; requested_plan?: string; [k: string]: unknown }) => {
      const center = centerMap.get(r.center_id);
      const currentPrice = center?.is_early_adopter && typeof center?.early_adopter_price === 'number'
        ? center.early_adopter_price
        : PLAN_MONTHLY[(r.current_plan as string) || 'starter'] ?? 0;
      const requestedPrice = PLAN_MONTHLY[(r.requested_plan as string) || ''] ?? 0;
      const priceDiff = requestedPrice - currentPrice;
      return {
        ...r,
        centerName: center?.name ?? '—',
        centerPhone: center?.phone ?? null,
        currentPrice,
        requestedPrice,
        priceDiff,
        priceDiffFormatted: priceDiff > 0 ? `+${priceDiff.toLocaleString('ar-EG')} EGP/mo` : priceDiff < 0 ? `${priceDiff.toLocaleString('ar-EG')} EGP/mo` : '—',
      };
    });

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
    if (!validateCSRFRequest(request, ctx.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { supabaseAdmin, userId } = ctx;
    const body = await request.json();
    const parsed = adminPlanRequestsSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { requestId, action, notes } = parsed.data;

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

    const PLAN_LABELS: Record<string, string> = {
      starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', top_centers: 'Top Centers', payg: 'PAYG',
    };
    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('phone')
      .eq('id', pr.center_id)
      .single();
    const requestedLabel = PLAN_LABELS[(pr.requested_plan as string) || ''] || pr.requested_plan;
    const reqPrice = PLAN_MONTHLY[(pr.requested_plan as string) || ''] ?? 0;
    const waMessage = reqPrice > 0
      ? `مرحباً، تم الموافقة على ترقية خطتك إلى ${requestedLabel}. السعر الجديد: ${reqPrice.toLocaleString('ar-EG')} EGP/شهر. شكراً لثقتك!`
      : `مرحباً، تم الموافقة على تغيير خطتك إلى ${requestedLabel}. شكراً لثقتك!`;
    const phone = (center?.phone as string || '').trim();
    const waLink = phone ? `https://wa.me/${phone.startsWith('+') ? phone.slice(1).replace(/\D/g, '') : '20' + phone.replace(/^0/, '').replace(/\D/g, '')}?text=${encodeURIComponent(waMessage)}` : null;

    return NextResponse.json({
      success: true,
      action: 'approved',
      centerPhone: phone || null,
      whatsappLink: waLink,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
