import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

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

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

export async function GET(request: Request) {
  if (!supabaseAdmin) {
    return NextResponse.json({ errorKey: 'admin.export.configError' }, { status: 500 });
  }

  const admin = await getAdminUser(request);
  if (!admin) {
    return NextResponse.json({ errorKey: 'admin.export.unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const status = searchParams.get('status') ?? '';

  let query = supabaseAdmin
    .from('invoices')
    .select(
      `
      invoice_number, invoice_type, total_amount, base_amount,
      discount_amount, status, payment_method, payment_reference,
      billing_period_start, billing_period_end, due_date,
      paid_at, created_at,
      centers(center_code, name)
    `,
    )
    .order('created_at', { ascending: false })
    .limit(100000);

  if (from) query = query.gte('created_at', from);
  if (to) query = query.lte('created_at', to);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const flat = (data ?? []).map((inv: Record<string, unknown>) => {
    const center = inv.centers as { center_code: string; name: string } | null;
    const { centers: _c, ...rest } = inv;
    return {
      center_code: center?.center_code ?? '',
      center_name: center?.name ?? '',
      ...rest,
    };
  });

  const csv = toCSV(flat as Record<string, unknown>[]);
  const date = new Date().toISOString().split('T')[0];

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="invoices-${date}.csv"`,
    },
  });
}
