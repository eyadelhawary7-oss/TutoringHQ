import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * WhatsApp webhook endpoint.
 * 
 * GET: Webhook verification (Meta sends a challenge)
 * POST: Receive status updates and incoming messages
 * 
 * Required env vars:
 * - WHATSAPP_VERIFY_TOKEN: Token you set in Meta App Dashboard
 */

// GET: Webhook verification
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WhatsApp webhook verified');
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// POST: Receive incoming messages and status updates
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      // Still return 200 so Meta doesn't retry
      console.error('WhatsApp webhook: Missing Supabase config');
      return NextResponse.json({ status: 'ok' });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Process each entry
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Process status updates (sent, delivered, read, failed)
        const statuses = value.statuses || [];
        for (const status of statuses) {
          await supabaseAdmin
            .from('whatsapp_messages')
            .update({ status: status.status, updated_at: new Date().toISOString() })
            .eq('wa_message_id', status.id);
        }

        // Process incoming messages
        const messages = value.messages || [];
        const contacts = value.contacts || [];

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const contact = contacts[i] || {};

          await supabaseAdmin.from('whatsapp_incoming').insert({
            from_phone: msg.from,
            from_name: contact.profile?.name || null,
            message_type: msg.type,
            body: msg.text?.body || msg.type,
            wa_message_id: msg.id,
            timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          });
        }
      }
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('WhatsApp webhook error:', error);
    // Still return 200 to prevent Meta from retrying
    return NextResponse.json({ status: 'ok' });
  }
}
