import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { whatsappSendSchema } from '@/lib/validations';

/**
 * Send a WhatsApp message via Meta Cloud API.
 * 
 * Required env vars:
 * - WHATSAPP_ACCESS_TOKEN: Meta permanent access token
 * - WHATSAPP_PHONE_NUMBER_ID: WhatsApp Business phone number ID
 */
export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const waAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const waPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (!waAccessToken || !waPhoneNumberId) {
      return NextResponse.json({ error: 'WhatsApp not configured. Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID.' }, { status: 503 });
    }

    // Authenticate user
    const authHeader = request.headers.get('Authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    if (!accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const validation = whatsappSendSchema.safeParse(body);
    if (!validation.success) {
      const msg = validation.error.issues[0]?.message || 'Invalid input';
      return NextResponse.json({ error: msg, details: validation.error.format() }, { status: 400 });
    }
    const { to, type, template, text, centerId } = validation.data;

    // Format phone number - ensure it has country code, no + prefix
    const formattedPhone = to.replace(/[^0-9]/g, '');

    // Build the WhatsApp API payload
    let waPayload: Record<string, unknown>;

    if (type === 'template' && template) {
      // Template message (for first contact or payment reminders)
      waPayload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'template',
        template: {
          name: template.name,
          language: { code: template.language || 'ar' },
          components: template.components || [],
        },
      };
    } else {
      // Text message (within 24-hour window)
      waPayload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: {
          body: text || '',
          preview_url: false,
        },
      };
    }

    // Send via Meta Cloud API
    const waResponse = await fetch(
      `https://graph.facebook.com/v21.0/${waPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${waAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(waPayload),
      }
    );

    const waResult = await waResponse.json();

    if (!waResponse.ok) {
      console.error('WhatsApp API error:', waResult);
      return NextResponse.json(
        { error: 'Failed to send WhatsApp message', details: waResult.error?.message },
        { status: waResponse.status }
      );
    }

    // Log the message in the database
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await supabaseAdmin.from('whatsapp_messages').insert({
      center_id: centerId,
      sent_by: user.id,
      to_phone: formattedPhone,
      message_type: type === 'template' ? 'template' : 'text',
      template_name: template?.name || null,
      body: text || template?.name || '',
      wa_message_id: waResult.messages?.[0]?.id || null,
      status: 'sent',
    });

    return NextResponse.json({
      success: true,
      messageId: waResult.messages?.[0]?.id,
    });
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
