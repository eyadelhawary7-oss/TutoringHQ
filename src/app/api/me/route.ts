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
      .select('id, name, phone, role, center_id, can_scan, can_view_payments, can_record_payments, can_view_dashboard, can_view_revenue, can_manage_students, can_manage_groups, can_allow_late_entry, can_manage_rooms, can_view_schedule, can_view_settings, is_active')
      .eq('id', user.id)
      .single();

    if (userError) {
      return NextResponse.json(
        { error: 'Failed to fetch user profile', details: userError.message },
        { status: 500 }
      );
    }

    // Fetch center logo/name and billing when user has center
    let center: { logo_url?: string; name?: string; payment_due_date?: string; auto_suspend_at?: string; billing_status?: string } | null = null;
    if (userRecord?.center_id) {
      const { data: centerRow } = await supabaseAdmin
        .from('centers')
        .select('logo_url, name, payment_due_date, auto_suspend_at, billing_status')
        .eq('id', userRecord.center_id)
        .single();
      if (centerRow) {
        center = {
          logo_url: centerRow.logo_url ?? undefined,
          name: centerRow.name ?? undefined,
          payment_due_date: centerRow.payment_due_date ?? undefined,
          auto_suspend_at: centerRow.auto_suspend_at ?? undefined,
          billing_status: centerRow.billing_status ?? undefined,
        };
      }
    }

    return NextResponse.json({
      user: { ...userRecord, center },
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
