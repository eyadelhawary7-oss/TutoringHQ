import { describe, expect, it } from 'vitest';
import { buildInvoiceTaxSnapshot, vatInsideInclusive } from '@/lib/processingFee';
import { buildInvoiceHtml, type InvoiceTemplateData } from '@/lib/invoiceTemplates';
import { paymentConfirmationAmountStr } from '@/lib/invoicePaymobPayment';

// The invoice tax-snapshot change: generateInvoicePdf used to SELECT invoices.subtotal
// and invoices.tax_amount — columns that never existed — so every PDF failed. VAT was
// recomputed at render from a hardcoded rate and discarded. We now snapshot vat_amount,
// vat_rate and processing_fee on the invoice at issue time and read them back, so an
// invoice always reprints the exact VAT it was charged at the rate then in force.

function makeInvoice(
  overrides: Partial<InvoiceTemplateData['invoice']> = {},
): InvoiceTemplateData {
  return {
    invoice: {
      id: 'inv-1',
      invoice_number: 'INV-TEST-2026-07',
      invoice_type: 'subscription',
      total_amount: 1020,
      discount_amount: 0,
      billing_period_start: '2026-07-01',
      billing_period_end: '2026-08-01',
      due_date: '2026-07-01',
      status: 'pending',
      notes: null,
      created_at: '2026-07-01T09:00:00.000Z',
      base_amount: 1000,
      ...overrides,
    },
    center: {
      id: 'ctr-1',
      name: 'سنتر الاختبار',
      center_code: 'TEST01',
      phone: '+201000000000',
      plan: 'starter',
      referral_code: 'ABCD',
      city: 'القاهرة',
      subscription_billing_period: 'monthly',
    },
  };
}

describe('buildInvoiceTaxSnapshot — VAT derived from a VAT-inclusive total', () => {
  it('splits VAT out of the inclusive total (fee treated as VAT-inclusive)', () => {
    // 1000 subscription + 20 fee = 1020 inclusive → VAT = 1020 × 0.14 / 1.14 = 125.26.
    const snap = buildInvoiceTaxSnapshot({ total: 1020, fee: 20 });
    expect(snap.vat_amount).toBeCloseTo(125.26, 2);
    expect(snap.vat_amount).toBeCloseTo(vatInsideInclusive(1020), 2);
    expect(snap.vat_rate).toBe(0.14);
    expect(snap.processing_fee).toBe(20);
  });

  it('matches the canonical worked example (999 + 20 fee → VAT inside 1019)', () => {
    const snap = buildInvoiceTaxSnapshot({ total: 1019, fee: 20 });
    expect(snap.vat_amount).toBeCloseTo(125.14, 2);
  });

  it('vatBasis narrows the taxed amount (announcement: fee is NOT VAT-bearing)', () => {
    // total 1020 = 1000 balance + 20 fee, but VAT is on the balance only.
    const snap = buildInvoiceTaxSnapshot({ total: 1020, fee: 20, vatBasis: 1000 });
    expect(snap.vat_amount).toBeCloseTo(vatInsideInclusive(1000), 2); // 122.81
    expect(snap.vat_amount).not.toBeCloseTo(125.26, 2);
    expect(snap.processing_fee).toBe(20);
  });

  it('stores the rate passed in, so a rate change is captured per-invoice', () => {
    const snap = buildInvoiceTaxSnapshot({ total: 1150, fee: 0, vatRate: 0.15 });
    expect(snap.vat_rate).toBe(0.15);
    expect(snap.vat_amount).toBeCloseTo(150, 2); // 1150 × 0.15 / 1.15
  });

  it('no fee → processing_fee 0; non-positive total → vat 0', () => {
    expect(buildInvoiceTaxSnapshot({ total: 500 }).processing_fee).toBe(0);
    expect(buildInvoiceTaxSnapshot({ total: 0, fee: 20 }).vat_amount).toBe(0);
  });
});

describe('buildInvoiceHtml — reads the stored snapshot (no subtotal/tax_amount)', () => {
  it('renders WITHOUT throwing and without any subtotal/tax_amount fields present', () => {
    const html = buildInvoiceHtml(makeInvoice({ vat_amount: 125.26, vat_rate: 0.14, processing_fee: 20 }));
    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    // The processing fee appears on the invoice.
    expect(html).toContain('رسوم المعالجة');
    expect(html).toContain('20.00');
  });

  it('an OLD invoice reprints its STORED VAT, not a recomputed figure (rate-change safe)', () => {
    // Simulate a VAT rate change: this old invoice was raised at 15% and stored a
    // distinctive VAT that does NOT equal 0.14 × decomposition of its total. The PDF
    // must print the stored value, proving it does not recalculate at the live rate.
    const storedVat = 137.77;
    const html = buildInvoiceHtml(
      makeInvoice({ total_amount: 1020, processing_fee: 20, vat_amount: storedVat, vat_rate: 0.15 }),
    );
    expect(html).toContain('137.77'); // the stored VAT is what prints
    expect(html).not.toContain('125.26'); // NOT the 14% recomputation of 1020
  });

  it('drives the "(N%)" rate label from the stored rate for announcement invoices', () => {
    const html = buildInvoiceHtml(
      makeInvoice({
        invoice_type: 'announcement_settlement',
        total_amount: 1020,
        base_amount: 1000,
        processing_fee: 20,
        vat_amount: 116, // distinctive stored VAT
        vat_rate: 0.15,
      }),
    );
    expect(html).toContain('(15%)'); // rate label from stored vat_rate, not hardcoded 14%
    expect(html).toContain('116.00'); // stored VAT amount
  });

  it('legacy invoice (no stored snapshot) still renders by recomputing at 14%', () => {
    const html = buildInvoiceHtml(
      makeInvoice({ total_amount: 1020, processing_fee: null, vat_amount: null, vat_rate: null }),
    );
    expect(typeof html).toBe('string');
    // vatInsideInclusive(1020) = 125.26 recomputed at the default rate.
    expect(html).toContain('125.26');
  });
});

describe('payment confirmation reports the full charge (fee included)', () => {
  it('uses the invoice total (base + processing fee), not the fee-exclusive subscription', () => {
    const base = 1000;
    const snap = buildInvoiceTaxSnapshot({ total: base + 20, fee: 20 });
    const invoiceTotal = base + snap.processing_fee; // = 1020
    // The confirmation string is the fee-inclusive total, i.e. 20 EGP more than base.
    expect(paymentConfirmationAmountStr(invoiceTotal)).toBe('1020');
    expect(paymentConfirmationAmountStr(invoiceTotal)).not.toBe(String(base));
  });

  it('coerces junk to 0 and rounds to 2dp', () => {
    expect(paymentConfirmationAmountStr(null)).toBe('0');
    expect(paymentConfirmationAmountStr('1020.5')).toBe('1020.5');
  });
});
