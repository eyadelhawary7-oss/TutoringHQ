import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizePhone } from '@/lib/utils/phone';
import { parseBodyWithLimit } from '@/lib/validate';

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = (await parseBodyWithLimit(request, 65536)) as Record<string, unknown>;
    const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phoneRaw) {
      return NextResponse.json({ hasInvite: false, error: 'Phone required' }, { status: 400 });
    }

    const phoneE164 = normalizePhone(phoneRaw);
    const digits = phoneRaw.replace(/\D/g, '');
    const phoneVariants = [
      phoneE164,
      ...(digits.length >= 10
        ? [digits.startsWith('0') ? digits : '0' + digits]
        : []),
    ];

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    for (const p of [...new Set(phoneVariants)]) {
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
