import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { signupSchema } from '@/lib/validations';

/** Send WhatsApp to admin (optional - fails gracefully if not configured) */
async function notifyAdminWhatsApp(message: string) {
  const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const adminPhone = process.env.ADMIN_WHATSAPP_NUMBER;
  if (!waToken || !waPhoneId || !adminPhone) {
    console.warn('WhatsApp or ADMIN_WHATSAPP_NUMBER not configured, skipping admin notification');
    return;
  }
  const to = adminPhone.replace(/[^0-9]/g, '');
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${waPhoneId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message, preview_url: false },
        }),
      }
    );
    if (!res.ok) {
      const err = await res.json();
      console.error('WhatsApp admin notify error:', err);
    }
  } catch (e) {
    console.error('WhatsApp admin notify error:', e);
  }
}

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
    const { centerName, phone, email, plan } = validation.data;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const verificationCode = String(Math.floor(100000 + Math.random() * 900000));

    const { data: center, error: centerError } = await supabase
      .from('centers')
      .insert({
        name: centerName.trim(),
        phone: phone.trim(),
        email: email?.trim() || null,
        plan: plan || 'starter',
        status: 'pending',
        requested_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (centerError) {
      return NextResponse.json({ error: centerError.message }, { status: 500 });
    }

    const planLabels: Record<string, string> = {
      starter: 'أساسي',
      pro: 'متقدم',
      enterprise: 'مؤسسات',
    };
    const msg = `طلب تسجيل سنتر جديد\nالسنتر: ${centerName}\nالهاتف: ${phone}\nالبريد: ${email || 'غير متوفر'}\nالخطة: ${planLabels[plan] || plan}\nرمز التحقق: ${verificationCode}`;
    await notifyAdminWhatsApp(msg);

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
