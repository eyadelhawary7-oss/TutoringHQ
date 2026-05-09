import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createClient } from '@/lib/supabase/server';
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
  if (!centerId || !['owner', 'admin'].includes((userRow?.role as string) ?? '')) {
    redirect(`/${locale}/dashboard`);
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
