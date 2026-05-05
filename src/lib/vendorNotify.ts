import { generateOrderPdf, type GeneratePdfInput } from '@/lib/generateOrderPdf';
import { uploadOrderPdf } from '@/lib/pdfStorage';
import { notifyAdminOfVendorFailure } from '@/lib/notifyAdminFailure';
import { isTemplateApproved, sendVendorNewOrder } from '@/lib/centerNotify';
import { supabaseAdmin } from '@/lib/supabase-admin';

/** Same template as sendVendorNewOrder — used to gate follow-up document send. */
const VENDOR_ORDER_TEMPLATE = 'chq_vendor_new_order';

const WHATSAPP_META_TEST_PHONE_NUMBER_ID = '1013787185158313';

function waPhoneNumberId(): string | null {
  return process.env.PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || null;
}

function shouldSkipWaForTestPhoneId(): boolean {
  const phoneId = waPhoneNumberId();
  return !phoneId || phoneId === WHATSAPP_META_TEST_PHONE_NUMBER_ID;
}

async function waSendingEnabled(): Promise<boolean> {
  if (!supabaseAdmin) return false;
  const { data: cfg } = await supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'wa_sending_enabled')
    .maybeSingle();
  return cfg?.value !== false;
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
      .select('id, quantity, notes, card_style')
      .eq('id', orderId)
      .maybeSingle();

    if (!order) return;

    const prefix = (process.env.BOSTA_BUSINESS_PREFIX ?? 'CHQ').replace(/[^A-Za-z0-9]/g, '') || 'CHQ';
    const ref = `${prefix}-${String(order.id).substring(0, 8).toUpperCase()}`;

    const notesForTemplate =
      order.notes != null && String(order.notes).trim() !== '' ? String(order.notes) : 'لا يوجد';

    if (process.env.VENDOR_WHATSAPP_NUMBER?.trim()) {
      try {
        const ok = await sendVendorNewOrder(
          ref,
          Number(order.quantity ?? 0),
          notesForTemplate === 'لا يوجد' ? '' : notesForTemplate,
        );
        if (ok) {
          console.info('[vendorNotify] Sent chq_vendor_new_order template for', ref);
        }
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

    const { data: pdfOrderData } = await supabaseAdmin
      .from('card_orders')
      .select('id, quantity, notes, students, card_style, centers(name, phone, card_color)')
      .eq('id', orderId)
      .maybeSingle();

    const pdfCenter = pdfOrderData?.centers as unknown as VendorPdfCenter | null;
    const pdfStudents = (pdfOrderData?.students ?? []) as unknown as VendorPdfStudent[];

    const pdfCardStyle: 'dark' | 'light' =
      (pdfOrderData as { card_style?: string | null } | null)?.card_style === 'light'
        ? 'light'
        : 'dark';

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
      cardStyle: pdfCardStyle,
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
        if (!(await isTemplateApproved(VENDOR_ORDER_TEMPLATE, supabaseAdmin))) {
          console.warn('[vendorNotify] Skipping PDF WA — vendor order template not approved');
          vendorNotifyFailed = true;
        } else if (!(await waSendingEnabled())) {
          console.warn('[vendorNotify] Skipping PDF WA — wa_sending_enabled is off');
          vendorNotifyFailed = true;
        } else if (shouldSkipWaForTestPhoneId()) {
          console.warn('[vendorNotify] Skipping PDF WA — Meta test phone ID');
          vendorNotifyFailed = true;
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
