// Supabase Edge Function: notify-card-order
// Triggered by database webhook on card_orders INSERT
// Sends WhatsApp notification to admin via Meta WhatsApp Cloud API

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CardOrderRecord {
  id?: string;
  center_id?: string;
  created_by?: string;
  students?: unknown;
  quantity?: number;
  price_per_card?: number;
  delivery_fee?: number;
  total_amount?: number;
  status?: string;
  delivery_address?: string | null;
  notes?: string | null;
  created_at?: string;
}

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  schema: string;
  record: CardOrderRecord;
  old_record: null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== 'INSERT' || payload.table !== 'card_orders' || !payload.record) {
      return new Response(
        JSON.stringify({ error: 'Invalid webhook payload' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const record = payload.record;
    const quantity = record.quantity ?? 0;
    const totalAmount = record.total_amount ?? 0;
    const deliveryAddress = record.delivery_address?.trim() || '—';

    // Fetch center name from database
    let centerName = '—';
    if (record.center_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: center } = await supabase
          .from('centers')
          .select('name')
          .eq('id', record.center_id)
          .single();
        if (center?.name) centerName = center.name;
      }
    }

    const messageText = `🪪 طلب بطاقات جديد!
السنتر: ${centerName}
عدد البطاقات: ${quantity}
الإجمالي: ${totalAmount} جنيه
العنوان: ${deliveryAddress}
🔗 https://center-hq.vercel.app/admin/orders`;

    const whatsappToken = Deno.env.get('WHATSAPP_TOKEN');
    const phoneNumberId = Deno.env.get('PHONE_NUMBER_ID');

    if (!whatsappToken || !phoneNumberId) {
      console.error('Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: '201220601410',
        type: 'text',
        text: { body: messageText },
      }),
    });

    const resData = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('WhatsApp API error:', res.status, resData);
      return new Response(
        JSON.stringify({ error: 'WhatsApp send failed', details: resData }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, messageId: resData.messages?.[0]?.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('notify-card-order error:', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
