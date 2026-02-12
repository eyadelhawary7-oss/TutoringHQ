import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { reminderSettingsSchema } from '@/lib/validations';

async function getUserContext(request: NextRequest) {
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
    .select('id, center_id, role')
    .eq('id', user.id)
    .single();

  if (!userRecord?.center_id) return null;

  return { user: userRecord, supabaseAdmin };
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data, error } = await ctx.supabaseAdmin
      .from('reminder_settings')
      .select('*')
      .eq('center_id', ctx.user.center_id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;

    const defaults = {
      day5_enabled: true,
      day10_enabled: true,
      day15_enabled: true,
      day5: 5,
      day10: 10,
      day15: 15,
    };

    return NextResponse.json({ settings: data ? { ...defaults, ...data } : defaults });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getUserContext(request);
    if (!ctx || (ctx.user.role !== 'owner' && ctx.user.role !== 'admin')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validation = reminderSettingsSchema.safeParse(body);
    if (!validation.success) {
      const msg = validation.error.issues[0]?.message || 'Invalid input';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { day5_enabled, day10_enabled, day15_enabled, day5, day10, day15 } = validation.data;

    const { error } = await ctx.supabaseAdmin
      .from('reminder_settings')
      .upsert(
        {
          center_id: ctx.user.center_id,
          day5_enabled: day5_enabled ?? true,
          day10_enabled: day10_enabled ?? true,
          day15_enabled: day15_enabled ?? true,
          day5: day5 ?? 5,
          day10: day10 ?? 10,
          day15: day15 ?? 15,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'center_id' }
      );

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
