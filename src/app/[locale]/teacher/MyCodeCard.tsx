'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import CopyButton from './CopyButton';

/**
 * The teacher's own code (teacher_profiles.referral_code), surfaced so they can
 * GIVE IT TO A CENTER to be added to its roster. The SAME code also powers the
 * referral program, but the shareable referral LINK lives on the home card -
 * here we deliberately show the BARE code, which is what a center types into
 * its add-by-code flow. Reads GET /api/teacher/profile (own row only, scoped to
 * user_id = auth.userId server-side). Renders nothing until the code loads.
 *
 * `compact` is the lighter Centers-page variant (one-line center hint). The full
 * variant (Settings) also spells out the referral use so a teacher is never
 * confused about why there is both a code and a referral link.
 */
export default function MyCodeCard({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('teacherPortal.myCode');
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch('/api/teacher/profile', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const json = (await res.json()) as { referralCode?: string | null };
        if (!cancelled) setCode(json.referralCode ?? null);
      } catch {
        // Non-fatal: the card stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!code) return null;

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-brass-soft)] p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-[var(--color-text-primary)]">
        <KeyRound size={18} className="text-[var(--color-brass)]" aria-hidden />
        {t('heading')}
      </h2>
      <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
        {compact ? t('hintCenter') : t('forCenter')}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-surface-1)] px-3 py-2 text-base font-bold tracking-wide text-[var(--color-text-primary)]"
        >
          {code}
        </code>
        <CopyButton value={code} label={t('copy')} copiedLabel={t('copied')} />
      </div>
      {!compact && (
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">{t('forReferral')}</p>
      )}
    </section>
  );
}
