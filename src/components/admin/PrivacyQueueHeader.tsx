'use client';

/**
 * `Merged-Admin-Platform` §06 — the privacy queue header.
 *
 * Three counts and a type filter, over the existing table. PDPL gives 30 days
 * from a verified request; "due soon" is the design's under-5-days flag.
 *
 * `privacy_requests.status` ∈ pending | in_progress | completed | rejected, so
 * OPEN is pending+in_progress and CLOSED is completed+rejected. `due_at` is
 * computed server-side as created_at + 30d — there is no due column and none is
 * needed.
 *
 * OMITTED: the design's request-detail sheet with a "WILL BE DELETED · Student
 * records 95" breakdown. `privacy_requests` carries the requester as free text
 * (`full_name`, `phone`, `email`, `relationship`) and has NO link to a centre or
 * account, so there is nothing to join the counts to. Rendering a number there
 * would mean inventing it.
 */

import { useLocale, useTranslations } from 'next-intl';
import { formatNumber } from '@/lib/formatNumber';

export type PrivacyTypeFilter = 'all' | 'access' | 'deletion' | 'export';

export interface PrivacyQueueRow {
  status: string;
  due_at: string | null;
  request_types: string[] | null;
}

/** Open = not yet resolved. Both terminal statuses are closed. */
export function isOpenPrivacyRequest(status: string): boolean {
  return status === 'pending' || status === 'in_progress';
}

export function privacyQueueCounts(
  rows: PrivacyQueueRow[],
  now: Date = new Date(),
  dueSoonDays = 5,
): { open: number; dueSoon: number; closed: number } {
  let open = 0;
  let dueSoon = 0;
  let closed = 0;
  const soonMs = dueSoonDays * 86400000;
  for (const r of rows) {
    if (!isOpenPrivacyRequest(r.status)) {
      closed += 1;
      continue;
    }
    open += 1;
    // An already-overdue request is still "due soon" — it has not stopped
    // needing attention just because the window closed.
    if (r.due_at && new Date(r.due_at).getTime() - now.getTime() < soonMs) dueSoon += 1;
  }
  return { open, dueSoon, closed };
}

export function filterByPrivacyType(
  rows: PrivacyQueueRow[],
  filter: PrivacyTypeFilter,
): PrivacyQueueRow[] {
  if (filter === 'all') return rows;
  return rows.filter((r) => (r.request_types ?? []).includes(filter));
}

interface Props {
  rows: PrivacyQueueRow[];
  filter: PrivacyTypeFilter;
  onFilter: (f: PrivacyTypeFilter) => void;
  slaDays: number;
}

export default function PrivacyQueueHeader({ rows, filter, onFilter, slaDays }: Props) {
  const t = useTranslations('admin.privacyQueue');
  const locale = useLocale();
  const counts = privacyQueueCounts(rows);

  return (
    <div className="mb-5 space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'open', value: counts.open, label: t('open') },
          { key: 'dueSoon', value: counts.dueSoon, label: t('dueSoon') },
          { key: 'closed', value: counts.closed, label: t('closed') },
        ].map((tile) => (
          <div
            key={tile.key}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3"
          >
            <p
              className={`text-lg font-bold ${
                tile.key === 'dueSoon' && tile.value > 0
                  ? 'text-[var(--color-brass)]'
                  : 'text-[var(--color-text-primary)]'
              }`}
            >
              {formatNumber(tile.value, locale)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{tile.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('filterLabel')}>
        {(['all', 'access', 'deletion', 'export'] as const).map((f) => (
          <button
            key={f}
            role="tab"
            type="button"
            aria-selected={filter === f}
            onClick={() => onFilter(f)}
            className={`btn-press chq-focus min-h-[40px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
              filter === f
                ? 'bg-teal-600 text-white'
                : 'border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
            }`}
          >
            {t(`filter_${f}`)}
          </button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
        {t('slaNote', { days: formatNumber(slaDays, locale) })}
      </p>
    </div>
  );
}
