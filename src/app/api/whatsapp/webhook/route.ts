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

        // Process incoming messages (including parent check-up)
        const messages = value.messages || [];
        const contacts = value.contacts || [];
        const waToken = process.env.WHATSAPP_ACCESS_TOKEN;
        const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          const contact = contacts[i] || {};
          const fromPhone = msg.from;
          const bodyText = (msg.text?.body || '').trim();

          await supabaseAdmin.from('whatsapp_incoming').insert({
            from_phone: fromPhone,
            from_name: contact.profile?.name || null,
            message_type: msg.type,
            body: bodyText || msg.type,
            wa_message_id: msg.id,
            timestamp: msg.timestamp ? new Date(parseInt(msg.timestamp) * 1000).toISOString() : new Date().toISOString(),
          });

          // Parent check-up: body is student ID
          if (bodyText && waToken && waPhoneId) {
            const { data: parent } = await supabaseAdmin
              .from('paid_parents')
              .select('id, center_id, student_id, check_ups_used')
              .eq('parent_phone', fromPhone)
              .eq('month', thisMonth)
              .eq('active', true)
              .maybeSingle();

            let replyText = '';

            if (!parent) {
              replyText = 'هذه الخدمة للمشتركين فقط. تواصل مع السنتر للاشتراك. 9.99 جنيه/شهر.';
            } else if (parent.check_ups_used >= 10) {
              replyText = 'استنفدت الاستعلامات الشهرية.';
            } else {
              const studentId = bodyText;
              const { data: student } = await supabaseAdmin
                .from('students')
                .select('id, name, subject_name')
                .eq('id', studentId)
                .eq('center_id', parent.center_id)
                .maybeSingle();

              if (!student) {
                replyText = 'لم يتم العثور على الطالب.';
              } else {
                const { data: scans } = await supabaseAdmin
                  .from('attendance_scans')
                  .select('scanned_at')
                  .eq('student_id', studentId)
                  .order('scanned_at', { ascending: false });

                const total = (scans || []).length;
                const lastDate = scans?.[0]?.scanned_at
                  ? new Date(scans[0].scanned_at).toLocaleDateString('ar-EG')
                  : '—';

                replyText = `الطالب: ${(student as { name: string }).name} | المادة: ${(student as { subject_name: string }).subject_name || '—'} | الحصص: ${total} | آخر حضور: ${lastDate}`;

                await supabaseAdmin
                  .from('paid_parents')
                  .update({ check_ups_used: parent.check_ups_used + 1 })
                  .eq('id', parent.id);
              }
            }

            if (replyText) {
              await fetch(
                `https://graph.facebook.com/v21.0/${waPhoneId}/messages`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${waToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    to: fromPhone,
                    type: 'text',
                    text: { body: replyText, preview_url: false },
                  }),
                }
              );
            }
          }
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
