import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateCSRFToken } from '@/lib/csrf';

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const sessionId = user.id;
    const token = generateCSRFToken(sessionId);

    return NextResponse.json({ token, sessionId });
  } catch (err) {
    console.error('[csrf-token]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate token' },
      { status: 500 }
    );
  }
}
