'use client';

import { useTranslations } from 'next-intl';

type ComparisonTranslator = ReturnType<typeof useTranslations>;

/**
 * The `.cmp` / `.cgrp` block (design L375-388): one card per criterion at every
 * width — a header naming the task, then three rows, with the TutoringHQ row
 * filled mint (sand on /teachers) rather than merely tinted.
 *
 * This replaces `landing/ComparisonTable.tsx` entirely. That component switched
 * between a four-column `<table>` on desktop and a card stack on mobile; the
 * design draws the card form at both widths, and the table's `✓ ✗ ~` prefix
 * parsing (which coloured cells by scanning the first character of a translated
 * string) goes with it. Cells are now plain sentences.
 *
 * The translator is bound by the caller with a literal `useTranslations(...)`
 * so `scripts/check-i18n.ts` can still resolve every key statically.
 */
export default function ComparisonCards({
  t,
  rowCount = 6,
  tone = 'center',
}: {
  t: ComparisonTranslator;
  rowCount?: number;
  tone?: 'center' | 'teacher';
}) {
  const rowKeys = Array.from({ length: rowCount }, (_, i) => `row${i + 1}`);
  const usFill = tone === 'teacher' ? 'var(--color-sand)' : 'var(--color-mint)';
  const usInk = tone === 'teacher' ? 'var(--color-brass)' : 'var(--color-accent-deep)';

  return (
    <div className="mt-4 flex flex-col gap-3">
      {rowKeys.map((key) => {
        const criterion = t(`${key}.criterion` as 'row1.criterion');
        const rows: Array<{ who: string; what: string; us?: boolean }> = [
          { who: t('colSpreadsheet'), what: t(`${key}.spreadsheet` as 'row1.spreadsheet') },
          { who: t('colPaper'), what: t(`${key}.paper` as 'row1.paper') },
          { who: t('colCenterhq'), what: t(`${key}.centerhq` as 'row1.centerhq'), us: true },
        ];

        return (
          <div
            key={key}
            className="overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)]"
          >
            <div className="border-b border-[var(--color-line)] p-4 text-[13px] font-bold leading-snug text-[var(--color-ink)]">
              {criterion}
            </div>
            {rows.map((r) => (
              <div
                key={r.who}
                className="flex items-start gap-3 border-b border-[var(--color-hairline)] px-4 py-3 last:border-b-0"
                style={r.us ? { backgroundColor: usFill, borderBottomWidth: 0 } : undefined}
              >
                <span
                  className="w-[88px] shrink-0 text-[11px] leading-snug"
                  style={{
                    color: r.us ? usInk : 'var(--color-muted)',
                    fontWeight: r.us ? 700 : 400,
                  }}
                >
                  {r.who}
                </span>
                <span
                  className="flex-1 text-xs leading-snug"
                  style={{
                    color: r.us ? usInk : 'var(--color-ink-body)',
                    fontWeight: r.us ? 600 : 400,
                  }}
                >
                  {r.what}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
