'use client';

type Props = {
  confirmed: number;
  pending: number;
  confirmedLabel: string;
  pendingLabel: string;
  currencySuffix: string;
};

export function PaymentBar({
  confirmed,
  pending,
  confirmedLabel,
  pendingLabel,
  currencySuffix,
}: Props) {
  const total = confirmed + pending;
  const confirmedPct = total > 0 ? (confirmed / total) * 100 : 0;
  const pendingPct = total > 0 ? (pending / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-[var(--color-surface-3)]">
        {total > 0 && (
          <>
            <div
              className="h-full bg-[var(--color-success)] transition-all duration-slow ease-out"
              style={{ width: `${confirmedPct}%` }}
            />
            <div
              className="h-full bg-[var(--color-warning)] transition-all duration-slow ease-out"
              style={{ width: `${pendingPct}%` }}
            />
          </>
        )}
      </div>

      <div className="flex items-center justify-between text-xs flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-success)]" />
          <span className="text-[var(--color-text-secondary)]">{confirmedLabel}</span>
          <span className="font-semibold text-white ms-1">
            {Number(confirmed).toLocaleString('en-US')} {currencySuffix}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]" />
          <span className="text-[var(--color-text-secondary)]">{pendingLabel}</span>
          <span className="font-semibold text-white ms-1">
            {Number(pending).toLocaleString('en-US')} {currencySuffix}
          </span>
        </div>
      </div>
    </div>
  );
}
