/**
 * "No bill shock" — the current owner's projected first invoice during summer.
 * Returns the tier their usage places them in and the exact amount (subscription +
 * processing fee + VAT-inside lines) plus their computed first_invoice_at, so the
 * dashboard / billing area / onboarding can show the number weeks in advance.
 *
 * Returns { active: false } when summer mode is off (UI shows nothing).
 */

import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireCenterAuth, requireTeacherAuth } from '@/lib/centerAuth';
import { cairoDateKey } from '@/lib/cairo/day';
import { getSummerConfig } from '@/lib/summer/config';
import { computeSummerSchedule } from '@/lib/summer/dates';
import { projectCenterFirstInvoice, projectTeacherFirstInvoice } from '@/lib/summer/projection';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';

export const dynamic = 'force-dynamic';

async function countCenterActiveStudents(supabase: SupabaseClient, centerId: string): Promise<number> {
  const { count } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('center_id', centerId)
    .eq('is_active', true);
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  const summer = await getSummerConfig();
  if (!summer.enabled) return NextResponse.json({ active: false });

  const feeCfg = await getProcessingFeeConfig();
  const feeAmount = feeCfg.enabled ? feeCfg.amount : 0;
  const today = cairoDateKey(new Date());

  // Teacher session first (role-gated), then center.
  const tAuth = await requireTeacherAuth(request);
  if (tAuth.ok) {
    const supabase = tAuth.supabaseAdmin;
    const { data: sub } = await supabase
      .from('teacher_subscriptions')
      .select('created_at, summer_first_invoice_at, plan_key')
      .eq('teacher_id', tAuth.userId)
      .maybeSingle();
    // Teacher students are linked via groups, not a direct column. Project from the
    // teacher's current plan tier (a representative count that resolves to it), which
    // is the tier their usage placed them in and what they continue on after summer.
    const projection = projectTeacherFirstInvoice(representativeCount(sub?.plan_key), { feeAmount });
    const firstInvoiceAt = resolveFirstInvoiceAt(sub?.summer_first_invoice_at, sub?.created_at, summer, today);
    return NextResponse.json({ active: true, segment: 'teacher', firstInvoiceAt, projection });
  }

  const cAuth = await requireCenterAuth(request);
  if (!cAuth.ok) return cAuth.response;
  if (!cAuth.centerId || cAuth.role === 'super_admin') {
    return NextResponse.json({ active: false });
  }
  const supabase = cAuth.supabaseAdmin;
  const { data: center } = await supabase
    .from('centers')
    .select('created_at, summer_first_invoice_at')
    .eq('id', cAuth.centerId)
    .maybeSingle();
  const activeStudents = await countCenterActiveStudents(supabase, cAuth.centerId);
  const projection = projectCenterFirstInvoice(activeStudents, { feeAmount });
  const firstInvoiceAt = resolveFirstInvoiceAt(center?.summer_first_invoice_at, center?.created_at, summer, today);
  return NextResponse.json({ active: true, segment: 'center', firstInvoiceAt, projection });
}

/** A student count that resolves to the teacher's current plan tier (Standard/Pro/Scale). */
function representativeCount(planKey: string | null | undefined): number {
  if (planKey === 'teacher_pro') return 21; // 21..50 → Pro
  if (planKey === 'teacher_scale') return 51; // 51+ → Scale (base, no overage shown)
  return 1; // → Standard
}

/** Persisted first_invoice_at once enrolled; otherwise compute it from signup + config. */
function resolveFirstInvoiceAt(
  persisted: string | null | undefined,
  createdAt: string | null | undefined,
  summer: Awaited<ReturnType<typeof getSummerConfig>>,
  today: string,
): string {
  if (persisted) return persisted;
  const signup = createdAt ? cairoDateKey(new Date(createdAt)) : today;
  return computeSummerSchedule(signup, summer).firstInvoiceAt;
}
