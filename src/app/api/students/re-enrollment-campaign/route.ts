import { NextRequest, NextResponse } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { sendTemplateMessage } from '@/lib/whatsapp/client';

const REENROLLMENT_TEMPLATE = 'chq_reenrollment';

/** POST: Send re-enrollment campaign to inactive/churned students. Targets parent_phone. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireCenterAuth(request);
    if (!auth.ok) return auth.response;

    const { centerId, supabaseAdmin } = auth;

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
