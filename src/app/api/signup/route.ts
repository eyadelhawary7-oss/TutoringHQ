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

    // Resolve referral code to center UUID (referred_by is UUID, not text)
    let referredBy: string | null = null;
    if (referralCode && referralCode.trim() !== '') {
      const { data: referringCenter } = await supabase
        .from('centers')
        .select('id')
        .eq('referral_code', referralCode.trim().toUpperCase())
        .single();
      if (referringCenter) {
        referredBy = referringCenter.id; // UUID, not text
      }
      // If code is invalid, silently ignore — don't block signup
    }

    const insertData: Record<string, unknown> = {
      name: centerName.trim(),
      phone: phone.trim(),
      email: email?.trim() || null,
      plan: plan || 'starter',
      status: 'pending',
      requested_at: new Date().toISOString(),
      referred_by: referredBy, // null or valid UUID
    };
    if (referredBy) {
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

    // Log referral in audit_log if used
    if (referredBy && center && referralCode?.trim()) {
      try {
        const { error: auditErr } = await supabase.from('audit_log').insert({
          center_id: center.id,
          user_id: null,
          action: 'referral_used',
          entity_type: 'center',
          details: { referral_code: referralCode.trim(), referred_by: referredBy },
        });
        if (auditErr) console.warn('Audit log referral_used:', auditErr.message);
      } catch {
        // Don't fail signup if audit log fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'تم إرسال طلبك بنجاح. سيتم التواصل معك خلال 24 ساعة.',
    });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Signup failed' },
      { status: 500 }
    );
  }
}
