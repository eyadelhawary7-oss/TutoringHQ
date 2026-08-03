'use client';

export interface PlanRow {
  /** Stable key for React. */
  id: string;
  name: string;
  /** Capacity line under the name. */
  capacity: string;
  /** Already-formatted price (or the word "Free"). */
  price: string;
}

/**
 * The `.plans` / `.pl` list (design L389-395): one line per tier, name over
 * capacity on one side and the price on the other. Six cards of features became
 * six lines, because the tiers differ only by capacity.
 */
export default function PlanRows({ rows }: { rows: PlanRow[] }) {
  return (
    <div className="mt-4 flex flex-col gap-1">
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3"
        >
          <span>
            <span className="block text-[13px] font-bold text-[var(--color-ink)]">{row.name}</span>
            <span className="mt-1 block text-[11px] text-[var(--color-muted)]">{row.capacity}</span>
          </span>
          <span className="mkt-mono whitespace-nowrap text-[13px] text-[var(--color-ink)]">
            {row.price}
          </span>
        </div>
      ))}
    </div>
  );
}
