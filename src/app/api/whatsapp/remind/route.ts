import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Send payment reminder to unpaid students via WhatsApp.
 * Fetches unpaid students for a center and sends template messages.
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
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 503 });
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
    const { centerId, studentIds, templateName, language } = body;

    if (!centerId) {
      return NextResponse.json({ error: 'Missing centerId' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Get center info
    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('name')
      .eq('id', centerId)
      .single();

    // Get students to remind
    let query = supabaseAdmin
      .from('students')
      .select('id, name, phone, subject_name, monthly_fee, payment_status')
      .eq('center_id', centerId);

    if (studentIds && studentIds.length > 0) {
      query = query.in('id', studentIds);
    } else {
      query = query.eq('payment_status', 'unpaid');
    }

    const { data: students, error: studentsError } = await query;

    if (studentsError) {
      return NextResponse.json({ error: studentsError.message }, { status: 500 });
    }

    if (!students || students.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, message: 'No students to remind' });
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const student of students) {
      if (!student.phone) {
        failed++;
        errors.push(`${student.name}: no phone number`);
        continue;
      }

      const formattedPhone = student.phone.replace(/[^0-9]/g, '');

      try {
        const waPayload = {
          messaging_product: 'whatsapp',
          to: formattedPhone,
          type: 'template',
          template: {
            name: templateName || 'payment_reminder',
            language: { code: language || 'ar' },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: student.name },
                  { type: 'text', text: center?.name || '' },
                  { type: 'text', text: String(student.monthly_fee || 0) },
                  { type: 'text', text: student.subject_name || '' },
                ],
              },
            ],
          },
        };

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

        if (waResponse.ok) {
          sent++;
          // Log the message
          await supabaseAdmin.from('whatsapp_messages').insert({
            center_id: centerId,
            sent_by: user.id,
            student_id: student.id,
            to_phone: formattedPhone,
            message_type: 'template',
            template_name: templateName || 'payment_reminder',
            body: `Payment reminder for ${student.name}`,
            wa_message_id: waResult.messages?.[0]?.id || null,
            status: 'sent',
          });
        } else {
          failed++;
          errors.push(`${student.name}: ${waResult.error?.message || 'Send failed'}`);
        }
      } catch {
        failed++;
        errors.push(`${student.name}: Network error`);
      }
    }

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      center_id: centerId,
      user_id: user.id,
      action: 'whatsapp_bulk_reminder',
      entity_type: 'whatsapp',
      details: { sent, failed, totalStudents: students.length },
    });

    return NextResponse.json({ sent, failed, errors: errors.slice(0, 10) });
  } catch (error) {
    console.error('WhatsApp remind error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
