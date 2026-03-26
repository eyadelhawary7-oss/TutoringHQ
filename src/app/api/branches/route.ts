import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { PLANS, isPlanKey, type PlanKey } from '@/lib/pricing';

async function getAuthContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id, organization_id')
    .eq('id', user.id)
    .single();

  let orgId = (userRecord as { organization_id?: string } | null)?.organization_id;
  if (!orgId && (userRecord as { center_id?: string } | null)?.center_id) {
    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('organization_id')
      .eq('id', (userRecord as { center_id: string }).center_id)
      .single();
    orgId = (center as { organization_id?: string } | null)?.organization_id ?? undefined;
  }
  if (!orgId) return null;

  return { organizationId: orgId, userId: user.id, supabaseAdmin };
}

/** POST: Add a new branch (center) to the user's organization. Owner only. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { organizationId, supabaseAdmin } = ctx;

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', ctx.userId)
      .single();

    if ((userRecord as { role?: string } | null)?.role !== 'owner') {
      return NextResponse.json({ error: 'Only owners can add branches' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'Branch name required (min 2 characters)' }, { status: 400 });
    }

    // Get first center in org for plan/billing defaults
    const { data: firstCenter } = await supabaseAdmin
      .from('centers')
      .select('plan, billing_type, billing_period, billing_amount, all_in_price, phone, owner_name')
      .eq('organization_id', organizationId)
      .limit(1)
      .maybeSingle();

    const fc = firstCenter as {
      plan?: string;
      billing_type?: string;
      billing_period?: string;
      billing_amount?: number;
      all_in_price?: number;
      phone?: string;
      owner_name?: string;
    } | null;
    const pk: PlanKey = isPlanKey(fc?.plan) ? (fc!.plan as PlanKey) : 'starter';
    const parentQuarterly =
      fc?.all_in_price != null && Number(fc.all_in_price) > 0
        ? Number(fc.all_in_price)
        : pk === 'top_centers'
          ? 0
          : PLANS[pk].quarterlyAllIn;
    const insert: Record<string, unknown> = {
      name,
      organization_id: organizationId,
      plan: fc?.plan ?? 'starter',
      billing_type: fc?.billing_type ?? 'fixed',
      billing_period: fc?.billing_period ?? 'quarterly',
      billing_amount: fc?.billing_amount ?? parentQuarterly,
      all_in_price: fc?.all_in_price ?? parentQuarterly,
      status: 'active',
      owner_name: fc?.owner_name ?? '',
      phone: fc?.phone ?? null,
    };

    const { data: newCenter, error } = await supabaseAdmin
      .from('centers')
      .insert(insert)
      .select('id, name')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update org plan to 'multi' if this is the first additional branch
    const { count } = await supabaseAdmin
      .from('centers')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', organizationId);

    if ((count ?? 0) >= 2) {
      await supabaseAdmin
        .from('organizations')
        .update({ plan: 'multi' })
        .eq('id', organizationId);
    }

    return NextResponse.json({ branch: newCenter });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/** GET: List all branches (centers) in the user's organization. Respects branch_user_assignments. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getAuthContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { organizationId, userId, supabaseAdmin } = ctx;

    // Get centers in org. If user has branch_user_assignments for this org, filter to those only.
    const { data: assignments } = await supabaseAdmin
      .from('branch_user_assignments')
      .select('center_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId);

    const hasAssignments = (assignments?.length ?? 0) > 0;
    const assignedCenterIds = (assignments ?? []).map((a) => a.center_id);

    let query = supabaseAdmin
      .from('centers')
      .select('id, name, logo_url')
      .eq('organization_id', organizationId)
      .order('name');

    if (hasAssignments) {
      query = query.in('id', assignedCenterIds);
    }

    const { data: centers, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get org plan
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan')
      .eq('id', organizationId)
      .single();

    return NextResponse.json({
      branches: centers ?? [],
      plan: (org as { plan?: string } | null)?.plan ?? 'single',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
