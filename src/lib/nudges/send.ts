// Center-agnostic WhatsApp template sender for nudges. Unlike
// whatsapp/client.sendTemplateMessage it does NOT log to wa_message_queue (whose
// center_id is NOT NULL and so cannot hold teacher sends) — the nudge result is
// recorded in the billing_nudges ledger instead. Throws on failure so the
// process-outbox handler routes it through the existing retry → dead-letter path.

function waPhoneNumberId(): string | null {
  return (
    process.env.PHONE_NUMBER_ID ||
    process.env.WHATSAPP_PHONE_ID ||
    process.env.WHATSAPP_PHONE_NUMBER_ID ||
    null
  );
}

function waToken(): string | null {
  return process.env.WHATSAPP_TOKEN || null;
}

/** E.164-ish digits for Meta: strip '+', convert leading 0 + 10 digits to 20…. */
export function normalizeWaDigits(phone: string): string {
  return phone.trim().replace(/^\+/, '').replace(/^0(\d{10})$/, '20$1');
}

/**
 * Send a nudge template to a raw phone. Throws on any failure (missing config,
 * non-2xx, network) so the caller's dead-letter handling engages.
 */
export async function sendNudgeWhatsapp(opts: {
  toPhone: string;
  templateName: string;
  params: string[];
  languageCode?: 'ar' | 'ar_EG';
}): Promise<{ wabaMessageId: string | null }> {
  const phoneId = waPhoneNumberId();
  const token = waToken();
  if (!phoneId || !token) {
    throw new Error('whatsapp_not_configured');
  }
  const to = normalizeWaDigits(opts.toPhone);
  if (!to) throw new Error('invalid_phone');

  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: opts.templateName,
        language: { code: opts.languageCode ?? 'ar' },
        components: [
          {
            type: 'body',
            parameters: opts.params.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`whatsapp_send_failed_${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
  return { wabaMessageId: json?.messages?.[0]?.id ?? null };
}
