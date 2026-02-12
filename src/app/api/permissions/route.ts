import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function PUT(request: Request) {
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
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { targetUserId, permissionKey, enabled, centerId } = body;

    if (!targetUserId || !permissionKey || typeof enabled !== 'boolean' || !centerId) {
      return NextResponse.json({ error: 'Missing targetUserId, permissionKey, enabled, or centerId' }, { status: 400 });
    }

    const validKeys = ['can_send_whatsapp', 'can_add_subjects', 'can_view_calendar', 'can_manage_payments'];
    if (!validKeys.includes(permissionKey)) {
      return NextResponse.json({ error: 'Invalid permission key' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: callerRecord } = await supabaseAdmin
      .from('users')
      .select('role, center_id')
      .eq('id', user.id)
      .single();

    if (!callerRecord || callerRecord.center_id !== centerId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (callerRecord.role !== 'owner' && callerRecord.role !== 'admin') {
      return NextResponse.json({ error: 'Only owner or admin can change permissions' }, { status: 403 });
    }

    const { data: targetRecord } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', targetUserId)
      .eq('center_id', centerId)
      .single();

    if (!targetRecord || targetRecord.role !== 'assistant') {
      return NextResponse.json({ error: 'Can only set permissions for assistants' }, { status: 400 });
    }

    const { error: upsertError } = await supabaseAdmin
      .from('permissions')
      .upsert(
        {
          user_id: targetUserId,
          center_id: centerId,
          permission_key: permissionKey,
          enabled,
        },
        { onConflict: 'user_id,center_id,permission_key' }
      );

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
