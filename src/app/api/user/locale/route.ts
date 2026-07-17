import { createClient } from '@supabase/supabase-js';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: Request) {
  try {
    const body = (await parseBodyWithLimit(request, 65536).catch(() => ({}))) as Record<string, unknown>;
    const { locale } = body;

    if (!['ar', 'en'].includes(String(locale))) {
      return Response.json({ success: false }, { status: 200 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return Response.json({ success: false }, { status: 200 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return Response.json({ success: false }, { status: 200 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      return Response.json({ success: false }, { status: 200 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Part 6 (EXEMPT, explicit): this route is DELIBERATELY reachable while the
    // centre is locked. It writes only the caller's own `preferred_locale` (no
    // centre data, no money), and the lock screen itself must be able to honour a
    // language switch. It is exempt from the suspension / single-day-lock gate by
    // decision, not by omission. Do not add centerAccessGateResponse here.
    await supabaseAdmin
      .from('users')
      .update({ preferred_locale: String(locale) })
      .eq('id', user.id);

    return Response.json({ success: true }, { status: 200 });
  } catch {
    return Response.json({ success: false }, { status: 200 });
  }
}
