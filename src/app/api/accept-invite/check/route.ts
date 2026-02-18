import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function toE164(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '+20' + cleaned.slice(1);
  if (cleaned.startsWith('20')) return '+' + cleaned;
  return '+20' + cleaned;
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await request.json();
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phoneRaw) {
      return NextResponse.json({ hasInvite: false, error: 'Phone required' }, { status: 400 });
    }

    const phoneE164 = toE164(phoneRaw);
    const normalizedPhone = phoneRaw.replace(/\D/g, '');
    const phoneVariants = [
      phoneE164,
      normalizedPhone.startsWith('0') ? normalizedPhone : '0' + normalizedPhone,
      '+20' + normalizedPhone.replace(/^0/, ''),
      '20' + normalizedPhone.replace(/^0/, ''),
    ];

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const p of phoneVariants) {
      const { data } = await supabaseAdmin
        .from('center_invites')
        .select('id, center_id, role, invited_name')
        .eq('phone', p)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle();

      if (data) {
        const { data: center } = await supabaseAdmin
          .from('centers')
          .select('name')
          .eq('id', data.center_id)
          .single();
        return NextResponse.json({
          hasInvite: true,
          centerName: (center as { name?: string })?.name,
          role: data.role,
        });
      }
    }

    return NextResponse.json({ hasInvite: false });
  } catch (err) {
    console.error('Accept invite check:', err);
    return NextResponse.json({ hasInvite: false, error: 'Server error' }, { status: 500 });
  }
}
