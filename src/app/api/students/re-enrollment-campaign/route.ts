import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { sendTemplateMessage } from '@/lib/whatsapp/client';

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

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('id, center_id')
    .eq('id', user.id)
    .single();

  const centerId = (userRecord as { center_id?: string } | null)?.center_id;
  if (!centerId) return null;

  return { centerId, supabaseAdmin };
}

const REENROLLMENT_TEMPLATE = 'chq_reenrollment';

/** POST: Send re-enrollment campaign to inactive/churned students. Targets parent_phone. */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getContext(request);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { centerId, supabaseAdmin } = ctx;

    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, name, parent_phone')
      .eq('center_id', centerId)
      .in('lifecycle_status', ['inactive', 'churned'])
      .not('parent_phone', 'is', null);

    const list = (students || []) as { id: string; name: string; parent_phone: string | null }[];
    const results: { student_id: string; success: boolean; error?: string }[] = [];

    for (const st of list) {
      const phone = st.parent_phone?.trim();
      if (!phone) {
        results.push({ student_id: st.id, success: false, error: 'No parent phone' });
        continue;
      }

      const variables: Record<string, string> = {
        '1': st.name ?? '',
        '2': 'مرحباً بعودتك',
      };

      const result = await sendTemplateMessage(centerId, phone, REENROLLMENT_TEMPLATE, variables);
      results.push({ student_id: st.id, success: result.success, error: result.error });
    }

    const successCount = results.filter((r) => r.success).length;
    return NextResponse.json({
      ok: true,
      sent: successCount,
      total: list.length,
      results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
