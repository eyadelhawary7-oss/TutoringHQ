import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const VARIABLES = ['{student_name}', '{center_name}', '{subject}', '{amount}', '{date}'];

function substitute(template: string, ctx: { student_name?: string; center_name?: string; subject?: string; amount?: string; date?: string }): string {
  let out = template;
  out = out.replace(/\{student_name\}/g, ctx.student_name || '');
  out = out.replace(/\{center_name\}/g, ctx.center_name || '');
  out = out.replace(/\{subject\}/g, ctx.subject || '');
  out = out.replace(/\{amount\}/g, ctx.amount || '');
  out = out.replace(/\{date\}/g, ctx.date || new Date().toLocaleDateString('ar-EG'));
  return out;
}

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
    const { centerId, target, groupId, studentIds, message } = body;

    if (!centerId || !message?.trim()) {
      return NextResponse.json({ error: 'Missing centerId or message' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: center } = await supabaseAdmin
      .from('centers')
      .select('name')
      .eq('id', centerId)
      .single();

    let recipients: { id: string; name: string; phone: string; subject_name: string | null; monthly_fee: number }[] = [];

    if (target === 'group' && groupId) {
      const { data: members } = await supabaseAdmin
        .from('student_group_members')
        .select('student_id')
        .eq('group_id', groupId);
      const ids = (members || []).map((m: { student_id: string }) => m.student_id);
      const { data: students } = await supabaseAdmin
        .from('students')
        .select('id, name, phone, parent_phone, subject_name, monthly_fee')
        .in('id', ids);
      recipients = (students || []).map((s: { id: string; name: string; phone: string | null; parent_phone: string | null; subject_name: string | null; monthly_fee: number }) => ({
        id: s.id,
        name: s.name,
        phone: (s.phone || s.parent_phone || '').replace(/\D/g, ''),
        subject_name: s.subject_name,
        monthly_fee: s.monthly_fee || 0,
      })).filter((r: { phone: string }) => r.phone.length > 0);
    } else if (target === 'all') {
      const { data: students } = await supabaseAdmin
        .from('students')
        .select('id, name, phone, parent_phone, subject_name, monthly_fee')
        .eq('center_id', centerId);
      recipients = (students || []).map((s: { id: string; name: string; phone: string | null; parent_phone: string | null; subject_name: string | null; monthly_fee: number }) => ({
        id: s.id,
        name: s.name,
        phone: (s.phone || s.parent_phone || '').replace(/\D/g, ''),
        subject_name: s.subject_name,
        monthly_fee: s.monthly_fee || 0,
      })).filter((r: { phone: string }) => r.phone.length > 0);
    } else if (target === 'students' && Array.isArray(studentIds) && studentIds.length > 0) {
      const { data: students } = await supabaseAdmin
        .from('students')
        .select('id, name, phone, parent_phone, subject_name, monthly_fee')
        .in('id', studentIds)
        .eq('center_id', centerId);
      recipients = (students || []).map((s: { id: string; name: string; phone: string | null; parent_phone: string | null; subject_name: string | null; monthly_fee: number }) => ({
        id: s.id,
        name: s.name,
        phone: (s.phone || s.parent_phone || '').replace(/\D/g, ''),
        subject_name: s.subject_name,
        monthly_fee: s.monthly_fee || 0,
      })).filter((r: { phone: string }) => r.phone.length > 0);
    }

    let sent = 0;
    let failed = 0;

    for (const r of recipients) {
      const text = substitute(message.trim(), {
        student_name: r.name,
        center_name: center?.name,
        subject: r.subject_name || '',
        amount: String(r.monthly_fee),
        date: new Date().toLocaleDateString('ar-EG'),
      });

      try {
        const waRes = await fetch(
          `https://graph.facebook.com/v21.0/${waPhoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${waAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: r.phone,
              type: 'text',
              text: { body: text, preview_url: false },
            }),
          }
        );

        if (waRes.ok) {
          sent++;
          const waData = await waRes.json();
          await supabaseAdmin.from('whatsapp_messages').insert({
            center_id: centerId,
            sent_by: user.id,
            student_id: r.id,
            to_phone: r.phone,
            message_type: 'text',
            body: text,
            wa_message_id: waData.messages?.[0]?.id || null,
            status: 'sent',
          });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    return NextResponse.json({ sent, failed, total: recipients.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
