import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('center_id')
      .eq('id', user.id)
      .single();

    if (!userRecord?.center_id) {
      return NextResponse.json({ error: 'No center' }, { status: 403 });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const { count, error: countError } = await supabaseAdmin
      .from('whatsapp_messages')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', userRecord.center_id)
      .eq('message_type', 'individual')
      .gte('created_at', startOfMonth)
      .lte('created_at', endOfMonth);

    if (countError) throw countError;

    const sent = count ?? 0;

    const { count: studentCount } = await supabaseAdmin
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('center_id', userRecord.center_id);

    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('plan')
      .eq('id', userRecord.center_id)
      .single();

    const plan = (center?.plan as string) || 'starter';
    const perStudent = plan === 'enterprise' ? 15 : plan === 'pro' ? 12 : 10;
    const included = (studentCount ?? 0) * perStudent;
    const overage = Math.max(0, sent - included);

    return NextResponse.json({ sent, included, overage, plan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
