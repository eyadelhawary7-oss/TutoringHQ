import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { onboardingSchema } from '@/lib/validations';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Get auth token from Authorization header
    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Create Supabase client with auth token (for auth verification)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    
    if (authError) {
      console.error('Auth error:', authError);
      return NextResponse.json(
        { error: 'Authentication failed', details: authError.message },
        { status: 401 }
      );
    }
    
    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = onboardingSchema.safeParse(body);
    if (!validation.success) {
      const msg = validation.error.issues[0]?.message || 'Invalid input';
      return NextResponse.json({ error: msg, details: validation.error.format() }, { status: 400 });
    }
    const { centerName, referralCode } = validation.data;

    // Service role key is REQUIRED to bypass RLS for onboarding
    if (!supabaseServiceKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY is not set - onboarding will fail due to RLS policies');
      return NextResponse.json(
        { error: 'Server configuration error', details: 'Service role key not configured' },
        { status: 500 }
      );
    }

    // Use service role key to bypass RLS for onboarding operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Check if user already completed onboarding
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, center_id')
      .eq('id', user.id)
      .single();

    if (existingUser?.center_id) {
      if (centerName?.trim()) {
        await supabase
          .from('centers')
          .update({ name: centerName.trim() })
          .eq('id', existingUser.center_id);
      }
      return NextResponse.json({
        success: true,
        centerId: existingUser.center_id,
        message: 'Already onboarded'
      });
    }

    console.log('Creating center for user:', user.id);
    console.log('Center name:', centerName);

    let referredById: string | null = null;
    if (referralCode?.trim()) {
      const code = referralCode.trim().toUpperCase();
      if (code.length !== 8) {
        return NextResponse.json(
          { error: 'Invalid code', details: 'Referral code must be 8 characters' },
          { status: 400 }
        );
      }
      const { data: refCenter } = await supabase
        .from('centers')
        .select('id')
        .eq('referral_code', code)
        .single();
      if (!refCenter) {
        return NextResponse.json(
          { error: 'Invalid code', details: 'Referral code not found' },
          { status: 400 }
        );
      }
      referredById = refCenter.id;
    }

    const insertData: Record<string, unknown> = {
      name: centerName.trim(),
      phone: user.phone || '',
      plan: 'starter',
      subscription_status: 'active',
    };
    if (referredById) {
      insertData.referred_by = referredById;
      insertData.referral_code_used_at = new Date().toISOString();
    }

    const { data: center, error: centerError } = await supabase
      .from('centers')
      .insert(insertData)
      .select()
      .single();

    if (centerError) {
      console.error('Center creation error:', centerError);
      return NextResponse.json(
        { error: 'Failed to create center', details: centerError.message },
        { status: 500 }
      );
    }

    if (!center) {
      return NextResponse.json(
        { error: 'Center created but no data returned' },
        { status: 500 }
      );
    }

    console.log('Center created:', center.id);

    const { error: userError } = await supabase
      .from('users')
      .insert({
        id: user.id,
        center_id: center.id,
        role: 'owner',
        phone: user.phone || '',
        name: centerName.trim()
      });

    if (userError) {
      console.error('User profile creation error:', userError);
      await supabase.from('centers').delete().eq('id', center.id);
      
      return NextResponse.json(
        { error: 'Failed to create user profile', details: userError.message },
        { status: 500 }
      );
    }

    console.log('User profile created successfully');

    return NextResponse.json({ 
      success: true,
      centerId: center.id,
      centerName: center.name
    });

  } catch (error) {
    console.error('Unexpected error in create-center:', error);
    return NextResponse.json(
      { 
        error: 'An unexpected error occurred',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
