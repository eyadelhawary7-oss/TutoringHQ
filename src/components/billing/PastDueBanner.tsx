'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useUser } from '@/contexts/UserContext';
import { formatDate } from '@/lib/formatNumber';
import { isSubscriptionPastDueBanner, autoSuspendDateYmd } from '@/lib/subscriptionPastDue';
import { supabase } from '@/lib/supabase';
import { FEATURES } from '@/lib/features';
import { PaymobInvoiceModal } from '@/components/billing/PaymobInvoiceModal';
import { useToast } from '@/hooks/useToast';

const DISMISS_KEY = 'chq_past_due_banner_dismissed';

export function PastDueBanner() {
  const t = useTranslations('billing.sub.pastDue');
  const locale = useLocale();
  const { user, refreshUser } = useUser();
  const toast = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [paymobUrl, setPaymobUrl] = useState<string | null>(null);
  const [paymobSessionId, setPaymobSessionId] = useState<string | null>(null);
  const [pollInvoiceId, setPollInvoiceId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1') {
        setDismissed(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const center = user?.center as Record<string, unknown> | undefined | null;

  const show = useMemo(() => {
    if (!user?.center_id || user.role === 'super_admin') return false;
    if (!center) return false;
    return isSubscriptionPastDueBanner({
      status: center.status as string | undefined,
      subscription_status: center.subscription_status as string | undefined,
      billing_status: center.billing_status as string | undefined,
      next_payment_due: center.next_payment_due as string | undefined,
    });
  }, [user, center]);

  const graceEndYmd = autoSuspendDateYmd(center?.auto_suspend_at as string | undefined);
  const graceLabel =
    graceEndYmd != null ? formatDate(`${graceEndYmd}T12:00:00`, locale, 'long') : '';

  const ownerOk = user?.role === 'owner' || user?.role === 'super_admin';

  const handleDismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  const handlePayNow = useCallback(async () => {
    if (!ownerOk || !FEATURES.PAYMOB_ENABLED) {
      if (!FEATURES.PAYMOB_ENABLED) toast.info(t('payDisabled'));
      return;
    }
    setPaying(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Unauthorized');

      const invRes = await fetch('/api/billing/next-pay-invoice', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const invJ = (await invRes.json()) as { invoiceId?: string | null };
      const invoiceId = typeof invJ.invoiceId === 'string' ? invJ.invoiceId : null;
      if (!invoiceId) {
        toast.error(t('noOpenInvoice'));
        return;
      }

      const res = await fetch(`/api/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json()) as { iframeUrl?: string; orderId?: string; error?: string };
      if (!res.ok) {
        toast.error(typeof j.error === 'string' ? j.error : t('payFailed'));
        return;
      }
      const iframeUrl = j.iframeUrl;
      const orderId = typeof j.orderId === 'string' ? j.orderId : '';
      if (iframeUrl) {
        setPaymobUrl(iframeUrl);
        setPaymobSessionId(orderId || null);
        setPollInvoiceId(orderId ? null : invoiceId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('payFailed'));
    } finally {
      setPaying(false);
    }
  }, [ownerOk, toast, t]);

  if (!show || dismissed) return null;

  return (
    <>
      <div
        role="alert"
        className="shrink-0 border-b border-red-700/40 bg-red-600 px-4 py-3 text-white shadow-md"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium leading-snug">
            {graceLabel
              ? t('bannerWithDate', { date: graceLabel })
              : t('bannerNoDate')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {ownerOk ? (
              <button
                type="button"
                onClick={() => void handlePayNow()}
                disabled={paying}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {paying ? t('paying') : t('payNow')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleDismiss}
              className="rounded-lg border border-white/40 px-3 py-1.5 text-sm font-medium hover:bg-white/10"
            >
              {t('dismiss')}
            </button>
          </div>
        </div>
      </div>
      {paymobUrl ? (
        <PaymobInvoiceModal
          iframeUrl={paymobUrl}
          sessionId={paymobSessionId}
          invoicePollId={pollInvoiceId}
          title={t('modalTitle')}
          iframeTitle={t('modalIframeTitle')}
          closeLabel={t('modalClose')}
          onClose={() => {
            setPaymobUrl(null);
            setPaymobSessionId(null);
            setPollInvoiceId(null);
          }}
          onSuccess={() => {
            setPaymobUrl(null);
            setPaymobSessionId(null);
            setPollInvoiceId(null);
            void refreshUser();
            toast.success(t('paySuccess'));
          }}
          onError={() => {
            setPaymobUrl(null);
            setPaymobSessionId(null);
            setPollInvoiceId(null);
            toast.error(t('payFailed'));
          }}
        />
      ) : null}
    </>
  );
}
