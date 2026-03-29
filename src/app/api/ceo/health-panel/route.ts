import { requireSuperAdminApi } from '@/lib/admin-auth';
import type { CenterHealthRow, HealthPanelResponse, HealthSummary } from '@/types/founder-dash';
import { NextResponse } from 'next/server';

type CenterDbRow = {
  id: string;
  name: string;
  district: string | null;
  plan: string;
  status: string;
  subscription_status: string;
  health_score: number | null;
  health_score_band: string | null;
};

type ScanRow = { center_id: string; scanned_at: string };

export async function GET(req: Request) {
  const auth = await requireSuperAdminApi(req);
  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = auth.supabaseAdmin;

  const [centersRes, scansRes] = await Promise.all([
    supabaseAdmin
      .from('centers')
      .select(
        'id, name, district, plan, status, subscription_status, health_score, health_score_band',
      )
      .eq('status', 'active')
      .order('health_score', { ascending: true, nullsFirst: true }),
    supabaseAdmin
      .from('attendance_scans')
      .select('center_id, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(500),
  ]);

  const centerRows: CenterDbRow[] =
    !centersRes.error && centersRes.data ? (centersRes.data as CenterDbRow[]) : [];
  const scanRows: ScanRow[] =
    !scansRes.error && scansRes.data ? (scansRes.data as ScanRow[]) : [];

  const lastScanMap = new Map<string, string>();
  for (const scan of scanRows) {
    if (!lastScanMap.has(scan.center_id)) {
      lastScanMap.set(scan.center_id, scan.scanned_at);
    }
  }

  const centers: CenterHealthRow[] = centerRows.map((c) => ({
    id: c.id,
    name: c.name,
    district: c.district,
    plan: c.plan,
    status: c.status,
    subscription_status: c.subscription_status,
    health_score:
      c.health_score != null && Number.isFinite(Number(c.health_score))
        ? Number(c.health_score)
        : null,
    health_score_band: c.health_score_band,
    last_scan_at: lastScanMap.get(c.id) ?? null,
  }));

  const summary: HealthSummary = {
    healthy: centers.filter((c) => c.health_score_band === 'Healthy').length,
    engaged: centers.filter((c) => c.health_score_band === 'Engaged').length,
    atRisk: centers.filter((c) => c.health_score_band === 'At Risk').length,
    critical: centers.filter((c) => c.health_score_band === 'Critical').length,
    noScore: centers.filter((c) => c.health_score_band === null).length,
  };

  return NextResponse.json({ centers, summary } satisfies HealthPanelResponse);
}
