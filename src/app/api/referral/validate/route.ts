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
    const cleanCode = String(parsed.data.code).trim().toUpperCase();
    if (!cleanCode) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    let centerId: string | null = null;
    const { data: refCode } = await supabase
      .from('referral_codes')
      .select('center_id')
      .eq('code', cleanCode)
      .maybeSingle();
    if (refCode?.center_id) centerId = refCode.center_id;

    if (!centerId) {
      const { data: centerByCode } = await supabase
        .from('centers')
        .select('id, name')
        .eq('referral_code', cleanCode)
        .maybeSingle();
      if (centerByCode?.id) centerId = centerByCode.id;
    }

    if (!centerId) {
      return NextResponse.json({ valid: false }, { status: 200 });
    }

    const { data: center } = await supabase
      .from('centers')
      .select('name')
      .eq('id', centerId)
      .single();

    const name = center?.name ?? '';
    const masked = name.length >= 2 ? name.slice(0, 2) + '***' : 'سنتر ***';

    return NextResponse.json({ valid: true, referrerName: masked });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
