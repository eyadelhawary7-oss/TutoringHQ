import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  let locale = 'en';
  try {
    const body = (await request.json()) as { locale?: string };
    if (typeof body.locale === 'string' && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.locale)) {
      locale = body.locale;
    }
  } catch {
    /* ignore */
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: 'config' }, { status: 500 });
  }

  const cookieStore = await cookies();
  const response = NextResponse.json({
    ok: true,
    redirect: `/${locale}/login`,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value ?? '', options);
        });
      },
    },
  });

  await supabase.auth.signOut();

  return response;
}
