'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  ArrowUpCircle,
  BadgeCheck,
  BarChart3,
  Bell,
  Copy,
  Eye,
  Gift,
  HandCoins,
  Megaphone,
  type LucideIcon,
  Package,
  QrCode,
  Rocket,
  Search,
  Trash2,
  Truck,
  UserPlus,
  Wallet,
  X,
} from 'lucide-react';
import { Link } from '@/i18n/routing';
import { PageHeader } from '@/components/shared';
import {
  ActionSheet,
  ExpandableRow,
  type InlineAction,
  type SheetAction,
} from '@/components/patterns';
import {
  WA_TEMPLATE_PREVIEW_SAMPLES,
  hasApproximatePreviewBody,
  previewBodyForTemplate,
  renderWaTemplatePreviewBody,
} from '@/lib/waTemplatePreviewSamples';
import type { WaMetaTemplateOwnerRow } from '@/types/wa-meta-owner';
import { SITE } from '@/config/site';

/** Extracts the distinct `{{var}}` tokens from a template's raw body, in order of first appearance. */
function extractVariableTokens(rawBody: string): string[] {
  const matches = rawBody.match(/\{\{\s*[^}]+?\s*\}\}/g) ?? [];
  return Array.from(new Set(matches.map((m) => m.replace(/\s+/g, ''))));
}

const SUPPORT_MAIL = SITE.supportEmail;

