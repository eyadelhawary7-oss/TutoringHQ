import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { Link } from '@/i18n/routing';
import WhatsAppPackClient from './WhatsAppPackClient';

/** Announcement blast UI: composer, 160-char limit, WA preview, sendAnnouncementBlast → POST /api/parent-pack/announcement */

type CenterRow = {
  id: string;
  name: string;
  phone: string | null;
  plan: string;
  parent_pack_enabled: boolean | null;
  parent_pack_active_parents: number | null;
  announcement_balance: unknown;
  pack_request_status?: string | null;
  pack_requested_at?: string | null;
  pack_rejection_reason?: string | null;
  pack_pending_balance?: number | string | null;
  pack_months_without_invoice?: number | string | null;
};

export default async function WhatsAppPackPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!supabaseAdmin) {
    redirect(`/${locale}/dashboard`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/${locale}/login`);
  }

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('center_id, role')
    .eq('id', user.id)
    .maybeSingle();

  const centerId = userRow?.center_id as string | undefined;
  if (!centerId) {
    redirect(`/${locale}/dashboard`);
  }

  const role = (userRow?.role as string) ?? '';
  if (!['owner', 'admin', 'super_admin'].includes(role)) {
    const t = await getTranslations({ locale, namespace: 'permissions.ownerOnly' });
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-8">
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{t('title')}</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{t('message')}</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {t('backToDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  const { data: center } = await supabaseAdmin
    .from('centers')
    .select(
      `id, name, phone, plan, parent_pack_enabled, parent_pack_active_parents, announcement_balance,
      pack_request_status, pack_requested_at, pack_rejection_reason,
      pack_pending_balance, pack_months_without_invoice, pack_custom_invoice_minimum`,
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
  let announcementsThisMonth = 0;

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

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    const { count: monthBlastCount } = await supabaseAdmin
      .from('announcement_blasts')
      .select('id', { count: 'exact', head: true })
      .eq('center_id', centerId)
      .gte('created_at', monthStart);
    announcementsThisMonth = monthBlastCount ?? 0;

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

  const c = center as CenterRow;

  return (
    <WhatsAppPackClient
      center={{
        id: c.id,
        name: c.name,
        phone: c.phone,
        plan: c.plan,
        parent_pack_enabled: c.parent_pack_enabled === true,
        parent_pack_active_parents: Number(c.parent_pack_active_parents ?? 0),
        announcement_balance: Number(c.announcement_balance ?? 0),
      }}
      students={students}
      blasts={blasts}
      lastAlertMap={lastAlertMap}
      locale={locale}
      packRequestStatus={String(c.pack_request_status ?? 'none')}
      packRejectionReason={c.pack_rejection_reason ?? null}
      packRequestedAt={c.pack_requested_at ?? null}
      packPendingBalance={Number(c.pack_pending_balance ?? 0)}
      monthsWithoutInvoice={Number(c.pack_months_without_invoice ?? 0)}
      announcementsThisMonth={announcementsThisMonth}
    />
  );
}
