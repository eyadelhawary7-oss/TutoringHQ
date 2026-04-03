import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/** Public endpoint - returns pricing plans for signup/billing display (no auth required) */
export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: plans, error } = await supabase
      .from('pricing_plans')
      .select('id, name_en, name_ar, students_per_week_limit, monthly_fee, is_custom')
      .order('sort_order', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const hiddenPlanKey = ['pro', '_plus'].join('');
    const visiblePlans = (plans || []).filter((p: { id?: string; plan_key?: string }) => {
      const key = (p.plan_key ?? p.id) as string | undefined;
      return key !== hiddenPlanKey;
    });

    const { count: earlyAdopterCount } = await supabase
      .from('centers')
      .select('*', { count: 'exact', head: true })
      .eq('is_early_adopter', true);
    const earlyAdopterSpotsRemaining = Math.max(0, 10 - (earlyAdopterCount ?? 0));

    return NextResponse.json({
      plans: visiblePlans,
      early_adopter_spots_remaining: earlyAdopterSpotsRemaining,
      early_adopter_discount_pct: 40,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
