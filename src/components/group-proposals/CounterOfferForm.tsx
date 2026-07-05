'use client';

import { useTranslations } from 'next-intl';

/**
 * The counter-offer sub-form shared by both group-proposal screens: a cut input,
 * a note input, and a Send button. The cut guard (`>= feePerClass`) is the
 * commission constraint and is single-sourced here so it can never drift between
 * the two sides. Identical markup on both sides except the input border colour
 * token, passed verbatim via `borderClass` so neither side's appearance changes.
 */
export default function CounterOfferForm({
  counterCut,
  setCounterCut,
  counterNote,
  setCounterNote,
  onSend,
  busy,
  feePerClass,
  borderClass,
}: {
  counterCut: string;
  setCounterCut: (v: string) => void;
  counterNote: string;
  setCounterNote: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  feePerClass: number;
  /** Full Tailwind class for the inputs' border, e.g. `border-[var(--color-border)]`. */
  borderClass: string;
}) {
  const t = useTranslations('groupProposals');

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-[var(--color-surface-2)] p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">
          {t('counterCutLabel')}
        </label>
        <input
          type="number"
          min={0}
          step={0.01}
          value={counterCut}
          onChange={(e) => setCounterCut(e.target.value)}
          className={`w-32 rounded-lg border ${borderClass} bg-[var(--color-surface-1)] px-2 py-1.5 font-mono text-sm text-[var(--color-text-primary)]`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <label className="mb-1 block text-xs font-medium text-[var(--color-text-primary)]">
          {t('noteLabel')}
        </label>
        <input
          value={counterNote}
          maxLength={500}
          onChange={(e) => setCounterNote(e.target.value)}
          className={`w-full rounded-lg border ${borderClass} bg-[var(--color-surface-1)] px-2 py-1.5 text-sm text-[var(--color-text-primary)]`}
        />
      </div>
      <button
        type="button"
        disabled={busy || counterCut === '' || Number(counterCut) >= feePerClass}
        onClick={onSend}
        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {t('send')}
      </button>
    </div>
  );
}
