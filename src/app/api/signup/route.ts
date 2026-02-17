import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { signupSchema } from '@/lib/validations';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input with Zod
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: first?.message ?? 'Invalid input', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { centerName, phone, email, plan, referralCode } = parsed.data;

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Generate simple referral code
    const generateCode = () => {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
    };

    // Resolve referral if provided
    let referredById: string | null = null;
    const code = referralCode?.trim().toUpperCase();
    if (code && code.length === 8) {
      const { data: refCenter } = await supabase
        .from('centers')
        .select('id')
        .eq('referral_code', code)
        .single();
      if (refCenter) referredById = refCenter.id;
    }

    // Create center - use validated data only
    const insertPayload: Record<string, unknown> = {
      name: centerName,
      phone,
      email: email || null,
      plan,
      subscription_status: 'pending',
      status: 'pending',
      billing_type: 'fixed',
      billing_period: 'quarterly',
      referral_code: generateCode(),
    };
    if (referredById) {
      insertPayload.referred_by = referredById;
      insertPayload.referral_code_used_at = new Date().toISOString();
    }

    const { data: newCenter, error: centerError } = await supabase
      .from('centers')
      .insert(insertPayload)
      .select()
      .single();

    console.log('[signup] Insert result:', { success: !centerError, error: centerError });

    if (centerError) {
      console.error('Signup error:', centerError);
      return NextResponse.json(
        {
          error: 'Failed to create center',
          details: centerError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Signup successful! Pending admin approval.',
      center: newCenter,
    });
  } catch (error) {
    console.error('Signup exception:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
