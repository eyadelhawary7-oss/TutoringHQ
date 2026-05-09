import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { normalizePhone } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json({ error: 'misconfigured' }, { status: 503 });
    }

    const phoneParam = new URL(request.url).searchParams.get('phone');
    if (!phoneParam?.trim()) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 });
    }
    const phone = normalizePhone(phoneParam.trim());
    const nowIso = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from('pending_signups')
      .select(
        'id, last_step_completed, completed_at, expires_at, center_name, owner_name, email, city, plan_key, billing_period, referral_code',
      )
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: 'query_failed' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ exists: false });
    }

    const row = data as {
      id: string;
      last_step_completed: number | null;
      completed_at: string | null;
      expires_at: string;
      center_name: string;
      owner_name: string;
      email: string | null;
      city: string | null;
      plan_key: string | null;
      billing_period: string | null;
      referral_code: string | null;
    };

    const completed = row.completed_at != null;
    const expired = row.expires_at <= nowIso;

    return NextResponse.json({
      exists: true,
      id: row.id,
      last_step_completed: row.last_step_completed ?? 1,
      completed,
      expired,
      pending:
        !completed && !expired
          ? {
              center_name: row.center_name,
              owner_name: row.owner_name,
              email: row.email ?? '',
              city: row.city ?? '',
              plan_key: row.plan_key ?? 'starter',
              billing_period: row.billing_period ?? 'quarterly',
              referral_code: row.referral_code ?? '',
            }
          : null,
    });
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
