'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Users } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';

type PrivateGroup = {
  id: string;
  name: string | null;
  fee_per_class: number;
  status: string | null;
  activeStudents: number;
  pendingStudents: number;
};

/**
 * Private group list (State B only - the GET route is gated by
 * requireTeacherPrivateAccess). `refreshKey` re-fetches after a create.
 */
export default function PrivateGroupsSection({
  refreshKey,
  onAdd,
}: {
  refreshKey: number;
  onAdd: () => void;
}) {
  const t = useTranslations('teacherPortal.groups');
  const tPortal = useTranslations('teacherPortal');
  const locale = useLocale();
  const router = useRouter();

  const [groups, setGroups] = useState<PrivateGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/private/groups', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = (await res.json()) as { groups: PrivateGroup[] };
      setGroups(data.groups);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups, refreshKey]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Users size={18} className="text-teal-400" aria-hidden />
          {t('title')}
        </h2>
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          <Plus size={16} aria-hidden />
          {t('add')}
        </button>
      </div>

      {loading && groups === null ? (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)]"
            />
          ))}
        </div>
      ) : loadError || groups === null ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4 text-center">
          <button
            onClick={loadGroups}
            className="text-sm font-medium text-teal-400 hover:text-teal-300"
          >
            {tPortal('retry')}
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/teacher/groups/${g.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-3 transition-colors hover:border-teal-800"
              >
                <div>
                  <p className="font-medium text-[var(--color-text-primary)]">{g.name}</p>
                  <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                    {t('students', { count: formatNumber(g.activeStudents, locale) })}
                    {g.pendingStudents > 0 && (
                      <span className="ms-2 text-amber-400">
                        {t('pending', { count: formatNumber(g.pendingStudents, locale) })}
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-sm text-[var(--color-text-secondary)]">
                  {t('feePerClass')}{' '}
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {formatCurrency(g.fee_per_class, locale)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
