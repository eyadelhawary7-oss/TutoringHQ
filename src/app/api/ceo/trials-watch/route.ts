import { requireSuperAdminApi } from '@/lib/admin-auth';
import { cairoDateKey, cairoYmdPlusDays } from '@/lib/cairo/day';
import type { CeoTrialsWatch } from '@/types/ceo';
import { NextResponse } from 'next/server';

/**
 * GET /api/ceo/trials-watch — super_admin-only trials snapshot for the CEO home.
 *
 *   centers_in_trial   centers.summer_status = 'enrolled'   (is_test excluded)
 *   converted_to_paid  centers.summer_status = 'paid'       (is_test excluded)
 *   trials_ending_7d   enrolled centers whose summer_first_invoice_at lands in
 *                      the next 7 Cairo calendar days (today .. today+7 inclusive)
 *   teachers_in_trial  teacher_subscriptions.status = 'trialing', excluding subs
 *                      belonging to test teacher_profiles (is_test)
 *
 * Read-only. Money engines are untouched — this only counts existing rows.
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdminApi(req);
  if (!auth.ok) {
    return auth.response;
  }
  const supabase = auth.supabaseAdmin;

  // Cairo calendar window for "ending soon" (summer_first_invoice_at is a date).
  const todayKey = cairoDateKey();
  const endKey = cairoYmdPlusDays(todayKey, 7);

  const [centersInTrialRes, convertedRes, endingSoonRes, trialingSubsRes] = await Promise.all([
    supabase
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('summer_status', 'enrolled')
      .eq('is_test', false),
    supabase
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('summer_status', 'paid')
      .eq('is_test', false),
    supabase
      .from('centers')
      .select('id', { count: 'exact', head: true })
      .eq('summer_status', 'enrolled')
      .eq('is_test', false)
      .gte('summer_first_invoice_at', todayKey)
      .lte('summer_first_invoice_at', endKey),
    supabase.from('teacher_subscriptions').select('teacher_id').eq('status', 'trialing'),
  ]);

  for (const [label, res] of [
    ['centersInTrial', centersInTrialRes],
    ['converted', convertedRes],
    ['endingSoon', endingSoonRes],
    ['trialingSubs', trialingSubsRes],
  ] as const) {
    if (res.error) console.error('[CEO Trials Watch]', label, res.error.message);
  }

  // Teacher trials: count trialing subscriptions whose teacher is not a test
  // profile. Bounded by the (small) set of trialing subs, so we only look up the
  // test flag for teachers that actually appear here.
  const trialingSubs = (trialingSubsRes.data ?? []) as { teacher_id: string }[];
  let teachersInTrial = trialingSubs.length;
  if (trialingSubs.length > 0) {
    const teacherIds = Array.from(new Set(trialingSubs.map((s) => s.teacher_id)));
    const { data: testProfiles, error: testErr } = await supabase
      .from('teacher_profiles')
      .select('user_id')
      .eq('is_test', true)
      .in('user_id', teacherIds);
    if (testErr) {
      console.error('[CEO Trials Watch] testProfiles', testErr.message);
    } else {
      const testIds = new Set((testProfiles ?? []).map((p: { user_id: string }) => p.user_id));
      teachersInTrial = trialingSubs.filter((s) => !testIds.has(s.teacher_id)).length;
    }
  }

  const payload: CeoTrialsWatch = {
    centers_in_trial: centersInTrialRes.count ?? 0,
    teachers_in_trial: teachersInTrial,
    converted_to_paid: convertedRes.count ?? 0,
    trials_ending_7d: endingSoonRes.count ?? 0,
  };

  return NextResponse.json(payload);
}
