import type { ReactNode } from 'react';
import { Palette, QrCode, Truck, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

const FEATURE_ICONS = [QrCode, Users, Palette, Truck];

/**
 * The card preview + four-point feature list a center sees while card
 * ordering is gated off (`Merged-Center-Orders` §04). Swaps in for the plain
 * `ComingSoon` card at this one gate - `ComingSoon` stays generic for every
 * other not-yet feature.
 *
 * The design's own CTA is "Notify me when it launches", a write with no
 * destination table (D7, `BUILD-AFTER-REDESIGN.md`) - omitted per the
 * standing rule on controls that do not exist. `action` carries the real,
 * already-working path instead (the owner's "enable it in Settings" link),
 * unchanged from what this gate showed before.
 */
export default async function CardOrdersTeaser({
  locale,
  action,
}: {
  locale: string;
  action: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'orders.teaser' });
  const features = [0, 1, 2, 3].map((i) =>
    t(`feature${i}` as Parameters<typeof t>[0]),
  );

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-8 text-center">
        <div className="mx-auto flex w-fit flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            TutoringHQ
          </span>
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-1)] px-3 py-2">
            <Users size={18} className="text-[var(--color-text-muted)]" aria-hidden />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('sampleName')}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[var(--color-text-muted)]">
            <QrCode size={28} aria-hidden />
            <span className="text-xs font-semibold">{t('sampleIdBadge')}</span>
          </div>
        </div>

        <span className="inline-block rounded-full bg-[var(--color-brass-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-text-amber)]">
          {t('badge')}
        </span>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          {t('description')}
        </p>

        <ul className="flex flex-col gap-3 text-start">
          {features.map((feature, i) => {
            const Icon = FEATURE_ICONS[i];
            return (
              <li key={feature} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]">
                  <Icon size={16} aria-hidden />
                </span>
                <span className="text-sm text-[var(--color-text-secondary)]">{feature}</span>
              </li>
            );
          })}
        </ul>

        <div className="pt-1">{action}</div>
      </div>
    </div>
  );
}
