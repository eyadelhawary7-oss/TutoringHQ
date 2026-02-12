import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function verifyCronRequest(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  try {
    if (!verifyCronRequest(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase not configured');
    }
    if (!accessToken || !phoneNumberId) {
      throw new Error('WhatsApp credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: centers, error: centersError } = await supabase
      .from('centers')
      .select('id, name');

    if (centersError) throw centersError;

    let totalSent = 0;
    const results: { student_id: string; days: number; template: string; success: boolean; error?: string }[] = [];

    for (const center of centers || []) {
      const { data: settings } = await supabase
        .from('reminder_settings')
        .select('day5_enabled, day10_enabled, day15_enabled, day5, day10, day15')
        .eq('center_id', center.id)
        .single();

      const day5Enabled = settings?.day5_enabled ?? true;
      const day10Enabled = settings?.day10_enabled ?? true;
      const day15Enabled = settings?.day15_enabled ?? true;
      const day5 = settings?.day5 ?? 5;
      const day10 = settings?.day10 ?? 10;
      const day15 = settings?.day15 ?? 15;

      const { data: students, error: studentsError } = await supabase
        .from('students')
        .select('id, name, parent_phone, subject_name, monthly_fee')
        .eq('center_id', center.id)
        .eq('payment_status', 'unpaid');

      if (studentsError) {
        console.error(`Error fetching students for center ${center.id}:`, studentsError);
        continue;
      }

      for (const student of students || []) {
        if (!student.parent_phone) continue;

        const { data: lastPayments } = await supabase
          .from('payments')
          .select('payment_date')
          .eq('student_id', student.id)
          .order('payment_date', { ascending: false })
          .limit(1);

        const lastPaymentDate = lastPayments?.[0]?.payment_date
          ? new Date(lastPayments[0].payment_date)
          : new Date(0);

        const daysSincePayment = Math.floor(
          (Date.now() - lastPaymentDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        let templateName: string | null = null;

        if (day5Enabled && daysSincePayment === day5) {
          templateName = 'payment_reminder_day5';
        } else if (day10Enabled && daysSincePayment === day10) {
          templateName = 'payment_reminder_day10';
        } else if (day15Enabled && daysSincePayment === day15) {
          templateName = 'payment_reminder_day15';
          await supabase
            .from('students')
            .update({ alert_status: 'overdue' })
            .eq('id', student.id);
        }

        if (!templateName) continue;

        try {
          const toPhone = String(student.parent_phone).replace(/^0/, '20');
          const response = await fetch(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: toPhone,
                type: 'template',
                template: {
                  name: templateName,
                  language: { code: 'ar' },
                  components: [
                    {
                      type: 'body',
                      parameters: [
                        { type: 'text', text: student.name || '' },
                        { type: 'text', text: student.subject_name || '' },
                        { type: 'text', text: String(student.monthly_fee || 0) },
                      ],
                    },
                  ],
                },
              }),
            }
          );

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error((errData as { error?: { message?: string } })?.error?.message || 'WhatsApp API error');
          }

          await supabase.from('whatsapp_messages').insert({
            center_id: center.id,
            student_id: student.id,
            to_phone: toPhone,
            message_type: 'individual',
            template_name: templateName,
            body: null,
            status: 'sent',
          });

          totalSent++;
          results.push({ student_id: student.id, days: daysSincePayment, template: templateName, success: true });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.error(`Failed to send reminder for student ${student.id}:`, err);
          results.push({ student_id: student.id, days: daysSincePayment, template: templateName, success: false, error: msg });
        }
      }
    }

    return NextResponse.json({
      success: true,
      totalSent,
      centersProcessed: centers?.length || 0,
      results,
    });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
