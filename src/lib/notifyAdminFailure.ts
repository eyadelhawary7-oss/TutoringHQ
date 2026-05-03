import { getAdminOrSupportWhatsAppDigits } from '@/lib/supportWhatsApp';

interface AdminFailureOpts {
  ref: string;
  quantity: number;
  orderId: string;
  reason: string;
}

export async function notifyAdminOfVendorFailure(opts: AdminFailureOpts): Promise<void> {
  try {
    const adminTo = getAdminOrSupportWhatsAppDigits();
    if (!adminTo) {
      console.warn(
        '[notifyAdminFailure] Set ADMIN_WHATSAPP_NUMBER or NEXT_PUBLIC_SUPPORT_WHATSAPP to enable admin WhatsApp alerts',
      );
      return;
    }

    const messageBody = [
      '⚠️ تنبيه — CenterHQ',
      '',
      'فشل إرسال طلب الطباعة للمورد تلقائياً',
      `رقم الطلب: ${opts.ref}`,
      `عدد البطاقات: ${opts.quantity}`,
      `السبب: ${opts.reason}`,
      '',
      '⚡ يرجى التواصل مع المورد يدوياً وإرسال ملف البطاقات',
    ].join('\n');

    const res = await fetch(
      `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: adminTo,
          type: 'text',
          text: { body: messageBody },
        }),
      },
    );

    if (!res.ok) {
      console.error('[notifyAdminFailure] Failed:', res.status, await res.text());
    }
  } catch (err) {
    console.error('[notifyAdminFailure] Unexpected error:', err);
    // Never throw
  }
}
