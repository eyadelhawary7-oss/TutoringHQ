'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, Sparkles, PauseCircle, Wallet } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import IncomeView from './IncomeView';

type TeacherContext = {
  state: 'center_only' | 'unified' | 'lapsed';
  centers: { id: string; name: string | null; center_code: string | null }[];
  hasPrivateAccess: boolean;
};

export default function TeacherHomePage() {
  const t = useTranslations('teacherPortal');
  const router = useRouter();

  const [ctx, setCtx] = useState<TeacherContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadContext = useCallback(async () => {
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
      const res = await fetch('/api/teacher/context', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setCtx((await res.json()) as TeacherContext);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  if (loading && !ctx) {
    return (
      <div>
        <div className="mb-6 h-7 w-44 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        {[1, 2].map((i) => (
          <div
            key={i}
            className="mb-4 h-20 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]"
          />
        ))}
        <div className="h-32 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </div>
    );
  }

  if (loadError || !ctx) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center">
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
          {t('errorTitle')}
        </h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
        <button
          onClick={loadContext}
          className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <Building2 size={18} className="text-teal-400" aria-hidden />
          {t('myCenters.title')}
        </h2>
        {ctx.centers.length === 0 ? (
          <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 text-sm text-[var(--color-text-secondary)]">
            {t('myCenters.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {ctx.centers.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4"
              >
                <p className="font-medium text-[var(--color-text-primary)]">{c.name}</p>
                {c.center_code && (
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {t('myCenters.codeLabel', { code: c.center_code })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {ctx.state === 'center_only' && (
        <section className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 opacity-80">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={18} className="text-teal-400" aria-hidden />
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              {t('privateCta.title')}
            </h2>
          </div>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('privateCta.body')}</p>
          <span className="inline-block rounded-full bg-teal-900/40 px-3 py-1 text-xs font-medium text-teal-400">
            {t('privateCta.comingSoon')}
          </span>
        </section>
      )}

      {ctx.state === 'unified' && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Wallet size={18} className="text-teal-400" aria-hidden />
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              {t('privateEngine.title')}
            </h2>
          </div>
          <IncomeView />
        </section>
      )}

      {ctx.state === 'lapsed' && (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6">
          <div className="mb-2 flex items-center gap-2">
            <PauseCircle size={18} className="text-amber-400" aria-hidden />
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              {t('resume.title')}
            </h2>
          </div>
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('resume.body')}</p>
          <Link
            href="/teacher/resubscribe"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
          >
            {t('resume.cta')}
          </Link>
        </section>
      )}
    </div>
  );
}
