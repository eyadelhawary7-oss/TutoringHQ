'use client';

import { useTranslations } from 'next-intl';

const ROW_KEYS = [
  'row1',
  'row2',
  'row3',
  'row4',
  'row5',
  'row6',
  'row7',
  'row8',
] as const;

type RowKey = (typeof ROW_KEYS)[number];

function cellVariant(val: string): 'pos' | 'neg' | 'partial' | 'neutral' {
  if (val.startsWith('✓')) return 'pos';
  if (val.startsWith('✗')) return 'neg';
  if (val.startsWith('~')) return 'partial';
  return 'neutral';
}

const VARIANT_COLOR: Record<ReturnType<typeof cellVariant>, string> = {
  pos:     'var(--color-teal-deep)',
  neg:     '#b4322a',
  partial: 'var(--color-text-amber)',
  neutral: 'var(--color-text-secondary)',
};

const SEP_STYLE = {
  borderInlineStart: '1px solid var(--color-border)',
} as const;

const CHQ_HEADER_STYLE = {
  borderInlineStart: '2px solid rgba(14,107,97,0.45)',
  background: 'rgba(14,107,97,0.07)',
} as const;

const CHQ_CELL_STYLE = {
  borderInlineStart: '2px solid rgba(14,107,97,0.30)',
  background: 'rgba(14,107,97,0.05)',
} as const;

/**
 * Desktop: 4-column table (criterion | Spreadsheet | Paper | CenterHQ).
 * Mobile: each row as a stacked card with labelled sub-rows.
 * CenterHQ column is visually emphasised with teal accent.
 */
export function ComparisonTable() {
  const t = useTranslations('landing.compare');

  return (
    <section className="border-t border-[var(--color-border)] bg-[var(--color-surface-1)] px-4 py-16 md:px-6 md:py-24">
      <style>{`
        .chq-cmp-row:hover .chq-cmp-cell {
          background: rgba(28,33,30,0.03) !important;
        }
        .chq-cmp-row:hover .chq-cmp-chq {
          background: rgba(14,107,97,0.09) !important;
        }
      `}</style>

      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center md:mb-14">
          <h2 className="text-2xl font-bold text-[var(--color-text-primary)] md:text-3xl">
            {t('heading')}
          </h2>
          <p className="mt-3 text-sm text-[var(--color-text-muted)] md:text-base">
            {t('subheading')}
          </p>
        </div>

        {/* ── Desktop table ── */}
        <div className="hidden overflow-x-auto md:block">
          <table
            style={{ tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}
          >
            <colgroup>
              <col style={{ width: '28%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr>
                <th
                  className="pb-4 pe-4 text-start text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
                >
                  {t('colCriterion')}
                </th>
                <th
                  className="pb-4 px-4 text-start text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
                  style={SEP_STYLE}
                >
                  {t('colSpreadsheet')}
                </th>
                <th
                  className="pb-4 px-4 text-start text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]"
                  style={SEP_STYLE}
                >
                  {t('colPaper')}
                </th>
                <th
                  className="pb-4 px-4 text-start text-xs font-semibold uppercase tracking-wider text-[var(--color-teal-deep)]"
                  style={CHQ_HEADER_STYLE}
                >
                  {t('colCenterhq')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ROW_KEYS.map((key) => {
                const criterion   = t(`${key}.criterion`   as 'row1.criterion');
                const spreadsheet = t(`${key}.spreadsheet` as 'row1.spreadsheet');
                const paper       = t(`${key}.paper`       as 'row1.paper');
                const centerhq    = t(`${key}.centerhq`    as 'row1.centerhq');
                return (
                  <tr
                    key={key}
                    className="chq-cmp-row"
                    style={{ borderTop: '1px solid var(--color-border)' }}
                  >
                    <td
                      className="chq-cmp-cell py-4 pe-4 text-sm font-medium text-[var(--color-text-primary)]"
                    >
                      {criterion}
                    </td>
                    <td
                      className="chq-cmp-cell px-4 py-4 text-sm"
                      style={{ ...SEP_STYLE, color: VARIANT_COLOR[cellVariant(spreadsheet)] }}
                    >
                      {spreadsheet}
                    </td>
                    <td
                      className="chq-cmp-cell px-4 py-4 text-sm"
                      style={{ ...SEP_STYLE, color: VARIANT_COLOR[cellVariant(paper)] }}
                    >
                      {paper}
                    </td>
                    <td
                      className="chq-cmp-chq px-4 py-4 text-sm font-medium"
                      style={{ ...CHQ_CELL_STYLE, color: VARIANT_COLOR[cellVariant(centerhq)] }}
                    >
                      {centerhq}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Mobile card stack ── */}
        <div className="flex flex-col gap-4 md:hidden">
          {ROW_KEYS.map((key) => {
            const criterion   = t(`${key}.criterion`   as 'row1.criterion');
            const spreadsheet = t(`${key}.spreadsheet` as 'row1.spreadsheet');
            const paper       = t(`${key}.paper`       as 'row1.paper');
            const centerhq    = t(`${key}.centerhq`    as 'row1.centerhq');
            return (
              <div
                key={key}
                className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]"
              >
                {/* Criterion header */}
                <div className="border-b border-[var(--color-border)] px-4 py-3">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{criterion}</p>
                </div>
                {/* Platform rows */}
                <div>
                  <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-3">
                    <span className="mt-px w-20 shrink-0 text-xs font-medium text-[var(--color-text-muted)]">
                      {t('colSpreadsheet')}
                    </span>
                    <span
                      className="text-sm leading-snug"
                      style={{ color: VARIANT_COLOR[cellVariant(spreadsheet)] }}
                    >
                      {spreadsheet}
                    </span>
                  </div>
                  <div className="flex items-start gap-3 border-b border-[var(--color-border)] px-4 py-3">
                    <span className="mt-px w-20 shrink-0 text-xs font-medium text-[var(--color-text-muted)]">
                      {t('colPaper')}
                    </span>
                    <span
                      className="text-sm leading-snug"
                      style={{ color: VARIANT_COLOR[cellVariant(paper)] }}
                    >
                      {paper}
                    </span>
                  </div>
                  <div className="flex items-start gap-3 bg-[var(--color-teal-soft)] px-4 py-3">
                    <span
                      className="mt-px w-20 shrink-0 text-xs font-semibold text-[var(--color-teal-deep)]"
                      style={{ borderInlineStart: '2px solid rgba(14,107,97,0.5)', paddingInlineStart: '6px' }}
                    >
                      {t('colCenterhq')}
                    </span>
                    <span
                      className="text-sm font-medium leading-snug"
                      style={{ color: VARIANT_COLOR[cellVariant(centerhq)] }}
                    >
                      {centerhq}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
