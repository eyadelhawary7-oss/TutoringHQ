import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsAppMessage, normalizeWhatsAppNumber } from '@/lib/whatsapp';

async function getContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) return null;

  const authHeader = request.headers.get('Authorization');
  const accessToken = authHeader?.replace('Bearer ', '');
  if (!accessToken) return null;

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error } = await supabaseAuth.auth.getUser();
  if (error || !user) return null;

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  return { supabaseAdmin };
}

/** POST: When a spot opens, notify first waitlist parent via WA. Called after member removal. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { groupId } = await params;
    if (!groupId) return NextResponse.json({ error: 'groupId required' }, { status: 400 });

    const { supabaseAdmin } = ctx;

    const { data: group } = await supabaseAdmin
      .from('student_groups')
      .select('id, name, center_id')
      .eq('id', groupId)
      .single();

    if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

    const { data: firstWaitlist } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone')
      .eq('waitlist_group_id', groupId)
      .not('parent_phone', 'is', null)
      .order('waitlist_position', { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!firstWaitlist) {
      return NextResponse.json({ ok: true, notified: false, message: 'No waitlist or no parent phone' });
    }

    const phone = (firstWaitlist as { parent_phone?: string }).parent_phone;
    if (!phone) {
      return NextResponse.json({ ok: true, notified: false });
    }

    const groupName = (group as { name?: string }).name ?? 'المجموعة';
    const studentName = (firstWaitlist as { name?: string }).name ?? '';
    const msg = `مرحباً، متاح مكان في مجموعة "${groupName}" لطفلك ${studentName}. هل ترغب بالتسجيل؟ رد بـ نعم أو لا`;

    const normalized = normalizeWhatsAppNumber(phone);
    const sent = await sendWhatsAppMessage(normalized, msg);

    if (sent) {
      await supabaseAdmin.from('waitlist_notifications').insert({
        student_id: firstWaitlist.id,
        group_id: groupId,
        response: 'pending',
      });
    }

    return NextResponse.json({ ok: true, notified: sent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
