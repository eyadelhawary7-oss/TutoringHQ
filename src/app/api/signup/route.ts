import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { centerName, phone, email, plan } = body;

    // Validate required fields
    if (!centerName || !phone || !plan) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate plan (normalize to uppercase for DB)
    const validPlans = ['STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE', 'TOP_CENTERS'];
    const normalizedPlan = String(plan).toUpperCase();

    if (!validPlans.includes(normalizedPlan)) {
      return NextResponse.json(
        { error: 'Invalid plan selected' },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Generate simple referral code
    const generateCode = () => {
      return Math.random().toString(36).substring(2, 10).toUpperCase();
    };

    // Create center - use only fields that exist
    console.log('==========================================');
    console.log('[signup] Creating center with values:', {
      name: centerName,
      phone: phone,
      email: email || null,
      plan: normalizedPlan,
      planOriginal: plan,
      subscription_status: 'pending',
      status: 'pending',
    });
    console.log('==========================================');

    const { data: newCenter, error: centerError } = await supabase
      .from('centers')
      .insert({
        name: centerName,
        phone: phone,
        email: email || null,
        plan: normalizedPlan,
        subscription_status: 'pending',
        status: 'pending',
        billing_type: 'fixed',
        billing_period: 'quarterly',
        referral_code: generateCode(),
      })
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
