import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        flowType: 'pkce',
      },
    });

    const { data: sessionData, error: sessionError } = await supabase.auth.exchangeCodeForSession(code);

    if (sessionError || !sessionData.user) {
      console.error('Auth callback error:', sessionError?.message);
      return NextResponse.redirect(`${origin}/login`);
    }

    // Check if user exists in users table with a center
    const { data: userRecord } = await supabase
      .from('users')
      .select('id, center_id')
      .eq('id', sessionData.user.id)
      .single();

    if (userRecord?.center_id) {
      // Existing user with center -> dashboard
      return NextResponse.redirect(`${origin}${next}`);
    } else {
      // New user -> onboarding
      return NextResponse.redirect(`${origin}/onboarding`);
    }
  }

  // No code provided, redirect to login
  return NextResponse.redirect(`${origin}/login`);
}
