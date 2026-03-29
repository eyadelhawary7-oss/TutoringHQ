import { requireSuperAdminApi } from '@/lib/admin-auth';
import type { DistrictRow, GrowthPanelResponse, PipelineStage } from '@/types/founder-dash';
import { NextResponse } from 'next/server';

type LeadRow = { id: string; stage: string; district: string | null };
type CenterGeoRow = { id: string; district: string | null };
type ReferralRow = { id: string; referrer_center_id: string; status: string };
type CommissionRow = { commission_amount: number | string | null; status: string };

const STAGE_ORDER = ['lead', 'demo', 'trial', 'closed', 'lost'] as const;
const UNKNOWN = '__unknown__';

export async function GET(req: Request) {
  const auth = await requireSuperAdminApi(req);
  if (!auth.ok) {
    return auth.response;
  }

  const supabaseAdmin = auth.supabaseAdmin;

  const [leadsRes, centersRes, referralsRes, commissionsRes] = await Promise.all([
    supabaseAdmin.from('sales_leads').select('id, stage, district'),
    supabaseAdmin.from('centers').select('id, district').eq('status', 'active'),
    supabaseAdmin.from('referrals').select('id, referrer_center_id, status'),
    supabaseAdmin.from('referral_commissions').select('commission_amount, status'),
  ]);

  const leadsRows: LeadRow[] =
    !leadsRes.error && leadsRes.data ? (leadsRes.data as LeadRow[]) : [];
  const centerRows: CenterGeoRow[] =
    !centersRes.error && centersRes.data ? (centersRes.data as CenterGeoRow[]) : [];
  const referralRows: ReferralRow[] =
    !referralsRes.error && referralsRes.data ? (referralsRes.data as ReferralRow[]) : [];
  const commissionRows: CommissionRow[] =
    !commissionsRes.error && commissionsRes.data
      ? (commissionsRes.data as CommissionRow[])
      : [];

  const stageMap = new Map<string, number>();
  STAGE_ORDER.forEach((s) => stageMap.set(s, 0));
  for (const row of leadsRows) {
    stageMap.set(row.stage, (stageMap.get(row.stage) ?? 0) + 1);
  }

  const stages: PipelineStage[] = STAGE_ORDER.map((s) => ({
    stage: s,
    count: stageMap.get(s) ?? 0,
  }));

  const totalActive = (['lead', 'demo', 'trial', 'closed'] as const).reduce(
    (s, k) => s + (stageMap.get(k) ?? 0),
    0,
  );

  const geoMap = new Map<string, { centerCount: number; leadCount: number }>();

  for (const c of centerRows) {
    const key = c.district ?? UNKNOWN;
    const entry = geoMap.get(key) ?? { centerCount: 0, leadCount: 0 };
    geoMap.set(key, { ...entry, centerCount: entry.centerCount + 1 });
  }
  for (const l of leadsRows) {
    const key = l.district ?? UNKNOWN;
    const entry = geoMap.get(key) ?? { centerCount: 0, leadCount: 0 };
    geoMap.set(key, { ...entry, leadCount: entry.leadCount + 1 });
  }

  const geography: DistrictRow[] = Array.from(geoMap.entries())
    .map(([key, val]) => ({
      district: key === UNKNOWN ? null : key,
      centerCount: val.centerCount,
      leadCount: val.leadCount,
    }))
    .sort(
      (a, b) =>
        b.centerCount - a.centerCount || b.leadCount - a.leadCount,
    );

  const totalReferrals = referralRows.length;
  const converted = referralRows.filter(
    (r) => r.status === 'converted' || r.status === 'active',
  ).length;
  const totalReferrers = new Set(referralRows.map((r) => r.referrer_center_id)).size;
  const conversionRate =
    totalReferrals > 0 ? Math.round((converted / totalReferrals) * 100) : 0;
  const commissionsOwed = commissionRows
    .filter((r) => r.status === 'hold' || r.status === 'withdrawable')
    .reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);
  const commissionsPaid = commissionRows
    .filter((r) => r.status === 'paid')
    .reduce((s, r) => s + Number(r.commission_amount ?? 0), 0);

  return NextResponse.json({
    pipeline: { stages, totalActive },
    geography,
    referral: {
      totalReferrers,
      totalReferrals,
      converted,
      conversionRate,
      commissionsOwed,
      commissionsPaid,
    },
  } satisfies GrowthPanelResponse);
}
