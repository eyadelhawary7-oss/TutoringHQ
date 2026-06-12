import { getTranslations } from 'next-intl/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { formatCurrency } from '@/lib/formatNumber';
import JoinFlowClient from './JoinFlowClient';

/**
 * Public student self-enrollment page (no auth). Fetches the group server-side
 * with the service-role client, checks the WhatsApp kill switch
 * (platform_config.wa_sending_enabled, same gate the notify layer uses), and
 * renders one of: a "link no longer active" error, a "opens soon" notice when
 * WhatsApp sending is paused, or the 3-step enrollment form.
 */

type GroupInfo = {
  id: string;
  name: string | null;
  fee_per_class: number;
  teacherName: string | null;
  subject: string | null;
};

function Chrome({ locale, children }: { locale: string; children: React.ReactNode }) {
  return (
    <div
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen w-full bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
    >
      <header className="flex items-center justify-center border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3">
        <span className="text-base font-bold tracking-wide">
          <span className="text-[var(--color-text-primary)]">Center</span>
          <span className="text-[var(--color-teal)]">HQ</span>
        </span>
      </header>
      <main className="flex flex-col items-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

export default async function PublicGroupJoinPage({
  params,
}: {
  params: Promise<{ locale: string; groupId: string }>;
}) {
  const { locale, groupId } = await params;
  const t = await getTranslations('joinFlow');

  const admin = supabaseAdmin;
  let group: GroupInfo | null = null;
  let waEnabled = false;

  if (admin) {
    const { data } = await admin
      .from('student_groups')
      .select('id, name, fee_per_class, teacher_id')
      .eq('id', groupId)
      .eq('status', 'active')
      .eq('kind', 'private')
      .maybeSingle();

    if (data) {
      const row = data as {
        id: string;
        name: string | null;
        fee_per_class: number | string | null;
        teacher_id: string | null;
      };
      let teacherName: string | null = null;
      let subject: string | null = null;
      if (row.teacher_id) {
        const { data: prof } = await admin
          .from('teacher_profiles')
          .select('display_name, subject')
          .eq('user_id', row.teacher_id)
          .maybeSingle();
        const p = prof as { display_name?: string | null; subject?: string | null } | null;
        teacherName = p?.display_name ?? null;
        subject = p?.subject ?? null;
      }
      group = {
        id: row.id,
        name: row.name,
        fee_per_class: Number(row.fee_per_class) || 0,
        teacherName,
        subject,
      };

      // WhatsApp kill switch: enabled unless explicitly false (matches the
      // platform notify layer's semantics).
      const { data: cfg } = await admin
        .from('platform_config')
        .select('value')
        .eq('key', 'wa_sending_enabled')
        .maybeSingle();
      waEnabled = (cfg as { value?: unknown } | null)?.value !== false;
    }
  }

  if (!group) {
    return (
      <Chrome locale={locale}>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center shadow-card">
          <h1 className="text-lg font-bold text-[var(--color-text-primary)]">{t('errorTitle')}</h1>
        </div>
      </Chrome>
    );
  }

  const groupHeader = (
    <div className="mb-5 text-center">
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{group.name}</h1>
      {group.teacherName && (
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {group.subject
            ? t('withTeacherSubject', { teacher: group.teacherName, subject: group.subject })
            : t('withTeacher', { teacher: group.teacherName })}
        </p>
      )}
      <p className="num mt-2 text-sm font-semibold text-[var(--color-teal-deep)]">
        {t('feePerClass')}: {formatCurrency(group.fee_per_class, locale)}
      </p>
    </div>
  );

  if (!waEnabled) {
    return (
      <Chrome locale={locale}>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
          {groupHeader}
          <div className="rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-brass-soft)] p-4 text-center text-sm text-[var(--color-text-secondary)]">
            {t('comingSoonBanner')}
          </div>
        </div>
      </Chrome>
    );
  }

  return (
    <Chrome locale={locale}>
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        {groupHeader}
        <JoinFlowClient
          groupId={group.id}
          groupName={group.name}
          teacherName={group.teacherName}
          feePerClass={group.fee_per_class}
        />
      </div>
    </Chrome>
  );
}
