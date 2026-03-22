import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

async function getContext(request: NextRequest) {
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

  let centerId = (userRecord as { center_id?: string } | null)?.center_id;
  if (!centerId && (userRecord as { organization_id?: string } | null)?.organization_id) {
    const { data: firstCenter } = await supabaseAdmin
      .from('centers')
      .select('id')
      .eq('organization_id', (userRecord as { organization_id: string }).organization_id)
      .limit(1)
      .maybeSingle();
    centerId = (firstCenter as { id?: string } | null)?.id ?? undefined;
  }
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

export interface AtRiskStudent {
  id: string;
  name: string;
  student_number?: string | null;
  parent_phone?: string | null;
  balance_due: number;
  lifecycle_status: string;
  at_risk_since: string | null;
  days_since_last_scan: number;
  last_scan_at: string | null;
}

/** GET: List at-risk students (lifecycle_status = 'at_risk' or 'inactive') */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { centerId, supabaseAdmin } = ctx;

    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, name, student_number, parent_phone, balance_due, lifecycle_status, at_risk_since')
      .eq('center_id', centerId)
      .in('lifecycle_status', ['at_risk', 'inactive'])
      .order('at_risk_since', { ascending: true, nullsFirst: false });

    if (!students || students.length === 0) {
      return NextResponse.json({ students: [] });
    }

    const studentIds = students.map((s) => s.id);

    const { data: lastScans } = await supabaseAdmin
      .from('attendance_scans')
      .select('student_id, scanned_at')
      .eq('center_id', centerId)
      .in('student_id', studentIds)
      .order('scanned_at', { ascending: false });

    const lastScanByStudent = new Map<string, { scanned_at: string }>();
    for (const row of lastScans ?? []) {
      const r = row as { student_id: string; scanned_at: string };
      if (!lastScanByStudent.has(r.student_id)) {
        lastScanByStudent.set(r.student_id, { scanned_at: r.scanned_at });
      }
    }

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    const result: AtRiskStudent[] = students.map((s) => {
      const lastScan = lastScanByStudent.get(s.id);
      const lastScanAt = lastScan?.scanned_at ?? null;
      const daysSinceLastScan = lastScanAt
        ? Math.floor((now - new Date(lastScanAt).getTime()) / msPerDay)
        : 999;

      return {
        id: s.id,
        name: (s as { name?: string }).name ?? '',
        student_number: (s as { student_number?: string | null }).student_number ?? null,
        parent_phone: (s as { parent_phone?: string | null }).parent_phone ?? null,
        balance_due: Number((s as { balance_due?: number }).balance_due ?? 0),
        lifecycle_status: (s as { lifecycle_status?: string }).lifecycle_status ?? 'at_risk',
        at_risk_since: (s as { at_risk_since?: string | null }).at_risk_since ?? null,
        days_since_last_scan: daysSinceLastScan,
        last_scan_at: lastScanAt,
      };
    });

    return NextResponse.json({ students: result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
