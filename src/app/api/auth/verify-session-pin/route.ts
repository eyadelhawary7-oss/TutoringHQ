import { NextResponse } from 'next/server';
import { verifyPasswordForSensitiveAction } from '@/lib/verify-password';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    const body = (await parseBodyWithLimit(request, 4096)) as { pin?: string };
    const pin = typeof body.pin === 'string' ? body.pin : '';
    const result = await verifyPasswordForSensitiveAction(supabaseUrl, supabaseAnonKey, accessToken, pin);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
