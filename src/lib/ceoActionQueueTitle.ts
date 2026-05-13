/**
 * CEO action queue titles are stored in English in `ceo_action_queue`.
 * Map known titles/patterns to next-intl keys under `founderDash.actionQueueTitles`.
 */
export function localizeCeoActionQueueTitle(
  title: string,
  locale: string,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (locale !== 'ar' || !title.trim()) return title;

  const msg = (key: string, values?: Record<string, string | number>) =>
    t(`actionQueueTitles.${key}`, values);

  switch (title) {
    case 'CEO Briefing WA delivery failed':
      return msg('ceoBriefingWaFailed');
    case 'Payment retry failed':
      return msg('paymentRetryFailed');
    case 'Cron job missed':
      return msg('cronJobMissed');
    case 'Signup paid but intake paused':
      return msg('signupPaidIntakePaused');
    case 'Signup payment received, manual approval required':
      return msg('signupManualApproval');
    case 'Center paid but intake paused':
      return msg('centerPaidIntakePaused');
    default:
      break;
  }

  let m = /^Stuck payment session, (.+)$/.exec(title);
  if (m) return msg('stuckPaymentSession', { centerId: m[1]! });

  m = /^Cancellation request: (.+)$/.exec(title);
  if (m) return msg('cancellationRequest', { name: m[1]! });

  m = /^Bosta LOST: card order (.+)$/.exec(title);
  if (m) return msg('bostaLost', { orderId: m[1]! });

  m = /^Bosta RETURNED: card order (.+)$/.exec(title);
  if (m) return msg('bostaReturned', { orderId: m[1]! });

  m = /^Pack billing skipped, (.+)$/.exec(title);
  if (m) return msg('packBillingSkipped', { centerName: m[1]! });

  m = /^⚠️ (\d+) active centers with no billing amount$/.exec(title);
  if (m) return msg('zeroBillingCenters', { count: Number(m[1]) });

  m = /^Cannot auto-approve: invalid pricing for plan (.+)$/.exec(title);
  if (m) return msg('invalidPricing', { plan: m[1]! });

  m = /^Cannot auto-approve: invalid billing amount for plan (.+)$/.exec(title);
  if (m) return msg('invalidBillingAmount', { plan: m[1]! });

  m = /^Auto-approve blocked: auth error (.+)$/.exec(title);
  if (m) return msg('autoApproveAuthBlocked', { detail: m[1]! });

  m = /^Signup auto-approved \(Paymob\): (.+)$/.exec(title);
  if (m) return msg('signupAutoApproved', { centerName: m[1]! });

  m = /^1 center auto-approved: (.+)$/.exec(title);
  if (m) return msg('oneCenterAutoApproved', { centerName: m[1]! });

  return title;
}
