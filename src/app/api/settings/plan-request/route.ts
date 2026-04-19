import { NextRequest, NextResponse } from 'next/server';
import { planRequestSchema } from '@/lib/validations';
import { validateCSRFRequest } from '@/lib/csrf';
import { requireCenterAuth } from '@/lib/centerAuth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;
    if (auth.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!validateCSRFRequest(request, auth.userId)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = planRequestSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
      return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 });
    }
    const { requested_plan } = parsed.data;

    const { data: center } = await auth.supabaseAdmin
      .from('centers')
      .select('id, plan, pricing_type')
      .eq('id', auth.centerId)
      .single();

    if (!center) return NextResponse.json({ error: 'Center not found' }, { status: 404 });

    const currentPlan = center.plan || 'starter';

    const { error: insertErr } = await auth.supabaseAdmin.from('plan_requests').insert({
      center_id: auth.centerId,
      current_plan: currentPlan,
      requested_plan,
      status: 'pending',
    });

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال طلبك. سيتم مراجعته خلال 24 ساعة.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
