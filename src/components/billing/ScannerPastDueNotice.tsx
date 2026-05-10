'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useUser } from '@/contexts/UserContext';
import { isSubscriptionPastDueBanner } from '@/lib/subscriptionPastDue';

export function ScannerPastDueNotice() {
  const t = useTranslations('billing.sub.pastDue');
  const { user } = useUser();

  const show = useMemo(() => {
    if (!user?.center_id || user.role === 'super_admin') return false;
    const center = user.center as Record<string, unknown> | undefined | null;
    if (!center) return false;
    return isSubscriptionPastDueBanner({
      status: center.status as string | undefined,
      subscription_status: center.subscription_status as string | undefined,
      billing_status: center.billing_status as string | undefined,
      next_payment_due: center.next_payment_due as string | undefined,
    });
  }, [user]);

  if (!show) return null;

  return (
    <div
      role="status"
      className="mx-4 mb-2 rounded-xl border border-red-600/50 bg-red-950/40 px-3 py-2 text-sm text-red-100 sm:mx-0"
    >
      {t('scannerNotice')}
    </div>
  );
}
