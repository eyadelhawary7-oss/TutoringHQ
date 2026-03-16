import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getOrgContext(request: NextRequest) {
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

  return { organizationId: orgId, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getOrgContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { organizationId, supabaseAdmin } = ctx;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const { data: centers } = await supabaseAdmin
      .from('centers')
      .select('id, name')
      .eq('organization_id', organizationId);

    const centerIds = (centers ?? []).map((c) => c.id);
    if (centerIds.length === 0) {
      return NextResponse.json({
        total_mrr: 0,
        total_students: 0,
        total_outstanding: 0,
        by_branch: [],
      });
    }

    const byBranch: { center_id: string; name: string; mrr: number; students: number; outstanding: number; staff_count: number }[] = [];
    let totalMrr = 0;
    let totalStudents = 0;
    let totalOutstanding = 0;

    for (const c of centers ?? []) {
      const [paymentsRes, studentsRes, studentCountRes, staffCountRes] = await Promise.all([
        supabaseAdmin
          .from('payments')
          .select('amount, paid_at, status')
          .eq('center_id', c.id)
          .gte('paid_at', monthStart.toISOString())
          .lte('paid_at', monthEnd.toISOString()),
        supabaseAdmin
          .from('students')
          .select('id, balance_due')
          .eq('center_id', c.id),
        supabaseAdmin
          .from('students')
          .select('*', { count: 'exact', head: true })
          .eq('center_id', c.id),
        supabaseAdmin
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('center_id', c.id),
      ]);

      const payments = paymentsRes.data ?? [];
      const students = studentsRes.data ?? [];
      const studentCount = (studentCountRes as { count?: number }).count ?? 0;
      const staffCount = (staffCountRes as { count?: number }).count ?? 0;

      const confirmed = payments.filter((p: { status?: string }) => p.status === 'confirmed' || p.status === 'paid');
      const mrr = confirmed.reduce((s: number, p: { amount?: number }) => s + (p.amount ?? 0), 0);
      const outstanding = students.reduce((s: number, st: { balance_due?: number }) => s + (Number(st.balance_due) || 0), 0);

      totalMrr += mrr;
      totalStudents += studentCount;
      totalOutstanding += outstanding;

      byBranch.push({
        center_id: c.id,
        name: (c as { name?: string }).name ?? '',
        mrr,
        students: studentCount,
        outstanding,
        staff_count: staffCount,
      });
    }

    return NextResponse.json({
      total_mrr: totalMrr,
      total_students: totalStudents,
      total_outstanding: totalOutstanding,
      by_branch: byBranch,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
