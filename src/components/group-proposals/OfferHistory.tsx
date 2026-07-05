'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/formatNumber';
import type { Offer } from './types';

/**
 * The offer-history disclosure shared by both group-proposal screens: a
 * show/hide toggle plus the expanded list of every offer in the negotiation.
 * Identical markup on both sides except the list's start-border colour token,
 * which each side passes verbatim via `borderClass` so neither side's
 * appearance changes.
 */
export default function OfferHistory({
  offers,
  expanded,
  onToggle,
  borderClass,
}: {
  offers: Offer[];
  expanded: boolean;
  onToggle: () => void;
  /** Full Tailwind class for the list's start border, e.g. `border-[var(--color-border)]`. */
  borderClass: string;
}) {
  const t = useTranslations('groupProposals');
  const locale = useLocale();

  return (
    <>
      {offers.length > 0 && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline"
        >
          {expanded ? (
            <>
              <ChevronUp size={14} aria-hidden /> {t('hideHistory')}
            </>
          ) : (
            <>
              <ChevronDown size={14} aria-hidden /> {t('showHistory')}
            </>
          )}
        </button>
      )}
      {expanded && (
        <ul className={`mt-2 flex flex-col gap-1 border-s-2 ${borderClass} ps-3`}>
          {offers.map((o) => (
            <li key={o.id} className="text-xs text-[var(--color-text-secondary)]">
              <span className="font-semibold">
                {o.madeBy === 'teacher' ? t('byTeacher') : t('byCenter')}
              </span>
              {': '}
              <span className="font-mono">{formatCurrency(o.cutEgp, locale)}</span>
              {' - '}
              {formatDate(o.createdAt, locale)}
              {o.note ? ` - ${o.note}` : ''}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
