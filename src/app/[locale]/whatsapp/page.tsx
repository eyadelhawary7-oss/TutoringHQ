import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
import { Link } from '@/i18n/routing';
import WhatsAppTemplatesClient from './WhatsAppTemplatesClient';
import type { WaMetaTemplateOwnerRow } from '@/types/wa-meta-owner';

export default async function WhatsAppTemplatesPage({
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

  const { data: tplRows, error: tplErr } = await supabaseAdmin
    .from('wa_meta_templates')
    .select('template_name, category, status, variables_count')
    .neq('category', 'vendor')
    .neq('template_name', 'chq_pin_delivery')
    .order('category', { ascending: true })
    .order('template_name', { ascending: true });

  if (tplErr) {
    console.error('[whatsapp/templates]', tplErr);
  }

  const templates = (tplRows ?? []) as WaMetaTemplateOwnerRow[];

  return <WhatsAppTemplatesClient locale={locale} templates={templates} />;
}
