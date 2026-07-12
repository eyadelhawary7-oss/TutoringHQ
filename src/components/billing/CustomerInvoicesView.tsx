'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { AlertTriangle, CheckCircle2, Clock, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatDate } from '@/lib/formatNumber';
import { ProcessingFeeBreakdown } from '@/components/billing/ProcessingFeeInfo';
import { PaymobInvoiceModal } from '@/components/billing/PaymobInvoiceModal';

type UnpaidInvoice = {
  id: string;
  invoiceNumber: string | null;
  invoiceType: string | null;
  status: string | null;
  total: number;
  amountReceived: number;
  remaining: number;
  processingFee: number;
  partial: boolean;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  dueDate: string | null;
  createdAt: string | null;
};

type PaidInvoice = {
  id: string;
  invoiceNumber: string | null;
  invoiceType: string | null;
  status: string | null;
  total: number;
  processingFee: number;
  paidAt: string | null;
  createdAt: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
};

type Forecast = {
  isForecast: true;
  amount: number;
  subscription: number;
  fee: number;
  date: string;
  estimated: true;
};

type Payload = { unpaid: UnpaidInvoice[]; paid: PaidInvoice[]; upcoming: Forecast | null };

/**
 * Endpoints the surface talks to. Centers and teachers share this SAME view (so a
 * future invoice redesign lands on both at once); only the URLs differ because the
 * data model + auth context differ.
 */
export type CustomerInvoicesEndpoints = {
  /** GET → Payload (unpaid / paid / upcoming). */
  invoices: string;
  /** POST → { iframeUrl }. */
  pay: (invoiceId: string) => string;
  /** GET → PDF receipt. */
  pdf: (invoiceId: string) => string;
  /** Paymob poll endpoint (defaults to the center one). */
  statusEndpoint?: string;
};

/** Invoice types with a dedicated label; anything else falls back to `other`. */
const KNOWN_TYPES = new Set([
  'subscription',
  'plan_upgrade_difference',
  'pack_billing',
  'announcement_settlement',
  'late_payment_fee',
  'reactivation_fee',
]);
function typeKey(invoiceType: string | null): string {
  return invoiceType && KNOWN_TYPES.has(invoiceType) ? `type.${invoiceType}` : 'type.other';
}

async function authHeader(): Promise<HeadersInit | null> {
  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData?.user) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * The single customer billing surface (Phase 3): unpaid (Pay-now via Paymob),
 * paid history (receipt download), and the upcoming forecast line (forecast-only,
 * never persisted until billing day). Arabic-first, RTL, mobile-first.
 */
