import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { signupSchema } from '@/lib/validations';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const validation = signupSchema.safeParse(body);
    if (!validation.success) {
      const msg = validation.error.issues[0]?.message || 'Invalid input';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { centerName, phone, email, plan, referralCode } = validation.data;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let referredBy: string | null = null;
    if (referralCode && referralCode.trim().length === 8) {
      const code = referralCode.trim().toUpperCase();
      const { data: refCenter } = await supabase
        .from('centers')
        .select('id')
        .eq('referral_code', code)
        .single();
      if (refCenter) {
        referredBy = refCenter.id;
      } else {
        return NextResponse.json({ error: 'referralCodeInvalid' }, { status: 400 });
      }
    }

    const insertData: Record<string, unknown> = {
      name: centerName.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      plan: plan || 'starter',
      status: 'pending',
      requested_at: new Date().toISOString(),
    };
    if (referredBy) {
      insertData.referred_by = referredBy;
      insertData.referral_code_used_at = new Date().toISOString();
    }

    const { data: center, error: centerError } = await supabase
      .from('centers')
      .insert(insertData)
      .select('id')
      .single();

    if (centerError) {
      return NextResponse.json({ error: centerError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال طلبك بنجاح. سيتم التواصل معك خلال 24 ساعة.',
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
