export interface InvoiceData {
  id: string;
  invoice_number: string | null;
  invoice_type: string;
  total_amount: string | number;
  subtotal: string | number | null;
  tax_amount: string | number | null;
  discount_amount: string | number | null;
  billing_period_start: string;
  billing_period_end: string;
  due_date: string;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface CenterData {
  id: string;
  name: string;
  center_code: string;
  phone: string | null;
  plan: string | null;
  referral_code?: string | null;
}

export const INVOICE_TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  subscription: { ar: 'فاتورة اشتراك', en: 'Subscription Invoice' },
  base_subscription: { ar: 'اشتراك أساسي', en: 'Base Subscription' },
  signup_first_payment: { ar: 'أول دفعة تسجيل', en: 'First Payment' },
  pack_billing: { ar: 'فوترة باقة الواتساب', en: 'WhatsApp Pack Billing' },
  announcement_settlement: { ar: 'تسوية الإعلانات', en: 'Announcement Settlement' },
  announcement_cap: { ar: 'تجاوز حد الإعلانات', en: 'Announcement Cap' },
  plan_upgrade_difference: { ar: 'فرق ترقية الخطة', en: 'Plan Upgrade Difference' },
  setup_fee: { ar: 'رسوم الإعداد', en: 'Setup Fee' },
  late_payment_fee: { ar: 'رسوم التأخر في السداد', en: 'Late Payment Fee' },
  referral_payout: { ar: 'إيصال صرف عمولة إحالة', en: 'Referral Payout Receipt' },
  payment_proof: { ar: 'إثبات دفع', en: 'Payment Proof' },
  whatsapp_addon: { ar: 'إضافة واتساب', en: 'WhatsApp Add-on' },
};
