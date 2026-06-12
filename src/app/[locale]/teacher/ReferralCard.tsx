'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Gift } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import CopyButton from './CopyButton';

const REFERRAL_BASE = 'https://centerhq.app/teacher/landing';

/**
 * Lightweight referral hook (free zone home). Reads the teacher's referral_code
 * from GET /api/teacher/profile and offers a shareable landing link. Renders
 * nothing until a code is available.
 */
export default function ReferralCard() {
  const t = useTranslations('teacherPortal.referral');

  const [referralCode, setReferralCode] = useState<string | null>(null);

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
        if (!cancelled) setReferralCode(json.referralCode ?? null);
      } catch {
        // Non-fatal: card stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!referralCode) return null;

  const referralUrl = `${REFERRAL_BASE}?ref=${encodeURIComponent(referralCode)}`;

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-brass-soft)] p-5">
      <h2 className="mb-1 flex items-center gap-2 text-base font-bold text-[var(--color-text-primary)]">
        <Gift size={18} className="text-[var(--color-brass)]" aria-hidden />
        {t('heading')}
      </h2>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('body')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          dir="ltr"
          className="min-w-0 flex-1 truncate rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-surface-1)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
        >
          {referralUrl}
        </code>
        <CopyButton value={referralUrl} label={t('copy')} copiedLabel={t('copied')} />
      </div>
    </section>
  );
}
