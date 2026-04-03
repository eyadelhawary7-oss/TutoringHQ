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
      subscription_status?: string;
      status?: string;
      plan?: string;
      delivery_address?: Record<string, unknown>;
      card_color?: string;
      parent_pack_enabled?: boolean;
      parent_pack_active_parents?: number;
      pack_price_per_parent?: number | string;
      pack_request_status?: string | null;
      announcement_balance?: string | number;
      subscription_billing_period?: string | null;
      billing_period?: string | null;
      next_payment_due?: string | null;
      billing_amount?: number | null;
      all_in_price?: number | null;
      credit_balance?: number | null;
      credit_reserved?: number | null;
      instapay_number?: string | null;
      upgrade_count_this_period?: number | null;
      suspended_at?: string | null;
    } | null = null;
    if (userRecord.center_id) {
      const { data: centerRow } = await supabaseAdmin
        .from('centers')
        .select(
          'logo_url, name, phone, governorate, payment_due_date, auto_suspend_at, billing_status, subscription_status, status, plan, delivery_address, card_color, parent_pack_enabled, parent_pack_active_parents, pack_price_per_parent, pack_request_status, announcement_balance, subscription_billing_period, billing_period, next_payment_due, billing_amount, all_in_price, credit_balance, credit_reserved, instapay_number, upgrade_count_this_period, suspended_at',
        )
        .eq('id', userRecord.center_id)
        .single();
      if (centerRow) {
        const cr = centerRow as Record<string, unknown>;
        center = {
          logo_url: centerRow.logo_url ?? undefined,
          name: centerRow.name ?? undefined,
          phone: centerRow.phone ?? undefined,
          governorate: centerRow.governorate ?? undefined,
          payment_due_date: centerRow.payment_due_date ?? undefined,
          auto_suspend_at: centerRow.auto_suspend_at ?? undefined,
          billing_status: centerRow.billing_status ?? undefined,
          subscription_status: (cr.subscription_status as string | null) ?? undefined,
          status: (cr.status as string | null) ?? undefined,
          plan: centerRow.plan ?? undefined,
          delivery_address: centerRow.delivery_address ?? undefined,
          card_color: centerRow.card_color ?? undefined,
          parent_pack_enabled: centerRow.parent_pack_enabled ?? undefined,
          parent_pack_active_parents:
            centerRow.parent_pack_active_parents != null
              ? Number(centerRow.parent_pack_active_parents)
              : undefined,
          pack_price_per_parent:
            cr.pack_price_per_parent != null ? Number(cr.pack_price_per_parent) : undefined,
          pack_request_status: (cr.pack_request_status as string | null) ?? undefined,
          announcement_balance: centerRow.announcement_balance ?? undefined,
          subscription_billing_period: (cr.subscription_billing_period as string | null) ?? undefined,
          billing_period: (cr.billing_period as string | null) ?? undefined,
          next_payment_due: (cr.next_payment_due as string | null) ?? undefined,
          billing_amount: cr.billing_amount != null ? Number(cr.billing_amount) : undefined,
          all_in_price: cr.all_in_price != null ? Number(cr.all_in_price) : undefined,
          credit_balance: cr.credit_balance != null ? Number(cr.credit_balance) : undefined,
          credit_reserved: cr.credit_reserved != null ? Number(cr.credit_reserved) : undefined,
          instapay_number: (cr.instapay_number as string | null) ?? undefined,
          upgrade_count_this_period:
            cr.upgrade_count_this_period != null ? Number(cr.upgrade_count_this_period) : undefined,
          suspended_at: (cr.suspended_at as string | null) ?? undefined,
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
