import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('center_id')
      .eq('id', user.id)
      .single();

    if (!userRecord?.center_id) {
      return NextResponse.json({ error: 'No center' }, { status: 403 });
    }

    const { student_id, student_name, parent_phone, subject } = await request.json();
    if (!student_id || !student_name || !parent_phone) {
      return NextResponse.json({ error: 'Missing student_id, student_name, or parent_phone' }, { status: 400 });
    }

    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('individual_alerts_enabled')
      .eq('id', userRecord.center_id)
      .single();

    if (!center?.individual_alerts_enabled) {
      return NextResponse.json({ skipped: true, reason: 'alerts_disabled' });
    }

    const accessTokenWa = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!accessTokenWa || !phoneNumberId) {
      return NextResponse.json({ error: 'WhatsApp credentials not configured' }, { status: 500 });
    }

    const now = new Date();
    const time = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    const toPhone = String(parent_phone).replace(/^0/, '20');

    const response = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessTokenWa}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: toPhone,
          type: 'template',
          template: {
            name: 'check_in_alert',
            language: { code: 'ar' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: student_name },
                  { type: 'text', text: subject || '' },
                  { type: 'text', text: time },
                ],
              },
            ],
          },
        }),
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: (errData as { error?: { message?: string } })?.error?.message || 'WhatsApp API error' },
        { status: 500 }
      );
    }

    await supabaseAdmin.from('whatsapp_messages').insert({
      center_id: userRecord.center_id,
      student_id,
      to_phone: toPhone,
      message_type: 'individual',
      template_name: 'check_in_alert',
      body: null,
      status: 'sent',
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Check-in alert error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
