import { createClient as createServiceClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import WhatsAppPackClient from './WhatsAppPackClient';

export default async function WhatsAppPackPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    redirect(`/${locale}/dashboard`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const supabaseAdmin = createServiceClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('center_id, role')
    .eq('id', user.id)
    .maybeSingle();

  const centerId = userRow?.center_id as string | undefined;
  if (!centerId || !['owner', 'admin'].includes((userRow?.role as string) ?? '')) {
    redirect(`/${locale}/dashboard`);
  }

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select(
      'id, name, phone, plan, parent_pack_enabled, parent_pack_active_parents, announcement_balance',
    )
    .eq('id', centerId)
    .maybeSingle();

  if (!center) {
    redirect(`/${locale}/dashboard`);
  }

  let students: {
    id: string;
    name: string;
    student_number: string | null;
    parent_phone: string | null;
    parent_pack_opted_in: boolean | null;
  }[] = [];

  let blasts: {
    id: string;
    blast_type: string;
    message: string;
    parents_notified: number;
    total_amount: string | number;
    billing_status: string;
    created_at: string;
  }[] = [];

  let lastAlertMap: Record<string, string> = {};

  if (center.parent_pack_enabled === true) {
    const { data: studentsData } = await supabaseAdmin
      .from('students')
      .select('id, name, student_number, parent_phone, parent_pack_opted_in')
      .eq('center_id', centerId)
      .not('parent_phone', 'is', null)
      .eq('is_active', true)
      .order('parent_phone')
      .order('name');

    students = studentsData ?? [];

    const { data: blastsData } = await supabaseAdmin
      .from('announcement_blasts')
      .select('id, blast_type, message, parents_notified, total_amount, billing_status, created_at')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(10);

    blasts = blastsData ?? [];

    const { data: lastAlerts } = await supabaseAdmin
      .from('wa_message_queue')
      .select('to_phone, created_at')
      .eq('center_id', centerId)
      .in('template_name', ['chq_parent_absence', 'chq_parent_balance_due'])
      .order('created_at', { ascending: false });

    lastAlertMap = {};
    for (const row of lastAlerts ?? []) {
      if (row.to_phone && !lastAlertMap[row.to_phone]) {
        lastAlertMap[row.to_phone] = row.created_at as string;
      }
    }
  }

  return (
    <WhatsAppPackClient
      center={center}
      students={students}
      blasts={blasts}
      lastAlertMap={lastAlertMap}
      locale={locale}
    />
  );
}
