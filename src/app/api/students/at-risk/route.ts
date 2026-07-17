import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getStudentBalances } from '@/lib/studentBalance';
import { centerAccessGateResponse } from '@/lib/centerAccessGate';

async function getContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '')?.trim();
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const {
    data: { user },
    error,
  } = await supabaseAuth.auth.getUser();
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
  /** Attendance success vs expected sessions in the rolling window (0–100). */
  attendance_rate_pct: number;
}

function rolling7DayUtcRange(): { fromTs: string; toTs: string; dayCount: number } {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 6);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  const dayCount =
    Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return {
    fromTs: start.toISOString(),
    toTs: end.toISOString(),
    dayCount: Math.max(1, dayCount),
  };
}

function isRosterActive(s: {
  is_active?: boolean | null;
  lifecycle_status?: string | null;
}): boolean {
  if (s.is_active === false) return false;
  const ls = s.lifecycle_status ?? '';
  if (ls === 'churned' || ls === 'inactive') return false;
  return true;
}

export interface AtRiskMeta {
  totalActive: number;
  /** Mean attendance rate across active students (same window as `/attendance`). */
  avgAttendancePct: number;
  atRiskCount: number;
}

/** GET: At-risk students vs roster attendance (rolling 7 days, session-aware expected scans). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { centerId, supabaseAdmin } = ctx;

    // Part 6 (BLOCK): a locked centre sees only the invoice and a pay button, and
    // this route exposes student PII (names, parent phones, balances). Inherit the
    // suspension / blacklist / single-day-lock gate the hand-rolled auth skipped.
    const gate = await centerAccessGateResponse(supabaseAdmin, centerId);
    if (gate) return gate;

    const { fromTs, toTs, dayCount } = rolling7DayUtcRange();

    const { data: rawStudents } = await supabaseAdmin
      .from('students')
      .select(
        'id, name, student_number, parent_phone, lifecycle_status, at_risk_since, created_at, is_active',
      )
      .eq('center_id', centerId);

    const students = (rawStudents ?? []).filter(isRosterActive);

    const balances = await getStudentBalances(supabaseAdmin, { centerId });

    const { data: scans } = await supabaseAdmin
      .from('attendance_scans')
      .select('student_id, scanned_at, group_id, session_date')
      .eq('center_id', centerId)
      .gte('scanned_at', fromTs)
      .lte('scanned_at', toTs);

    const { data: groups } = await supabaseAdmin
      .from('student_groups')
      .select('id')
      .eq('center_id', centerId);

    const groupIds = (groups ?? []).map((g) => (g as { id: string }).id);
    let members: { student_id: string; group_id: string }[] = [];
    if (groupIds.length > 0) {
      const { data: m } = await supabaseAdmin
        .from('student_group_members')
        .select('student_id, group_id')
        .in('group_id', groupIds);
      members = (m ?? []) as { student_id: string; group_id: string }[];
    }

    const studentGroupMap: Record<string, string[]> = {};
    members.forEach((m) => {
      if (!studentGroupMap[m.student_id]) studentGroupMap[m.student_id] = [];
      studentGroupMap[m.student_id]!.push(m.group_id);
    });

    const sessionDatesByGroup: Record<string, Set<string>> = {};
    (scans ?? []).forEach((row) => {
      const r = row as {
        group_id?: string | null;
        session_date?: string | null;
      };
      if (r.group_id && r.session_date) {
        if (!sessionDatesByGroup[r.group_id]) sessionDatesByGroup[r.group_id] = new Set();
        sessionDatesByGroup[r.group_id]!.add(r.session_date);
      }
    });

    const scanCount: Record<string, number> = {};
    (scans ?? []).forEach((row) => {
      const r = row as { student_id: string };
      scanCount[r.student_id] = (scanCount[r.student_id] || 0) + 1;
    });

    const expectedByStudent: Record<string, number> = {};
    Object.entries(studentGroupMap).forEach(([sid, gids]) => {
      let exp = 0;
      gids.forEach((gid) => {
        exp += sessionDatesByGroup[gid]?.size ?? 0;
      });
      expectedByStudent[sid] = exp;
    });

    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    const { data: lastScansAll } = await supabaseAdmin
      .from('attendance_scans')
      .select('student_id, scanned_at')
      .eq('center_id', centerId)
      .order('scanned_at', { ascending: false });

    const lastScanByStudent = new Map<string, string>();
    for (const row of lastScansAll ?? []) {
      const r = row as { student_id: string; scanned_at: string };
      if (!lastScanByStudent.has(r.student_id)) lastScanByStudent.set(r.student_id, r.scanned_at);
    }

    type Evaluated = {
      student: (typeof students)[0];
      scans: number;
      expected: number;
      maxPossible: number;
      ratePct: number;
      enrolledDays: number;
      atRisk: boolean;
    };

    const evaluated: Evaluated[] = [];

    for (const s of students) {
      const scans7 = scanCount[s.id] ?? 0;
      const expected = expectedByStudent[s.id] ?? 0;
      const maxPossible = expected > 0 ? expected : dayCount;
      const ratePct = maxPossible > 0 ? (scans7 / maxPossible) * 100 : 0;
      const created = new Date((s as { created_at?: string }).created_at ?? 0).getTime();
      const enrolledDays = Number.isNaN(created) ? 0 : Math.floor((now - created) / msPerDay);

      const atRisk =
        enrolledDays > 7 && (scans7 === 0 || ratePct < 60);

      evaluated.push({
        student: s,
        scans: scans7,
        expected,
        maxPossible,
        ratePct,
        enrolledDays,
        atRisk,
      });
    }

    const totalActive = evaluated.length;
    const avgAttendancePct =
      totalActive > 0
        ? evaluated.reduce((sum, e) => sum + Math.min(100, e.ratePct), 0) / totalActive
        : 0;

    const atRiskRows = evaluated.filter((e) => e.atRisk);

    const result: AtRiskStudent[] = atRiskRows.map((e) => {
      const s = e.student;
      const lastScanAt = lastScanByStudent.get(s.id) ?? null;
      const daysSinceLastScan = lastScanAt
        ? Math.floor((now - new Date(lastScanAt).getTime()) / msPerDay)
        : 999;

      return {
        id: s.id,
        name: (s as { name?: string }).name ?? '',
        student_number: (s as { student_number?: string | null }).student_number ?? null,
        parent_phone: (s as { parent_phone?: string | null }).parent_phone ?? null,
        balance_due: balances.get(s.id)?.balance ?? 0,
        lifecycle_status: (s as { lifecycle_status?: string }).lifecycle_status ?? 'active',
        at_risk_since: (s as { at_risk_since?: string | null }).at_risk_since ?? null,
        days_since_last_scan: daysSinceLastScan,
        last_scan_at: lastScanAt,
        attendance_rate_pct: Math.round(Math.min(100, e.ratePct) * 10) / 10,
      };
    });

    const meta: AtRiskMeta = {
      totalActive,
      avgAttendancePct: Math.round(avgAttendancePct * 10) / 10,
      atRiskCount: result.length,
    };

    return NextResponse.json({ students: result, meta });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
