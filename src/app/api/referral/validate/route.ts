import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const parsed = (await import('@/lib/validations')).referralValidateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }
    const cleanCode = parsed.data.code.trim().toUpperCase();
    if (cleanCode.length !== 8) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data } = await supabase
      .from('centers')
      .select('id')
      .eq('referral_code', cleanCode)
      .single();

    return NextResponse.json({ valid: !!data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
