'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import type { VerificationState } from '@/lib/verification/state';
import { digitalCollectionView, verifyCtaView } from '@/lib/verification/uiState';
import VerifyIdCta from './VerifyIdCta';

/**
 * `Merged-Teacher-Home` §01, UNVERIFIED frame — the honest state the design
 * draws and the live app never built.
 *
 * The design gives Teacher Home two frames in one screen. The verified frame
 * leads with a balance card; the unverified frame leads with this conversion
 * card. The live `/teacher` home had NEITHER — `grep -n "verif|payout|Valify"`
 * over the whole teacher portal returned nothing before this branch. So the
 * screen was not lying, it was silent: a teacher had no way to learn that
 * collection exists or what unlocks it.
 *
 * This renders the design's unverified frame verbatim, with the CTA disabled
 * and explained because Valify is not wired up. The VERIFIED frame — the
 * balance card, Pending/Available, Thursday payouts, recent payouts list — is
 * NOT built here: that is `Merged-Teacher-Money`, one of the six protected
 * files, and it is Eyad's phase.
 *
 * Copy is the design's own, EN and AR, keys identical across both files.
 */
export default function CollectForYouCard({
  state,
  onStart,
}: {
  state: VerificationState;
  onStart?: () => void;
}) {
  const t = useTranslations('verification');
  const collection = digitalCollectionView(state);

  // Once collection is genuinely on, this conversion card is the wrong screen —
  // the verified frame belongs to Teacher-Money (protected). Render nothing
  // rather than an out-of-date pitch.
  if (collection.on) return null;

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-accent)]/25 bg-[var(--color-mint)] p-5">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-deep)]/10 text-[var(--color-accent-deep)]"
          aria-hidden
        >
          <ShieldCheck className="h-[19px] w-[19px]" />
        </span>
        <h2 className="text-base font-bold text-[var(--color-text-primary)]">
          {t('collectForYou.title')}
        </h2>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        {t('collectForYou.body')}
      </p>

      <VerifyIdCta state={state} onStart={onStart} />

      {/* The design's `.vsub` line. Shown only when the CTA is live: promising
          "paid straight to you · we handle the tax receipt" beside a disabled
          button reads as a tease, and today the button is always disabled. */}
      {verifyCtaView(state).enabled && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('collectForYou.subline')}</p>
      )}
    </section>
  );
}
