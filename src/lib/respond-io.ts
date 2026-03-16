export interface OnboardingPayload {
  phone: string;
  ownerName: string;
  centerName: string;
  plan: string;
  referralCode: string;
  loginUrl: string;
}

export async function fireOnboardingWebhook(payload: OnboardingPayload): Promise<void> {
  const webhookUrl = process.env.RESPOND_IO_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[Respond.io] RESPOND_IO_WEBHOOK_URL not set — skipping');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        timestamp: new Date().toISOString(),
        source: 'centerhq-admin-approval',
      }),
    });

    if (!response.ok) {
      console.error('[Respond.io] Webhook failed:', response.status, await response.text());
    } else {
      console.log('[Respond.io] Onboarding webhook fired for:', payload.phone);
    }
  } catch (err) {
    console.error('[Respond.io] Webhook error:', err);
  }
}
