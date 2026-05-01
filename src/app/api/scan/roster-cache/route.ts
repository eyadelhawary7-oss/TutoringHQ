import { NextResponse, type NextRequest } from 'next/server';
import { requireCenterAuth } from '@/lib/centerAuth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

type StudentRow = {
  id: string;
  student_number: string | null;
  name: string | null;
  is_active: boolean | null;
};

export async function GET(request: Request) {
  const auth = await requireCenterAuth(request as NextRequest);
  if (!auth.ok) {
    return auth.response;
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, student_number, name, is_active')
    .eq('center_id', auth.centerId)
    .eq('is_active', true)
    .order('student_number', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cachedAt = new Date().toISOString();
  const entries = (data ?? []).map((s: StudentRow) => {
    const raw = s.student_number ?? '';
    const studentNumber = raw.startsWith('#') ? raw : '#' + raw;
    return {
      studentId: s.id,
      studentNumber,
      name: s.name ?? '',
      groupIds: [] as string[],
      isActive: s.is_active === true,
      cachedAt,
    };
  });

  return NextResponse.json({ entries });
}
