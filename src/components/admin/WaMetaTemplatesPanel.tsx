import { getTranslations } from 'next-intl/server';

/**
 * `Merged-Admin-Platform` §04, templates frame.
 *
 * The platform sender's Meta templates and their approval state, from
 * `wa_meta_templates` (template_name, category, status — 45 live rows).
 *
 * ⚠ **The design's grouping is a FUNDING split, and no column records funding.**
 * It draws NOTIFICATIONS · CUSTOMER CREDIT, COLLECT FLOW · COMPANY PAID and
 * PROMOTIONS · SEPARATE CREDIT — i.e. who pays for each message. Nothing in the
 * schema says who funds a template, so the rows group by their real Meta
 * `category` (UTILITY / MARKETING / AUTHENTICATION / …) and the three funding
 * headings are NOT invented on top of it. Getting that wrong would put a
 * company-paid label on a message the customer is actually billed for.
 *
 * Also omitted from this frame: the per-template On/Off switch. `wa_meta_templates`
 * has no enabled column — Meta's own `status` is the only state there is.
 */

interface Props {
  templates: { name: string; category: string; status: string }[];
}

/** Meta's status vocabulary, mapped to a tone. APPROVED is the only green one. */
function statusTone(status: string): string {
  const s = status.toUpperCase();
  if (s === 'APPROVED') return 'bg-emerald-100 text-emerald-700';
  if (s === 'REJECTED' || s === 'DISABLED') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

export default async function WaMetaTemplatesPanel({ templates }: Props) {
  const t = await getTranslations('admin.waTemplatesPanel');

  if (templates.length === 0) return null;

  const byCategory = new Map<string, { name: string; status: string }[]>();
  for (const tpl of templates) {
    const list = byCategory.get(tpl.category) ?? [];
    list.push({ name: tpl.name, status: tpl.status });
    byCategory.set(tpl.category, list);
  }

  return (
    <section className="mb-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('title')}</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('subtitle')}</p>
      </div>

      {[...byCategory.entries()].map(([category, rows]) => (
        <div key={category}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {category}
          </h3>
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
            {rows.map((row, i) => (
              <div
                key={row.name}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  i > 0 ? 'border-t border-[var(--color-border)]' : ''
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-[var(--color-text-primary)]">
                  {row.name}
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${statusTone(row.status)}`}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">{t('groupingNote')}</p>
    </section>
  );
}
