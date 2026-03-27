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

    let userRecord: { id: string; name?: string | null; phone?: string | null; role?: string; center_id?: string | null; can_scan?: boolean; can_view_payments?: boolean; can_record_payments?: boolean; can_view_dashboard?: boolean; can_view_revenue?: boolean; can_manage_students?: boolean; can_manage_groups?: boolean; can_allow_late_entry?: boolean; can_manage_rooms?: boolean; can_view_schedule?: boolean; can_view_settings?: boolean; is_active?: boolean } | null = null;

    const { data: usersRow, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, phone, role, center_id, can_scan, can_view_payments, can_record_payments, can_view_dashboard, can_view_revenue, can_manage_students, can_manage_groups, can_allow_late_entry, can_manage_rooms, can_view_schedule, can_view_settings, is_active')
      .eq('id', user.id)
      .single();

    if (usersRow) {
      userRecord = { ...usersRow, name: (usersRow as { phone?: string }).phone ?? null };
    } else {
      // User may be in admin_users but not in users (super admin without center)
      const { data: adminRow } = await supabaseAdmin
        .from('admin_users')
        .select('id, name, phone')
        .eq('id', user.id)
        .single();

      if (adminRow) {
        userRecord = {
          id: adminRow.id,
          name: adminRow.name,
          phone: adminRow.phone ?? user.phone ?? null,
          role: 'super_admin',
          center_id: null,
        };
      }
    }

    if (!userRecord) {
      return NextResponse.json(
        { error: 'Failed to fetch user profile', details: userError?.message ?? 'User not found in users or admin_users' },
        { status: 500 }
      );
    }

    // Fetch center logo/name and billing when user has center
    let center: {
      logo_url?: string;
      name?: string;
      phone?: string;
      governorate?: string;
      payment_due_date?: string;
      auto_suspend_at?: string;
      billing_status?: string;
      plan?: string;
      delivery_address?: Record<string, unknown>;
      card_color?: string;
      parent_pack_enabled?: boolean;
      parent_pack_active_parents?: number;
    } | null = null;
    if (userRecord.center_id) {
      const { data: centerRow } = await supabaseAdmin
        .from('centers')
        .select(
          'logo_url, name, phone, governorate, payment_due_date, auto_suspend_at, billing_status, plan, delivery_address, card_color, parent_pack_enabled, parent_pack_active_parents',
        )
        .eq('id', userRecord.center_id)
        .single();
      if (centerRow) {
        center = {
          logo_url: centerRow.logo_url ?? undefined,
          name: centerRow.name ?? undefined,
          phone: centerRow.phone ?? undefined,
          governorate: centerRow.governorate ?? undefined,
          payment_due_date: centerRow.payment_due_date ?? undefined,
          auto_suspend_at: centerRow.auto_suspend_at ?? undefined,
          billing_status: centerRow.billing_status ?? undefined,
          plan: centerRow.plan ?? undefined,
          delivery_address: centerRow.delivery_address ?? undefined,
          card_color: centerRow.card_color ?? undefined,
          parent_pack_enabled: centerRow.parent_pack_enabled ?? undefined,
          parent_pack_active_parents:
            centerRow.parent_pack_active_parents != null
              ? Number(centerRow.parent_pack_active_parents)
              : undefined,
        };
      }
    }

    return NextResponse.json({
      user: { ...userRecord, center: center ?? null },
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