function formatTemplateName(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/^chq[_-]?/i, '')
    .split(/[_\-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Keyword -> icon map so the template list can be scanned at a glance, mirroring the design's
 * per-row icon (Merged-Center-WhatsApp §01). Ordered most-specific-first; falls back to a
 * category-level icon, then a generic bell. No schema involved - purely a display mapping over
 * `template_name`/`category`, both of which are real live columns.
 */
const NAME_ICON_RULES: [RegExp, LucideIcon][] = [
  [/absence|inactivity|dormancy|reactivation_warning/, AlertTriangle],
  [/balance_due|fee_reminder|payment_retry|nudge_(due|prebill|locked)|renewal_overdue/, Wallet],
  [/payment_confirmed|payment_failed|pack_invoice/, BadgeCheck],
  [/referral_commission|withdrawal_processed/, HandCoins],
  [/welcome/, Gift],
  [/scan_notification/, QrCode],
  [/weekly_summary|daily_summary|term_summary|ceo_briefing/, BarChart3],
  [/card_order|vendor_new_order|order_shipped/, Truck],
  [/team_invite/, UserPlus],
  [/onboarding_step/, Rocket],
  [/upgrade_nudge|nudge_card_expiry/, ArrowUpCircle],
  [/data_deletion_notice/, Trash2],
];

const CATEGORY_ICON: Record<string, LucideIcon> = {
  card_orders: Package,
  MARKETING: Megaphone,
  UTILITY: Bell,
};

function iconForTemplate(templateName: string, category: string): LucideIcon {
  const match = NAME_ICON_RULES.find(([pattern]) => pattern.test(templateName));
  if (match) return match[1];
  return CATEGORY_ICON[category] ?? Bell;
}

function statusBadgeClasses(status: string): string {
  const normalized = (status ?? '').toUpperCase();
  if (normalized === 'APPROVED' || normalized === 'ACTIVE') {
    return 'bg-[var(--color-mint)] text-[var(--color-accent-deep)] border border-[var(--color-mint-deep)]';
  }
  if (normalized === 'PENDING' || normalized === 'IN_APPEAL' || normalized === 'PENDING_DELETION') {
    return 'bg-[var(--color-sand)] text-[var(--color-brass)] border border-[var(--color-brass)]/25';
  }
  if (normalized === 'REJECTED' || normalized === 'DISABLED' || normalized === 'PAUSED') {
    return 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border border-[var(--color-danger)]/25';
  }
  return 'bg-[var(--color-tile)] text-[var(--color-muted)] border border-[var(--color-line)]';
}

/**
 * The design's `.var` token — mono, mint fill, deep teal, radius 4, always LTR.
 * `Merged-Center-WhatsApp` §01: "Variable tokens stay Latin."
 */
function VarToken({ token }: { token: string }) {
  return (
    <span
      dir="ltr"
      className="inline-block rounded-xs bg-[var(--color-mint)] px-1 font-mono text-xs text-[var(--color-accent-deep)] align-baseline"
    >
      {token}
    </span>
  );
}

/**
 * The row's message preview, to §01's `.prev` line: the template body as stored,
 * with its `{{var}}` placeholders rendered as inline tokens rather than substituted.
 *
 * Deliberately NOT sample-substituted. §01 draws the list showing the shape of the
 * message ("Dear parent, {student} was absent today.") and reserves the filled-in
 * version for the preview sheet, which is where a real name belongs. Two different
 * jobs, two different renderings, same body.
 */
function TemplatePreviewLine({ body }: { body: string }) {
  const parts = body.split(/(\{\{\s*[^}]+?\s*\}\})/g).filter((p) => p !== '');
  return (
    <span className="mt-1 block text-sm leading-snug text-[var(--color-muted)] line-clamp-2">
      {parts.map((part, i) =>
        /^\{\{/.test(part) ? (
          <VarToken key={i} token={part.replace(/\s+/g, '')} />
        ) : (
          <span key={i}>{part.replace(/\n/g, ' ')}</span>
        ),
      )}
    </span>
  );
}

export default function WhatsAppTemplatesClient({
  locale,
  templates,
}: {
  locale: string;
  templates: WaMetaTemplateOwnerRow[];
}) {
  const t = useTranslations('whatsappTemplates');
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [expandedName, setExpandedName] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [copiedName, setCopiedName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);

  const previewRow = useMemo(
    () => templates.find((r) => r.template_name === previewName) ?? null,
    [templates, previewName],
  );

  /** True only when a real stored body exists — see `hasApproximatePreviewBody`. */
  const previewHasBody = previewName ? hasApproximatePreviewBody(previewName) : false;

  const previewBody = useMemo(() => {
    if (!previewName || !previewHasBody) return '';
    return renderWaTemplatePreviewBody(previewBodyForTemplate(previewName), WA_TEMPLATE_PREVIEW_SAMPLES);
  }, [previewName, previewHasBody]);

  const previewVariables = useMemo(() => {
    if (!previewName || !previewHasBody) return [];
    return extractVariableTokens(previewBodyForTemplate(previewName));
  }, [previewName, previewHasBody]);

  // Escape and scrim tap are the two ways out, same as the shared ActionSheet.
  useEffect(() => {
    if (!previewName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewName(null);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheetRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [previewName]);

  useEffect(() => {
    if (!copiedName) return;
    const id = window.setTimeout(() => setCopiedName(null), 2000);
    return () => window.clearTimeout(id);
  }, [copiedName]);

  const categoryLabel = (category: string): string => {
    if (category === 'card_orders') return t('categoryCardOrders');
    if (category === 'MARKETING') return t('categoryMarketing');
    if (category === 'UTILITY') return t('categoryUtility');
    return category;
  };

  const normalizedSearch = search.trim().toLowerCase();
  const filteredTemplates = useMemo(() => {
    if (normalizedSearch === '') return templates;
    return templates.filter((row) => {
      const name = formatTemplateName(row.template_name).toLowerCase();
      return (
        name.includes(normalizedSearch) ||
        row.template_name.toLowerCase().includes(normalizedSearch) ||
        (row.category ?? '').toLowerCase().includes(normalizedSearch)
      );
    });
  }, [templates, normalizedSearch]);

  const notifyHref = useMemo(() => {
    const subject = encodeURIComponent(t('pinNotifySubject'));
    const body = encodeURIComponent(t('pinNotifyBody'));
    return `mailto:${SUPPORT_MAIL}?subject=${subject}&body=${body}`;
  }, [t]);

  const copyTemplateName = (templateName: string) => {
    void navigator.clipboard?.writeText(templateName).then(
      () => setCopiedName(templateName),
      () => undefined,
    );
  };

  /**
   * §01 draws four chips: Edit, Preview, "Auto: on", More.
   *
   * Only Preview and More are built. Edit and Auto both need a per-center,
   * center-writable template record with an `auto_send` flag. Verified live
   * against `information_schema.columns` this pass: `wa_meta_templates` — the
   * table this screen actually reads — is exactly `id, template_name, category,
   * status, variables_count, created_at, updated_at`. There is no `auto_send`
   * and no `message_body` on it. The table that does carry both,
   * `center_message_templates`, holds 0 rows live and has no reader anywhere in
   * `src`. That is decision D4, which is Eyad's and is not a display fix — an
   * auto-send toggle spends WhatsApp credit unattended. Omitted, not faked.
   */
  const inlineActionsFor = (templateName: string): InlineAction[] => [
    {
      id: 'preview',
      label: t('preview'),
      icon: Eye,
      onSelect: () => setPreviewName(templateName),
    },
  ];

  const sheetActionsFor = (templateName: string): SheetAction[] => [
    {
      id: 'preview',
      label: t('preview'),
      icon: Eye,
      onSelect: () => setPreviewName(templateName),
    },
    {
      id: 'copy',
      label: t('copyTemplateName'),
      icon: Copy,
      onSelect: () => copyTemplateName(templateName),
    },
  ];

  return (
    <div className="min-h-screen w-full bg-[var(--color-paper)] p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        <PageHeader title={t('title')} subtitle={t('subtitle')}>
          <Link
            href="/whatsapp-pack"
            locale={locale}
            className="shrink-0 rounded-sm bg-[var(--color-accent)] px-4 py-2 text-base font-semibold text-[var(--color-panel)] transition-colors hover:bg-[var(--color-accent-deep)]"
          >
            {t('openPackSettings')}
          </Link>
        </PageHeader>

        <div className="space-y-6">
          <section className="rounded-lg border border-dashed border-[var(--color-brass)]/40 bg-[var(--color-sand)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-brass)]">
                  {t('comingSoonBadge')}
                </p>
                <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">chq_pin_delivery</h2>
                <p className="mt-2 text-base leading-snug text-[var(--color-ink-body)]">{t('pinDeliveryDesc')}</p>
                <p className="mt-2 text-sm text-[var(--color-muted)]">{t('pinDeliveryMilestone')}</p>
              </div>
              <a
                href={notifyHref}
                className="inline-flex items-center justify-center rounded-md bg-[var(--color-brass)] px-4 py-2.5 text-base font-semibold text-[var(--color-panel)] hover:opacity-90"
              >
                {t('notifyMe')}
              </a>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t('templateLibrary')}</h2>
            {templates.length > 0 ? (
              <div className="relative">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-faint)]"
                  aria-hidden
                />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchTemplates')}
                  className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] py-3 ps-9 pe-10 text-base text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
                    aria-label={t('clearSearch')}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              {filteredTemplates.map((row) => {
                const Icon = iconForTemplate(row.template_name, row.category);
                const hasBody = hasApproximatePreviewBody(row.template_name);
                return (
                  <ExpandableRow
                    key={row.template_name}
                    avatar={<Icon className="h-5 w-5" aria-hidden />}
                    title={formatTemplateName(row.template_name)}
                    meta={
                      <>
                        <span className="block truncate font-mono text-xs text-[var(--color-muted)]">
                          {row.template_name}
                        </span>
                        {hasBody ? <TemplatePreviewLine body={previewBodyForTemplate(row.template_name)} /> : null}
                        {copiedName === row.template_name ? (
                          <span className="mt-1 block text-xs font-semibold text-[var(--color-accent-deep)]">
                            {t('copied')}
                          </span>
                        ) : null}
                      </>
                    }
                    badge={
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${statusBadgeClasses(row.status)}`}
                        >
                          {row.status}
                        </span>
                        <span className="text-xs text-[var(--color-muted)]">{categoryLabel(row.category)}</span>
                      </span>
                    }
                    expanded={expandedName === row.template_name}
                    onToggle={() =>
                      setExpandedName((cur) => (cur === row.template_name ? null : row.template_name))
                    }
                    inlineActions={inlineActionsFor(row.template_name)}
                    onMore={() => setSheetName(row.template_name)}
                    moreLabel={t('more')}
                  />
                );
              })}
            </div>

            {templates.length === 0 ? (
              <p className="text-base text-[var(--color-muted)]">{t('noTemplates')}</p>
            ) : filteredTemplates.length === 0 ? (
              <p className="text-base text-[var(--color-muted)]">{t('noSearchResults')}</p>
            ) : null}
          </section>
        </div>
      </div>

      <ActionSheet
        open={sheetName !== null}
        onClose={() => setSheetName(null)}
        title={sheetName ? formatTemplateName(sheetName) : ''}
        subtitle={sheetName ?? undefined}
        actions={sheetName ? sheetActionsFor(sheetName) : []}
      />

      {/*
        §01's preview sheet. This is a CONTENT sheet — a WhatsApp bubble, the
        variables the body uses — not a list of actions, so the shared
        `ActionSheet` primitive cannot serve it: its whole contract is
        `actions: SheetAction[]`. Rather than fork the primitive into a
        content-bearing variant, this keeps ActionSheet's chrome contract
        (scrim, grab handle, Escape, scrim tap, focus move, body scroll lock)
        and supplies its own body. Flagged in the PR as the one place on this
        screen a primitive does not cover.
      */}
      {previewName ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <div
            className="absolute inset-0 bg-[rgba(20,24,22,0.42)]"
            onClick={() => setPreviewName(null)}
            aria-hidden
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('previewModalTitle')}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 mx-auto max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-[var(--color-panel)] px-6 pb-6 pt-2 shadow-[0_-8px_30px_rgba(28,33,30,0.18)] outline-none"
          >
            <div className="mx-auto mb-3 mt-1 h-1 w-[38px] rounded-pill bg-[var(--color-line)]" aria-hidden />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-bold text-[var(--color-ink)]">{formatTemplateName(previewName)}</h3>
                  {previewRow ? (
                    <span
                      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${statusBadgeClasses(previewRow.status)}`}
                    >
                      {previewRow.status}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate font-mono text-sm text-[var(--color-muted)]">{previewName}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewName(null)}
                className="shrink-0 rounded-sm px-2 py-1 text-base text-[var(--color-ink-body)] hover:bg-[var(--color-tile)]"
              >
                {t('close')}
              </button>
            </div>

            {previewHasBody ? (
              <>
                <p className="mt-3 text-sm text-[var(--color-muted)]">{t('previewSampleNote')}</p>
                <p className="mt-3 mb-2 text-sm font-semibold text-[var(--color-muted)]">{t('howParentsSeeIt')}</p>
                <div
                  className="rounded-md p-4"
                  style={{
                    background: 'var(--color-tile)',
                    backgroundImage: 'radial-gradient(circle at 20% 10%, rgba(14,107,97,.06), transparent 40%)',
                  }}
                >
                  <div className="flex justify-end" dir="ltr">
                    <div
                      className="max-w-[85%] whitespace-pre-wrap rounded-md rounded-se-xs bg-[var(--color-panel)] px-3 py-2.5 text-base leading-relaxed text-[var(--color-ink)] shadow-sm"
                      dir="rtl"
                    >
                      {previewBody}
                    </div>
                  </div>
                </div>
                {previewVariables.length > 0 ? (
                  <>
                    <p className="mt-4 mb-2 text-sm font-semibold text-[var(--color-muted)]">{t('variablesUsed')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {previewVariables.map((token) => (
                        <VarToken key={token} token={token} />
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : (
              /*
                No stored body for this template. `wa_meta_templates` has no body
                column at all (live catalog, this pass), and the repo's
                approximation map covers 16 of the 44 rows this screen lists.
                Drawing the "قالب chq_x (معاينة تقريبية…)" fallback inside a
                WhatsApp bubble would show an owner a string their parents will
                never receive, so the bubble is omitted and the reason is stated.
              */
              <p className="mt-4 rounded-md border border-[var(--color-line)] bg-[var(--color-tile)] p-4 text-base leading-snug text-[var(--color-ink-body)]">
                {t('noStoredBody')}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
