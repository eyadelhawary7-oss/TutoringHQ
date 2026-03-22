import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { locale } = body;

    if (!['ar', 'en'].includes(locale)) {
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

    await supabaseAdmin
      .from('users')
      .update({ preferred_locale: locale })
      .eq('id', user.id);

    return Response.json({ success: true }, { status: 200 });
  } catch {
    return Response.json({ success: false }, { status: 200 });
  }
}
