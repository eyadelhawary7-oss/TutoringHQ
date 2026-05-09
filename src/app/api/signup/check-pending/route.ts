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

    const { data, error } = await supabaseAdmin
      .from('pending_signups')
      .select('id, last_step_completed, completed_at')
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
    };

    return NextResponse.json({
      exists: true,
      id: row.id,
      last_step_completed: row.last_step_completed ?? 1,
      completed: row.completed_at != null,
    });
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
}
