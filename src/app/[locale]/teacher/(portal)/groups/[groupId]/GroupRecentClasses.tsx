'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

type ClassRow = {
  session_id: string;
  scheduled_at: string;
  date: string;
  attended_count: number;
  total_billed: number;
};

/** `Merged-Teacher-Groups` §02 draws three rows under "Recent classes". */
const RECENT_LIMIT = 3;

/**
 * "Recent classes" on the group Overview - `Merged-Teacher-Groups` §02's
 * `.clist` / `.crow`: date, "N present", the class total, newest first.
 *
 * Reads the same GET .../groups/[groupId]/classes the Classes tab already
 * uses and shows only its first three rows; the tab itself stays the full,
 * paginated, expandable record. Nothing is rendered when the group has no
 * classes yet - an empty box on Overview would say less than the Classes
 * tab's own empty state already does.
 *
 * Display-only. There is no collect action here on purpose: settling a charge
 * is a money-state write and lives where it already lives (the Classes tab).
 */
export default function GroupRecentClasses({
  groupId,
  onSeeAll,
}: {
  groupId: string;
  onSeeAll: () => void;
}) {
  const t = useTranslations('teacherPortal.groups');
  const locale = useLocale();

  const [classes, setClasses] = useState<ClassRow[] | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`/api/teacher/private/groups/${groupId}/classes`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { classes: ClassRow[] };
        if (live) setClasses(data.classes.slice(0, RECENT_LIMIT));
      } catch {
        // Overview is a summary surface: a failed recent-classes read leaves
        // the block out rather than pushing an error card above the join
        // link. The Classes tab is the authoritative view and reports its own
        // failures.
      }
    })();
    return () => {
      live = false;
    };
  }, [groupId]);

  if (classes === null || classes.length === 0) return null;

  return (
    <section>
      {/* §02 `.sec` 13px/600 muted. */}
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <h2 className="text-base font-semibold text-[var(--color-muted)]">{t('recentClasses')}</h2>
        <button
          type="button"
          onClick={onSeeAll}
          className="text-sm font-semibold text-[var(--color-accent-deep)] transition-opacity hover:opacity-80 chq-focus"
        >
          {t('seeAllClasses')}
        </button>
      </div>

      {/* §02 `.clist`: panel, 1px line, radius 12, clipped. `.crow` 12/16 on a
          hairline top border. `.cdt` 13px/600 · `.cpr` 12px muted · `.cmn`
          13px/700 deep teal, pushed to the end. */}
      <ul className="overflow-hidden rounded-md border border-[var(--color-line)] bg-[var(--color-panel)]">
        {classes.map((c) => (
          <li
            key={c.session_id}
            className="flex items-center gap-2 border-t border-[var(--color-hairline)] px-4 py-3 first:border-t-0"
          >
            <span className="truncate text-base font-semibold text-[var(--color-ink)]">
              {formatDate(c.date, locale, 'short')}
            </span>
            <span className="shrink-0 text-sm text-[var(--color-muted)]">
              {t('presentCount', {
                count: formatNumber(c.attended_count, locale, { integerOnly: true }),
              })}
            </span>
            <span className="ms-auto shrink-0 text-base font-bold tabular-nums text-[var(--color-accent-deep)]">
              {formatCurrency(c.total_billed, locale)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
