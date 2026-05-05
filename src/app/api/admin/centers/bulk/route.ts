import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createCommissionsForCenter } from '@/lib/commissions';
import { validateCSRFRequest } from '@/lib/csrf';
import { parseBodyWithLimit } from '@/lib/validate';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

async function getAdminUser(request: Request) {
  if (!supabaseUrl || !supabaseAnonKey || !supabaseAdmin) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          /* read-only cookie context */
        }
      },
    },
  });

  let userId: string | null = null;
  const {
    data: { user: cookieUser },
  } = await supabase.auth.getUser();
  if (cookieUser) userId = cookieUser.id;
  else {
    const authHeader = request.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const {
        data: { user: bearerUser },
        error,
      } = await supabase.auth.getUser(token);
      if (bearerUser && !error) userId = bearerUser.id;
    }
  }

  if (!userId) return null;
  const { data: adminUser } = await supabaseAdmin.from('admin_users').select('id,role').eq('id', userId).single();
  if (adminUser) return adminUser;
  const { data: userRecord } = await supabaseAdmin.from('users').select('phone').eq('id', userId).single();
  const phones = (process.env.SUPER_ADMIN_PHONES || '')
    .split(',')
    .map((p: string) => p.trim())
    .filter(Boolean);
  if (userRecord?.phone && phones.includes(String(userRecord.phone))) {
    return { id: userId, role: 'super_admin' as const };
  }
  return null;
}

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function waToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

// POST /api/admin/centers/bulk
// Actions: approve | suspend | reactivate | send_wa
export async function POST(request: Request) {
  if (!supabaseAdmin || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ errorKey: 'bulk.errors.config' }, { status: 500 });
  }

  const admin = await getAdminUser(request);
  if (!admin) {
    return NextResponse.json({ errorKey: 'bulk.errors.unauthorized' }, { status: 401 });
  }
  if (admin.role !== 'super_admin') {
    return NextResponse.json({ errorKey: 'bulk.errors.superAdminOnly' }, { status: 403 });
  }

  if (!validateCSRFRequest(request, admin.id)) {
    return NextResponse.json({ errorKey: 'bulk.errors.csrf' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ errorKey: 'bulk.errors.invalidBody' }, { status: 400 });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const center_ids = body.center_ids;

  if (!action || !Array.isArray(center_ids) || center_ids.length === 0) {
    return NextResponse.json({ errorKey: 'bulk.errors.actionAndIdsRequired' }, { status: 400 });
  }

  const ids = center_ids.filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) {
    return NextResponse.json({ errorKey: 'bulk.errors.actionAndIdsRequired' }, { status: 400 });
  }

  if (ids.length > 200) {
    return NextResponse.json({ errorKey: 'bulk.errors.maxCenters' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0];
  let processed = 0;
  const errors: string[] = [];

  if (action === 'approve') {
    const nextPaymentDue = new Date();
    nextPaymentDue.setDate(nextPaymentDue.getDate() + 30);
    const autoSuspendAt = new Date();
    autoSuspendAt.setDate(autoSuspendAt.getDate() + 38);

    const { data: pendingCenters, error: fetchPendingError } = await supabaseAdmin
      .from('centers')
      .select('id, plan, all_in_price, billing_period')
      .in('id', ids)
      .eq('status', 'pending');

    if (fetchPendingError) {
      return NextResponse.json({ error: fetchPendingError.message }, { status: 500 });
    }

    if (!pendingCenters?.length) {
      return NextResponse.json({ errorKey: 'bulk.errors.noPendingInSelection' }, { status: 400 });
    }

    const pendingIds = pendingCenters.map((c) => c.id);

    const { error: updateError } = await supabaseAdmin
      .from('centers')
      .update({
        status: 'active',
        subscription_status: 'active',
        billing_status: 'active',
        approved_at: new Date().toISOString(),
        approved_by: admin.id,
        subscription_start_date: today,
        next_payment_due: nextPaymentDue.toISOString().split('T')[0],
        auto_suspend_at: autoSuspendAt.toISOString().split('T')[0],
      })
      .in('id', pendingIds);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    processed = pendingCenters.length;
    for (const center of pendingCenters) {
      try {
        await createCommissionsForCenter(center.id);
      } catch (err) {
        errors.push(`${center.id}: ${String(err)}`);
      }
    }
  } else if (action === 'suspend') {
    const { error: suspendError } = await supabaseAdmin
      .from('centers')
      .update({
        status: 'suspended',
        subscription_status: 'suspended',
        billing_status: 'suspended',
        suspended_at: new Date().toISOString(),
      })
      .in('id', ids);

    if (suspendError) {
      return NextResponse.json({ error: suspendError.message }, { status: 500 });
    }
    processed = ids.length;
  } else if (action === 'reactivate') {
    const nextPaymentDue = new Date();
    nextPaymentDue.setDate(nextPaymentDue.getDate() + 30);

    const { error: reactivateError } = await supabaseAdmin
      .from('centers')
      .update({
        status: 'active',
        subscription_status: 'active',
        billing_status: 'active',
        suspended_at: null,
        next_payment_due: nextPaymentDue.toISOString().split('T')[0],
      })
      .in('id', ids);

    if (reactivateError) {
      return NextResponse.json({ error: reactivateError.message }, { status: 500 });
    }
    processed = ids.length;
  } else if (action === 'send_wa') {
    const message = typeof body.message === 'string' ? body.message : '';
    if (!message.trim()) {
      return NextResponse.json({ errorKey: 'bulk.errors.messageRequired' }, { status: 400 });
    }

    const { data: waCenters, error: waFetchError } = await supabaseAdmin
      .from('centers')
      .select('id, phone, name')
      .in('id', ids)
      .not('phone', 'is', null);

    if (waFetchError) {
      return NextResponse.json({ error: waFetchError.message }, { status: 500 });
    }

    const phoneId = waPhoneNumberId();
    const token = waToken();

    if (!phoneId || !token) {
      return NextResponse.json({ errorKey: 'bulk.errors.whatsappNotConfigured' }, { status: 500 });
    }

    for (const center of waCenters ?? []) {
      const row = center as { id: string; phone: string; name: string | null };
      try {
        const phone = row.phone.replace(/\D/g, '');
        if (!phone) continue;
        const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: message.trim() },
          }),
        });
        if (!res.ok) {
          const t = await res.text();
          errors.push(`${row.name ?? row.id}: ${t}`);
        } else {
          processed++;
        }
      } catch (err) {
        errors.push(`${row.name ?? row.id}: ${String(err)}`);
      }
    }
  } else {
    return NextResponse.json({ errorKey: 'bulk.errors.invalidAction' }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    action,
    processed,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
