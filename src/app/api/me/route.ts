import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

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

    type UserRecordOut = {
      id: string;
      name?: string | null;
      phone?: string | null;
      role?: string;
      preferred_locale?: string | null;
      center_id?: string | null;
      can_scan?: boolean;
      can_view_payments?: boolean;
      can_record_payments?: boolean;
      can_view_dashboard?: boolean;
      can_view_revenue?: boolean;
      can_manage_students?: boolean;
      can_manage_groups?: boolean;
      can_allow_late_entry?: boolean;
      can_manage_rooms?: boolean;
      can_view_schedule?: boolean;
      can_view_settings?: boolean;
      is_active?: boolean;
    };

    let userRecord: UserRecordOut | null = null;
    let usersRowFound = false;

    // CORE lookup: only the columns required to make the admin/center routing
    // decision. Mirrors the split centerAuth.ts already does (see its docblock
    // ~L86-91 about the nine-day outage) — when a permission column is missing
    // from the deployed schema, PostgREST errors, supabase-js returns
    // { data: null, error }, and silently discarding that error makes the route
    // think the users row doesn't exist, falling through to the admin_users
    // branch and zeroing out center_id. We destructure the error here and treat
    // a non-null error as a hard failure, never as "no users row".
    const { data: coreRow, error: coreErr } = await supabaseAdmin
      .from('users')
      .select('id, center_id, role, name, phone, preferred_locale')
      .eq('id', user.id)
      .maybeSingle();

    if (coreErr) {
      Sentry.withScope((scope) => {
        scope.setTag('route', 'api/me');
        scope.setTag('step', 'core_user_lookup');
        Sentry.captureException(coreErr);
      });
      return NextResponse.json(
        { error: 'Server configuration error', details: 'User profile lookup failed' },
        { status: 500 },
      );
    }

    const metaName =
      typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '';

    if (coreRow) {
      usersRowFound = true;
      const cr = coreRow as {
        id: string;
        center_id: string | null;
        role: string | null;
        name: string | null;
        phone: string | null;
        preferred_locale: string | null;
      };
      userRecord = {
        id: cr.id,
        phone: cr.phone,
        role: cr.role ?? 'assistant',
        center_id: cr.center_id,
        name: (cr.name && String(cr.name).trim()) || metaName || cr.phone || null,
        preferred_locale: cr.preferred_locale ?? 'ar',
      };
    } else {
      // Genuine empty users row (not a query error) — fall back to admin_users.
      const { data: adminRow } = await supabaseAdmin
        .from('admin_users')
        .select('id, name, phone')
        .eq('id', user.id)
        .maybeSingle();

      if (adminRow) {
        userRecord = {
          id: adminRow.id,
          name: (adminRow.name && String(adminRow.name).trim()) || metaName || null,
          phone: adminRow.phone ?? user.phone ?? null,
          role: 'super_admin',
          preferred_locale: 'en',
          center_id: null,
        };
      }
    }

    // PERMISSIONS lookup: best-effort. If a can_* column is missing (schema
    // drift) or the query fails for any other reason, warn in Sentry and
    // default all flags to false / is_active to true. The user row + center_id
    // resolved above remain authoritative — column drift must never invalidate
    // the routing decision.
    if (userRecord && usersRowFound) {
      const { data: permsRow, error: permsErr } = await supabaseAdmin
        .from('users')
        .select(
          'can_scan, can_view_payments, can_record_payments, can_view_dashboard, can_view_revenue, can_manage_students, can_manage_groups, can_allow_late_entry, can_manage_rooms, can_view_schedule, can_view_settings, is_active',
        )
        .eq('id', user.id)
        .maybeSingle();

      if (permsErr) {
        Sentry.withScope((scope) => {
          scope.setTag('route', 'api/me');
          scope.setTag('step', 'permission_flags');
          Sentry.captureMessage(
            `/api/me permission-column lookup failed: ${permsErr.message}`,
            'warning',
          );
        });
      }

      const pr = (permsRow ?? {}) as Record<string, unknown>;
      userRecord = {
        ...userRecord,
        can_scan: Boolean(pr.can_scan),
        can_view_payments: Boolean(pr.can_view_payments),
        can_record_payments: Boolean(pr.can_record_payments),
        can_view_dashboard: Boolean(pr.can_view_dashboard),
        can_view_revenue: Boolean(pr.can_view_revenue),
        can_manage_students: Boolean(pr.can_manage_students),
        can_manage_groups: Boolean(pr.can_manage_groups),
        can_allow_late_entry: Boolean(pr.can_allow_late_entry),
        can_manage_rooms: Boolean(pr.can_manage_rooms),
        can_view_schedule: Boolean(pr.can_view_schedule),
        can_view_settings: Boolean(pr.can_view_settings),
        is_active: pr.is_active == null ? true : Boolean(pr.is_active),
      };
    }

    if (!userRecord) {
      userRecord = {
        id: user.id,
        name: metaName || user.phone || user.email || null,
        phone: user.phone ?? null,
        role: 'assistant',
        preferred_locale: 'en',
        center_id: null,
        can_scan: false,
        can_view_payments: false,
        can_record_payments: false,
        can_view_dashboard: false,
        can_view_revenue: false,
        can_manage_students: false,
        can_manage_groups: false,
        can_allow_late_entry: false,
        can_manage_rooms: false,
        can_view_schedule: false,
        can_view_settings: false,
        is_active: true,
      };
    }

    // Fetch center logo/name and billing when user has center
    let center: {
      id?: string;
      logo_url?: string;
      name?: string;
      phone?: string;
      governorate?: string;
      payment_due_date?: string;
      auto_suspend_at?: string;
      billing_status?: string;
      subscription_status?: string;
      status?: string;
      current_period_end?: string | null;
      cancellation_reason?: string | null;
      cancellation_requested_at?: string | null;
      cancellation_approved_at?: string | null;
      plan?: string;
      delivery_address?: Record<string, unknown>;
      card_color?: string;
      last_card_style?: string | null;
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
      billing_type?: string | null;
      pricing_type?: string | null;
      payg_pending_switch?: string | null;
      payg_switch_effective_date?: string | null;
      payg_pending_target_period?: string | null;
    } | null = null;
    if (userRecord.center_id) {
      const { data: centerRow } = await supabaseAdmin
        .from('centers')
        .select(
          'id, logo_url, name, phone, governorate, last_card_style, payment_due_date, auto_suspend_at, billing_status, subscription_status, status, current_period_end, cancellation_reason, cancellation_requested_at, cancellation_approved_at, plan, delivery_address, card_color, parent_pack_enabled, parent_pack_active_parents, pack_price_per_parent, pack_request_status, announcement_balance, subscription_billing_period, billing_period, next_payment_due, billing_amount, all_in_price, credit_balance, credit_reserved, instapay_number, upgrade_count_this_period, suspended_at, billing_type, pricing_type, payg_pending_switch, payg_switch_effective_date, payg_pending_target_period',
        )
        .eq('id', userRecord.center_id)
        .single();
      if (centerRow) {
        const cr = centerRow as Record<string, unknown>;
        center = {
          id: String(cr.id ?? userRecord.center_id),
          logo_url: centerRow.logo_url ?? undefined,
          name: centerRow.name ?? undefined,
          phone: centerRow.phone ?? undefined,
          governorate: centerRow.governorate ?? undefined,
          payment_due_date: centerRow.payment_due_date ?? undefined,
          auto_suspend_at: centerRow.auto_suspend_at ?? undefined,
          billing_status: centerRow.billing_status ?? undefined,
          subscription_status: (cr.subscription_status as string | null) ?? undefined,
          status: (cr.status as string | null) ?? undefined,
          current_period_end: (cr.current_period_end as string | null) ?? undefined,
          cancellation_reason: (cr.cancellation_reason as string | null) ?? undefined,
          cancellation_requested_at: (cr.cancellation_requested_at as string | null) ?? undefined,
          cancellation_approved_at: (cr.cancellation_approved_at as string | null) ?? undefined,
          plan: centerRow.plan ?? undefined,
          delivery_address: centerRow.delivery_address ?? undefined,
          card_color: centerRow.card_color ?? undefined,
          last_card_style: cr.last_card_style != null ? String(cr.last_card_style) : undefined,
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
          billing_type: (cr.billing_type as string | null) ?? undefined,
          pricing_type: (cr.pricing_type as string | null) ?? undefined,
          payg_pending_switch: (cr.payg_pending_switch as string | null) ?? undefined,
          payg_switch_effective_date: (cr.payg_switch_effective_date as string | null) ?? undefined,
          payg_pending_target_period: (cr.payg_pending_target_period as string | null) ?? undefined,
        };
      }
    }

    return NextResponse.json({
      id: userRecord.id,
      role: userRecord.role ?? 'assistant',
      center_id: userRecord.center_id ?? null,
      name: userRecord.name ?? null,
      preferred_locale: userRecord.preferred_locale ?? 'ar',
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
