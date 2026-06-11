'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, PauseCircle, Wallet } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import CenterCutsSection from '../CenterCutsSection';
import JoinCenterCard from '../JoinCenterCard';
import IncomeView from '../IncomeView';
import PrivateGroupModal from '../PrivateGroupModal';
import PrivateGroupsSection from '../PrivateGroupsSection';

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
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [groupsRefreshKey, setGroupsRefreshKey] = useState(0);

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
      {/* Section 1 (all states): center-cut tracker - what centers owe me. */}
      <CenterCutsSection />

      {/* Join a center (FREE zone): teacher-initiated join request by code. */}
      <JoinCenterCard />

      {/* Section 2 (Option A): the private engine is ALWAYS present. Subscribed
          teachers get the live widgets; never-subscribed and lapsed teachers
          get a locked conversion card that renders NO private data and fetches
          NO private routes - the gate stays in the API. */}
      {ctx.state === 'unified' && (
        <>
          <PrivateGroupsSection
            refreshKey={groupsRefreshKey}
            onAdd={() => setShowCreateGroup(true)}
          />
          <section>
            <div className="mb-4 flex items-center gap-2">
              <Wallet size={18} className="text-[var(--color-brass)]" aria-hidden />
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                {t('privateEngine.title')}
              </h2>
            </div>
            <IncomeView />
          </section>
        </>
      )}

      {ctx.state === 'center_only' && (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/50 bg-[var(--color-brass-soft)] p-6">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--color-brass)]" aria-hidden />
            <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
              {t('privateUpsell.title')}
            </h2>
          </div>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{t('privateUpsell.body')}</p>
          <ul className="mb-4 flex list-disc flex-col gap-1 ps-5 text-sm text-[var(--color-text-secondary)]">
            <li>{t('privateUpsell.trialLine')}</li>
            <li>{t('privateUpsell.priceLine')}</li>
            <li>{t('privateUpsell.noCardLine')}</li>
          </ul>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="rounded-lg bg-[var(--color-brass)] px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
          >
            {t('privateUpsell.cta')}
          </button>
        </section>
      )}

      {ctx.state === 'lapsed' && (
        <section className="rounded-[var(--radius-card)] border border-[var(--color-teal)]/40 bg-[var(--color-teal-soft)] p-6">
          <div className="mb-2 flex items-center gap-2">
            <PauseCircle size={18} className="text-[var(--color-teal-deep)]" aria-hidden />
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

      {/* The create flow is never an escape hatch for a lapsed teacher - no
          entry point in State C (and the POST route refuses server-side). */}
      {ctx.state !== 'lapsed' && (
        <PrivateGroupModal
          open={showCreateGroup}
          showTrialTerms={ctx.state === 'center_only'}
          onClose={() => setShowCreateGroup(false)}
          onCreated={() => {
            setShowCreateGroup(false);
            setGroupsRefreshKey((k) => k + 1);
            // After the FIRST group the gate flips (trial provisioned by the
            // DB trigger) - refetch context instead of assuming the state.
            loadContext();
          }}
        />
      )}
    </div>
  );
}
