'use client';

import { MoreVertical } from 'lucide-react';
import CapacityBar from './CapacityBar';

interface GroupCardBaseProps {
  title: string;
  /** The second line — teacher, room, kind. Already-formatted text. */
  meta?: React.ReactNode;
  /**
   * Start of the count/fee line. Already formatted by the caller through
   * `formatNumber` / `formatCurrency` — this component never formats a number
   * itself, so it cannot pick the wrong locale or the wrong currency.
   */
  countLabel?: React.ReactNode;
  /** End of the count/fee line — normally the per-class fee. Already formatted. */
  feeLabel?: React.ReactNode;
  /** Current enrolment, for the capacity bar. */
  value?: number;
  /** The cap. Null / 0 / the 999 sentinel renders no bar at all — see CapacityBar. */
  max?: number | null;
  /** Accessible name for the capacity bar. Required when `max` is a real cap. */
  capacityLabel?: string;
  /** Accent border plus ring. The open or acted-on card. */
  selected?: boolean;
}

/** Same pairing rule as ListRow: the three-dot and its name arrive together. */
type GroupCardActionProps =
  | { onActions: () => void; actionsLabel: string }
  | { onActions?: undefined; actionsLabel?: never };

type GroupCardProps = GroupCardBaseProps & GroupCardActionProps;

/**
 * The group card, to `Merged-Design-Patterns` §05 `.gcard`.
 *
 *   .gcard     { #FFFDF8; 1px #E2DDD1; radius 16; padding 16; gap 8;
 *                shadow 0 1px 2px rgba(28,33,30,.05) }
 *   .gcard.sel { border #0E6B61; ring 0 0 0 2px rgba(14,107,97,.16) }
 *
 * Not `Card` — that is a generic wrapper on the surface tokens, and this is a
 * specific composition (title row with a three-dot, a justified count/fee line,
 * a capacity bar) on the paper palette.
 *
 * The selected ring is .16 alpha here against ExpandableRow's .14. The two
 * genuinely differ in the design; each carries its own drawn value rather than
 * being averaged into one.
 *
 * The capacity bar is absent, not empty, when the group has no cap set. See
 * CapacityBar — most live groups have no `max_capacity`, and a bar drawn
 * against an invented denominator is a fabricated number on a screen a center
 * uses to decide whether to enrol somebody.
 */
export default function GroupCard({
  title,
  meta,
  countLabel,
  feeLabel,
  value,
  max,
  capacityLabel,
  selected,
  onActions,
  actionsLabel,
}: GroupCardProps) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border bg-[var(--color-panel)] p-4 ${
        selected
          ? 'border-[var(--color-accent)] shadow-[0_0_0_2px_rgba(14,107,97,0.16)]'
          : 'border-[var(--color-line)] shadow-[0_1px_2px_rgba(28,33,30,0.05)]'
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-semibold text-[var(--color-ink)]">{title}</p>
          {meta && <p className="mt-1 truncate text-sm text-[var(--color-muted)]">{meta}</p>}
        </div>
        {onActions && (
          <button
            type="button"
            onClick={onActions}
            aria-label={actionsLabel}
            className="flex h-11 w-11 min-h-[44px] shrink-0 items-center justify-center rounded-md text-[var(--color-faint)] hover:bg-[var(--color-tile)] btn-press chq-focus"
          >
            <MoreVertical className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>

      {(countLabel || feeLabel) && (
        <div className="flex items-center justify-between gap-2 text-sm text-[var(--color-mid)]">
          <span className="num min-w-0 truncate">{countLabel}</span>
          <span className="num shrink-0">{feeLabel}</span>
        </div>
      )}

      {value != null && capacityLabel && (
        <CapacityBar value={value} max={max} label={capacityLabel} />
      )}
    </div>
  );
}