export function CustomerInvoicesView({ endpoints }: { endpoints: CustomerInvoicesEndpoints }) {
  const t = useTranslations('customerInvoices');
  const tConsent = useTranslations('savedCard.consent');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Opt-in card saving (default OFF — card-less is the product default). When
  // ticked, the pay request records consent and asks Paymob to tokenize the card.
  const [saveCard, setSaveCard] = useState(false);

  // Pay flow state
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ iframeUrl: string; invoiceId: string } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const hdr = await authHeader();
    if (!hdr) {
      window.location.href = `/${locale}/login`;
      return;
    }
    try {
      const res = await fetch(endpoints.invoices, { headers: hdr });
      const json = (await res.json()) as Payload | { error: string };
      if (!res.ok) {
        setError((json as { error?: string }).error ?? t('loadError'));
      } else {
        setData(json as Payload);
        setError(null);
      }
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [locale, t, endpoints]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPay = useCallback(
    async (invoiceId: string) => {
      if (payingId) return;
      setPayingId(invoiceId);
      setPayError(null);
      try {
        const hdr = await authHeader();
        if (!hdr) {
          window.location.href = `/${locale}/login`;
          return;
        }
        const res = await fetch(endpoints.pay(invoiceId), {
          method: 'POST',
          headers: { ...hdr, 'Content-Type': 'application/json' },
          body: JSON.stringify({ saveCard, locale }),
        });
        const json = (await res.json()) as { iframeUrl?: string; error?: string };
        if (!res.ok || !json.iframeUrl) {
          setPayError(json.error ?? t('payError'));
          return;
        }
        setModal({ iframeUrl: json.iframeUrl, invoiceId });
      } catch {
        setPayError(t('payError'));
      } finally {
        setPayingId(null);
      }
    },
    [locale, payingId, saveCard, t, endpoints],
  );

  const onDownload = useCallback(
    async (invoiceId: string) => {
      setDownloadingId(invoiceId);
      try {
        const hdr = await authHeader();
        if (!hdr) return;
        const res = await fetch(endpoints.pdf(invoiceId), { headers: hdr });
        if (!res.ok) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-${invoiceId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        setDownloadingId(null);
      }
    },
    [endpoints],
  );

  const onPaid = useCallback(() => {
    setModal(null);
    setLoading(true);
    void load();
  }, [load]);

  const periodLabel = (start: string | null, end: string | null): string => {
    if (start && end) return `${formatDate(start, locale)} — ${formatDate(end, locale)}`;
    return start ? formatDate(start, locale) : '';
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] px-4 py-6 sm:px-6" dir={dir}>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header>
          <h1 className="text-xl font-bold text-[var(--color-text-primary)] sm:text-2xl">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>
        </header>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-10 text-sm text-[var(--color-text-secondary)]">
            <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden /> {t('loading')}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-800/40 bg-red-900/20 p-4 text-sm text-red-300">
            {error}
          </div>
        ) : data ? (
          <>
            {/* ── 3a. Unpaid — action required ─────────────────────────── */}
            {data.unpaid.length > 0 ? (
              <section className="space-y-3" aria-labelledby="unpaid-heading">
                <h2
                  id="unpaid-heading"
                  className="flex items-center gap-2 text-sm font-semibold text-amber-400"
                >
                  <AlertTriangle className="h-4 w-4" aria-hidden /> {t('unpaidHeading')}
                </h2>
                {data.unpaid.map((inv) => (
                  <article
                    key={inv.id}
                    className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4"
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {t(typeKey(inv.invoiceType))}
                        </p>
                        {periodLabel(inv.billingPeriodStart, inv.billingPeriodEnd) ? (
                          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                            {periodLabel(inv.billingPeriodStart, inv.billingPeriodEnd)}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-300">
                        {t('badgeDue')}
                      </span>
                    </div>

                    <ProcessingFeeBreakdown total={inv.total} fee={inv.processingFee} />

                    {inv.partial ? (
                      <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                        <p className="text-xs text-amber-200">
                          {t('partialPaid', {
                            paid: formatCurrency(inv.amountReceived, locale),
                            total: formatCurrency(inv.total, locale),
                          })}
                        </p>
                        <p className="mt-1 text-sm font-bold text-amber-100">
                          {t('remainingToUnlock', { amount: formatCurrency(inv.remaining, locale) })}
                        </p>
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void onPay(inv.id)}
                      disabled={payingId === inv.id}
                      className="btn-press chq-focus mt-4 flex w-full items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-black transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {payingId === inv.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : inv.partial ? (
                        t('payRemaining', { amount: formatCurrency(inv.remaining, locale) })
                      ) : (
                        t('payNow', { amount: formatCurrency(inv.remaining, locale) })
                      )}
                    </button>
                  </article>
                ))}

                {/* Opt-in card saving for automatic renewal (default OFF). */}
                <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
                  <input
                    type="checkbox"
                    checked={saveCard}
                    onChange={(e) => setSaveCard(e.target.checked)}
                    className="chq-focus mt-0.5 h-4 w-4 shrink-0 accent-amber-500"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--color-text-primary)]">
                      {tConsent('title')}
                    </span>
                    <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                      {tConsent('body')}
                    </span>
                  </span>
                </label>

                {payError ? (
                  <p className="text-xs text-red-400" role="alert">
                    {payError}
                  </p>
                ) : null}
              </section>
            ) : (
              <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5 text-center">
                <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-400" aria-hidden />
                <p className="text-sm font-medium text-[var(--color-text-primary)]">
                  {t('allClear')}
                </p>
              </section>
            )}

            {/* ── 3c. Upcoming — forecast (NOT an invoice) ─────────────── */}
            {data.upcoming ? (
              <section aria-labelledby="upcoming-heading">
                <h2
                  id="upcoming-heading"
                  className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]"
                >
                  <Clock className="h-4 w-4" aria-hidden /> {t('upcomingHeading')}
                </h2>
                <div className="rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-1)]/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-[var(--color-text-secondary)]">
                      {t('nextChargeOn', { date: formatDate(data.upcoming.date, locale) })}
                    </span>
                    <span className="tabular-nums text-sm font-semibold text-[var(--color-text-primary)]">
                      {formatCurrency(data.upcoming.amount, locale)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('forecastNote')}</p>
                </div>
              </section>
            ) : null}

            {/* ── 3b. Paid — history ───────────────────────────────────── */}
            {data.paid.length > 0 ? (
              <section aria-labelledby="paid-heading">
                <h2
                  id="paid-heading"
                  className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-secondary)]"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden /> {t('paidHeading')}
                </h2>
                <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)]">
                  {data.paid.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                          {t(typeKey(inv.invoiceType))}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {inv.paidAt ? formatDate(inv.paidAt, locale) : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="tabular-nums text-sm font-semibold text-[var(--color-text-primary)]">
                          {formatCurrency(inv.total, locale)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void onDownload(inv.id)}
                          disabled={downloadingId === inv.id}
                          aria-label={t('receipt')}
                          className="btn-press chq-focus inline-flex items-center rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50"
                        >
                          {downloadingId === inv.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {modal ? (
        <PaymobInvoiceModal
          iframeUrl={modal.iframeUrl}
          sessionId={null}
          invoicePollId={modal.invoiceId}
          statusEndpoint={endpoints.statusEndpoint}
          title={t('payTitle')}
          iframeTitle={t('payTitle')}
          closeLabel={t('close')}
          onClose={() => setModal(null)}
          onSuccess={onPaid}
          onError={() => setModal(null)}
        />
      ) : null}
    </div>
  );
}
