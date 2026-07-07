import { buildLegalInvoiceLines, type LegalInvoiceLine } from '@/lib/pricing/taxMath';
import { formatNumber } from '@/lib/formatNumber';

const TEAL = '#0D9488';
const NAVY = '#0f172a';
const MUTED = '#94a3b8';
const BORDER = '#ebebeb';
const GRAY_BG = '#f8fafc';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtEgp(n: number): string {
  return formatNumber(n, 'ar', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' ج.م';
}

export interface CardOrderReceiptLineItem {
  title: string;
  subtitle?: string;
  qty: number;
}

export interface CardOrderReceiptModel {
  shortOrderRef: string;
  createdAtLabel: string;
  centreName: string | null;
  centreAddress: string | null;
  deliveryGovernorate: string;
  deliveryAddress: string;
  deliveryPhone: string;
  notes: string;
  lineItems: CardOrderReceiptLineItem[];
  productInclusive: number;
  /** Flat processing fee added to the order (0 when none). */
  processingFee: number;
  shippingFee: number;
  grandTotal: number;
  paymobTransactionId: string | null;
  refundStatus: string | null;
  refundPaidAtLabel: string | null;
  refundAmount: number | null;
  taxRegistration: string | null;
  logoUrl: string | null;
}

function linesTable(lines: LegalInvoiceLine[]): string {
  const rows = lines
    .map((ln) => {
      const bold = ln.isTotal ? 'font-weight:800;color:' + TEAL + ';' : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid ${BORDER};font-family:Cairo,sans-serif;${bold}">${esc(ln.label)}</td>
        <td style="padding:8px;border-bottom:1px solid ${BORDER};text-align:left;direction:ltr;font-variant-numeric:tabular-nums;${bold}">${esc(fmtEgp(ln.amount))}</td>
      </tr>`;
    })
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px;" dir="rtl">${rows}</table>`;
}

function itemsTable(items: CardOrderReceiptLineItem[]): string {
  const rows = items
    .map((it) => {
      const sub = it.subtitle ? `<div style="font-size:11px;color:${MUTED};margin-top:4px;">${esc(it.subtitle)}</div>` : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid ${BORDER};font-family:Cairo,sans-serif;">
          <div style="font-weight:700;">${esc(it.title)}</div>
          ${sub}
        </td>
        <td style="padding:8px;border-bottom:1px solid ${BORDER};text-align:center;">${esc(String(it.qty))}</td>
      </tr>`;
    })
    .join('');
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px;" dir="rtl">
    <thead><tr style="background:${GRAY_BG};">
      <th style="padding:8px;text-align:right;font-family:Cairo,sans-serif;">البند</th>
      <th style="padding:8px;text-align:center;font-family:Cairo,sans-serif;">الكمية</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/** Inner HTML body fragment (RTL) consumed by `wrapDocument` in generateInvoicePdf. */
export function buildCardOrderReceiptInnerHtml(model: CardOrderReceiptModel): string {
  const legal = buildLegalInvoiceLines(model.productInclusive, 'ar');
  const logo = model.logoUrl
    ? `<img src="${esc(model.logoUrl)}" alt="TutoringHQ" style="height:40px;margin-bottom:12px;display:block;" />`
    : `<div style="font-family:'Bodoni Moda',serif;font-size:22px;font-weight:600;color:${NAVY};">Tutoring<span style="color:${TEAL};font-style:italic;">HQ</span></div>`;

  const refundBlock =
    model.refundStatus != null && model.refundStatus !== ''
      ? `<div style="margin-top:14px;padding:12px;border:1px solid ${BORDER};border-radius:10px;background:${GRAY_BG};font-size:12px;font-family:Cairo,sans-serif;">
          <div style="font-weight:700;margin-bottom:6px;">استرداد</div>
          <div style="color:${MUTED};">الحالة: ${esc(model.refundStatus)}</div>
          ${model.refundPaidAtLabel ? `<div style="color:${MUTED};margin-top:4px;">تاريخ الصرف: ${esc(model.refundPaidAtLabel)}</div>` : ''}
          ${model.refundAmount != null ? `<div style="margin-top:6px;font-weight:700;">المبلغ: ${esc(fmtEgp(model.refundAmount))}</div>` : ''}
        </div>`
      : '';

  const paymob =
    model.paymobTransactionId?.trim() ?
      `<div style="margin-top:12px;font-size:12px;color:${MUTED};font-family:Cairo,sans-serif;">معرف معاملة Paymob: <span dir="ltr">${esc(model.paymobTransactionId.trim())}</span></div>`
    : '';

  const taxLine = model.taxRegistration?.trim()
    ? `<div style="margin-top:10px;font-size:11px;color:${MUTED};">الرقم الضريبي: ${esc(model.taxRegistration.trim())}</div>`
    : '';

  return `<div style="flex:1;padding:14mm 12mm;font-family:Cairo,sans-serif;direction:rtl;text-align:right;">
    ${logo}
    <div style="font-size:20px;font-weight:800;color:${TEAL};margin-bottom:4px;">إيصال دفع</div>
    <div style="font-size:11px;color:${MUTED};margin-bottom:12px;">طلب رقم ${esc(model.shortOrderRef)} · ${esc(model.createdAtLabel)}</div>

    <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:${NAVY};">بيانات المركز</div>
    <div style="font-size:13px;margin-bottom:10px;line-height:1.5;">
      ${model.centreName?.trim() ? `<div>${esc(model.centreName.trim())}</div>` : ''}
      ${model.centreAddress?.trim() ? `<div style="color:${MUTED};margin-top:4px;">${esc(model.centreAddress.trim())}</div>` : ''}
    </div>

    <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:${NAVY};">عنوان التسليم (عند الطلب)</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:13px;">
      <tr><td style="padding:6px 0;color:${MUTED};width:34%;">المحافظة</td><td style="padding:6px 0;">${esc(model.deliveryGovernorate)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};vertical-align:top;">العنوان</td><td style="padding:6px 0;white-space:pre-wrap;">${esc(model.deliveryAddress)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};">الهاتف</td><td style="padding:6px 0;direction:ltr;text-align:right;">${esc(model.deliveryPhone)}</td></tr>
      <tr><td style="padding:6px 0;color:${MUTED};vertical-align:top;">ملاحظات</td><td style="padding:6px 0;white-space:pre-wrap;">${model.notes.trim() ? esc(model.notes.trim()) : ','}</td></tr>
    </table>

    <div style="font-size:12px;font-weight:700;margin-bottom:6px;color:${NAVY};">البنود</div>
    ${itemsTable(model.lineItems)}

    <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:${NAVY};">تفاصيل الأسعار (ضريبة أخيرة)</div>
    ${linesTable(legal.slice(0, 4))}
    ${
      model.processingFee > 0
        ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:10px;border:1px solid ${BORDER};margin-top:10px;background:${GRAY_BG};font-family:Cairo,sans-serif;">
      <span>رسوم المعالجة</span><span dir="ltr">${esc(fmtEgp(model.processingFee))}</span>
    </div>`
        : ''
    }
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:10px;border:1px solid ${BORDER};margin-top:10px;background:${GRAY_BG};font-family:Cairo,sans-serif;">
      <span>الشحن</span><span dir="ltr">${esc(fmtEgp(model.shippingFee))}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-radius:12px;background:${GRAY_BG};border:1px solid ${BORDER};margin-top:10px;">
      <span style="font-weight:800;font-size:15px;font-family:Cairo,sans-serif;">الإجمالي المدفوع</span>
      <span style="font-weight:800;font-size:18px;color:${TEAL};direction:ltr;">${esc(fmtEgp(model.grandTotal))}</span>
    </div>

    ${paymob}
    ${refundBlock}
    ${taxLine}
  </div>`;
}
