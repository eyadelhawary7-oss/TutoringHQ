import { redirect } from 'next/navigation';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { dedupePrintStudentRows } from '@/lib/dedupePrintStudentRows';
import PrintClient, { type PrintStudentRow } from './PrintClient';

export default async function PrintStudentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!supabaseAdmin) {
    redirect(`/${locale}/students`);
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('center_id')
    .eq('id', user.id)
    .maybeSingle();

  const centerId = userRow?.center_id;
  if (!centerId) {
    redirect(`/${locale}/students`);
  }

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select('name, phone')
    .eq('id', centerId)
    .maybeSingle();

  const { data: students } = await supabaseAdmin
    .from('students')
    .select('id, name, subject, qr_code, student_number')
    .eq('center_id', centerId)
    .or('is_active.is.null,is_active.eq.true')
    .order('student_number', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  const studentList = dedupePrintStudentRows((students ?? []) as PrintStudentRow[]);

  const studentGroupMap: Record<string, string> = {};
  if (studentList.length > 0) {
    const { data: memberRows } = await supabaseAdmin
      .from('student_group_members')
      .select('student_id, student_groups(name)')
      .in(
        'student_id',
        studentList.map((s) => s.id),
      );
    const rows = memberRows as unknown as {
      student_id: string;
      student_groups: { name: string } | { name: string }[] | null;
    }[];
    for (const m of rows ?? []) {
      if (!studentGroupMap[m.student_id]) {
        const g = m.student_groups;
        const gName = Array.isArray(g) ? g[0]?.name : g?.name;
        if (gName) studentGroupMap[m.student_id] = gName;
      }
    }
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const academicYear = month >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`;

  return (
    <PrintClient
      students={studentList}
      centerName={center?.name ?? 'TutoringHQ'}
      centerPhone={center?.phone ?? ''}
      academicYear={academicYear}
      studentGroupMap={studentGroupMap}
    />
  );
}
