import arMessages from '../../messages/ar.json';
import { generateOrderPdf, type GeneratePdfInput } from '@/lib/generateOrderPdf';
import { uploadOrderPdf } from '@/lib/pdfStorage';
import { notifyAdminOfVendorFailure } from '@/lib/notifyAdminFailure';
import { sendVendorNewOrder } from '@/lib/centerNotify';
import { supabaseAdmin } from '@/lib/supabase-admin';

function interpolate(template: string, vars: Record<string, string | number>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

type VendorNotifyJson = {
  vendorNotify: {
    header: string;
    ref: string;
    qty: string;
    center: string;
    notes: string;
    interactiveCta: string;
    platformFooter: string;
    buttonTitle: string;
    fallbackConfirm: string;
  };
};

function vn(): VendorNotifyJson['vendorNotify'] {
  return (arMessages as VendorNotifyJson).vendorNotify;
}

interface VendorPdfCenter {
  name: string;
  phone: string | null;
  card_color: string | null;
}

interface VendorPdfStudent {
  id: string;
  name: string;
  student_number: string;
  qr_code: string;
}

function buildInteractiveBodyText(
  ref: string,
  quantity: number,
  centerName: string,
  notes: string | null,
): string {
  const x = vn();
  const lines = [
    x.header,
    interpolate(x.ref, { ref }),
    interpolate(x.qty, { quantity }),
    interpolate(x.center, { centerName }),
    notes ? interpolate(x.notes, { notes }) : '',
    '',
    x.interactiveCta,
  ];
  return lines.filter(Boolean).join('\n');
}

function buildFallbackBodyText(
  ref: string,
  quantity: number,
  centerName: string,
  notes: string | null,
  readyToken: string,
): string {
  const x = vn();
  const lines = [
    x.header,
    interpolate(x.ref, { ref }),
    interpolate(x.qty, { quantity }),
    interpolate(x.center, { centerName }),
    notes ? interpolate(x.notes, { notes }) : '',
    '',
    interpolate(x.fallbackConfirm, { readyToken }),
  ];
  return lines.filter(Boolean).join('\n');
}

export async function notifyVendorOfNewOrder(orderId: string): Promise<void> {
  try {
    if (!supabaseAdmin) {
      console.warn('[vendorNotify] Missing Supabase admin');
      return;
    }

    const { data: existing } = await supabaseAdmin
      .from('card_orders')
      .select('vendor_sent_at')
      .eq('id', orderId)
      .maybeSingle();

    if (existing && (existing as { vendor_sent_at?: string | null }).vendor_sent_at) {
      return;
    }

    const { data: order } = await supabaseAdmin
      .from('card_orders')
      .select('id, quantity, notes, centers(name)')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) return;

    const prefix = (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
    const ref = `${prefix}-${String(order.id).substring(0, 8).toUpperCase()}`;
    const readyButtonId = `READY_${ref}`;

    const centerJoin = order.centers as { name?: string | null } | { name?: string | null }[] | null;
    const centerName = Array.isArray(centerJoin)
      ? centerJoin[0]?.name ?? '—'
      : centerJoin?.name ?? '—';

    const notesVal =
      order.notes != null && String(order.notes).trim() !== '' ? String(order.notes) : null;

    const notesForTemplate =
      order.notes != null && String(order.notes).trim() !== '' ? String(order.notes) : 'لا يوجد';

    let skipLegacyVendorMessage = false;
    if (process.env.VENDOR_WHATSAPP_NUMBER?.trim()) {
      try {
        const ok = await sendVendorNewOrder(
          ref,
          Number(order.quantity ?? 0),
          notesForTemplate === 'لا يوجد' ? '' : notesForTemplate,
        );
        if (ok) skipLegacyVendorMessage = true;
      } catch (e) {
        console.error('[vendorNotify] sendVendorNewOrder:', e);
      }
    }

    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, name, whatsapp_number')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!skipLegacyVendorMessage && !vendor?.whatsapp_number) {
      console.warn('[vendorNotify] No active vendor configured');
      return;
    }

    const to = String(
      (vendor?.whatsapp_number ?? process.env.VENDOR_WHATSAPP_NUMBER ?? '') as string,
    ).replace(/[^0-9]/g, '');
    if (!to) {
      console.warn('[vendorNotify] No vendor WhatsApp recipient');
      return;
    }

    const phoneNumberId = process.env.PHONE_NUMBER_ID;
    const waToken = process.env.WHATSAPP_TOKEN;
    if (!phoneNumberId || !waToken) {
      console.warn('[vendorNotify] Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID');
      return;
    }

    const waUrl = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${waToken}`,
      'Content-Type': 'application/json',
    };

    const templateName = process.env.WHATSAPP_VENDOR_TEMPLATE_NAME?.trim();
    const notesTplLegacy =
      order.notes != null && String(order.notes).trim() !== '' ? String(order.notes) : 'لا يوجد';

    let primaryBody: string | null = null;
    if (!skipLegacyVendorMessage) {
      primaryBody = templateName
        ? JSON.stringify({
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
              name: templateName,
              language: { code: 'ar' },
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: ref },
                    { type: 'text', text: String(order.quantity ?? 0) },
                    { type: 'text', text: notesTplLegacy },
                  ],
                },
                {
                  type: 'button',
                  sub_type: 'quick_reply',
                  index: '0',
                  parameters: [{ type: 'payload', payload: readyButtonId }],
                },
              ],
            },
          })
        : (() => {
            const x = vn();
            return JSON.stringify({
              messaging_product: 'whatsapp',
              to,
              type: 'interactive',
              interactive: {
                type: 'button',
                body: {
                  text: buildInteractiveBodyText(ref, Number(order.quantity ?? 0), centerName, notesVal),
                },
                footer: {
                  text: x.platformFooter,
                },
                action: {
                  buttons: [
                    {
                      type: 'reply',
                      reply: {
                        id: readyButtonId,
                        title: x.buttonTitle,
                      },
                    },
                  ],
                },
              },
            });
          })();
    }

    let res: Response | null = null;
    if (primaryBody) {
      res = await fetch(waUrl, { method: 'POST', headers, body: primaryBody });
    }

    if (primaryBody && res && !res.ok) {
      const fallbackText = buildFallbackBodyText(
        ref,
        Number(order.quantity ?? 0),
        centerName,
        notesVal,
        readyButtonId,
      );
      const fallbackRes = await fetch(waUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: fallbackText },
        }),
      });
      if (!fallbackRes.ok) {
        const errText = await fallbackRes.text();
        console.error(
          templateName
            ? '[vendorNotify] Template send + fallback failed:'
            : '[vendorNotify] Both interactive + fallback failed:',
          errText,
        );

        await supabaseAdmin
          .from('card_orders')
          .update({ vendor_notify_failed: true })
          .eq('id', orderId);

        await notifyAdminOfVendorFailure({
          ref,
          quantity: Number(order.quantity ?? 0),
          orderId,
          reason: 'فشل إرسال رسالة واتساب للمورد',
        });

        return;
      }
      console.warn('[vendorNotify] Sent plain text fallback for', ref);
    } else if (primaryBody && res?.ok) {
      console.info(
        templateName
          ? '[vendorNotify] Sent WhatsApp template for'
          : '[vendorNotify] Sent interactive button for',
        ref,
      );
    } else if (skipLegacyVendorMessage) {
      console.info('[vendorNotify] Sent chq_vendor_new_order template for', ref);
    }

    const { data: pdfOrderData } = await supabaseAdmin
      .from('card_orders')
      .select('id, quantity, notes, students, centers(name, phone, card_color)')
      .eq('id', orderId)
      .maybeSingle();

    const pdfCenter = pdfOrderData?.centers as unknown as VendorPdfCenter | null;
    const pdfStudents = (pdfOrderData?.students ?? []) as unknown as VendorPdfStudent[];

    const pdfNow = new Date();
    const pdfMonth = pdfNow.getMonth() + 1;
    const pdfYear = pdfNow.getFullYear();
    const pdfAcademicYear =
      pdfMonth >= 9 ? `${pdfYear}/${pdfYear + 1}` : `${pdfYear - 1}/${pdfYear}`;

    const pdfInput: GeneratePdfInput = {
      ref,
      quantity: pdfOrderData?.quantity ?? 0,
      notes: pdfOrderData?.notes ?? null,
      centerName: pdfCenter?.name ?? '',
      centerPhone: pdfCenter?.phone ?? '',
      cardColor: pdfCenter?.card_color ?? '#0D9488',
      academicYear: pdfAcademicYear,
      students: pdfStudents,
    };

    const pdfBuffer = await generateOrderPdf(pdfInput);

    let vendorNotifyFailed = false;

    if (!pdfBuffer) {
      console.error('[vendorNotify] PDF generation failed');

      vendorNotifyFailed = true;

      await notifyAdminOfVendorFailure({
        ref,
        quantity: pdfOrderData?.quantity ?? 0,
        orderId,
        reason: 'فشل إنشاء ملف PDF',
      });
    } else {
      const signedUrl = await uploadOrderPdf(orderId, pdfBuffer);

      if (!signedUrl) {
        console.error('[vendorNotify] PDF upload failed');
        vendorNotifyFailed = true;
        await notifyAdminOfVendorFailure({
          ref,
          quantity: pdfOrderData?.quantity ?? 0,
          orderId,
          reason: 'فشل رفع ملف PDF',
        });
      } else {
        const docRes = await fetch(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${waToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to,
              type: 'document',
              document: {
                link: signedUrl,
                filename: `CenterHQ-${ref}.pdf`,
                caption: `ملف البطاقات | ${ref}`,
              },
            }),
          },
        );

        if (!docRes.ok) {
          console.error('[vendorNotify] PDF doc send failed:', await docRes.text());
          vendorNotifyFailed = true;
          await notifyAdminOfVendorFailure({
            ref,
            quantity: pdfOrderData?.quantity ?? 0,
            orderId,
            reason: 'وصلت رسالة الطلب — لكن فشل إرسال ملف PDF',
          });
        } else {
          console.info('[vendorNotify] PDF sent successfully for', ref);
        }
      }
    }

    const { error: upErr } = await supabaseAdmin
      .from('card_orders')
      .update({
        vendor_id: vendor?.id ?? null,
        vendor_sent_at: new Date().toISOString(),
        vendor_notify_failed: vendorNotifyFailed,
      })
      .eq('id', orderId);

    if (upErr) {
      console.error('[vendorNotify] Failed to record vendor update:', upErr);
    }

    console.info(`[vendorNotify] Notified vendor for order ${orderId}`);
  } catch (err) {
    console.error('[vendorNotify] Error:', err);
  }
}
