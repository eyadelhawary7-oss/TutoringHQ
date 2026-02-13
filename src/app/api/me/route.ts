import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Get auth token from Authorization header
    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Verify user identity with anon key + JWT
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Use service role key to bypass RLS and fetch user profile
    if (!supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error', details: 'Service role key not configured' },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRecord, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, center_id, role, name, phone')
      .eq('id', user.id)
      .single();

    if (userError) {
      return NextResponse.json(
        { error: 'Failed to fetch user profile', details: userError.message },
        { status: 500 }
      );
    }

    // Fetch center logo/name when user has center
    let center: { logo_url?: string; name?: string } | null = null;
    if (userRecord?.center_id) {
      const { data: centerRow } = await supabaseAdmin
        .from('centers')
        .select('logo_url, name')
        .eq('id', userRecord.center_id)
        .single();
      if (centerRow) {
        center = { logo_url: centerRow.logo_url ?? undefined, name: centerRow.name ?? undefined };
      }
    }

    // Owner and admin have full access; assistant/teacher use permissions table
    let permissions: Record<string, boolean> = {};
    const role = userRecord?.role as string;

    if (role === 'owner' || role === 'admin') {
      permissions = {
        can_add_subjects: true,
        can_view_calendar: true,
        can_manage_payments: true,
      };
    } else if (role === 'teacher') {
      permissions = {
        can_add_subjects: false,
        can_view_calendar: true,
        can_manage_payments: false,
      };
    } else if (role === 'assistant' && userRecord?.center_id) {
      try {
        const { data: permRows } = await supabaseAdmin
          .from('permissions')
          .select('permission_key, enabled')
          .eq('user_id', user.id)
          .eq('center_id', userRecord.center_id);

        permissions = {
          can_add_subjects: permRows?.find((p: { permission_key: string }) => p.permission_key === 'can_add_subjects')?.enabled ?? false,
          can_view_calendar: permRows?.find((p: { permission_key: string }) => p.permission_key === 'can_view_calendar')?.enabled ?? false,
          can_manage_payments: permRows?.find((p: { permission_key: string }) => p.permission_key === 'can_manage_payments')?.enabled ?? false,
        };
      } catch {
        permissions = { can_add_subjects: false, can_view_calendar: false, can_manage_payments: false };
      }
    }

    return NextResponse.json({
      user: { ...userRecord, center },
      permissions,
    });

  } catch (error) {
    return NextResponse.json(
      {
        error: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
