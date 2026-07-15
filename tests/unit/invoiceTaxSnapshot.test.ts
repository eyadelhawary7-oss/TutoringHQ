import { describe, expect, it } from 'vitest';
import { buildInvoiceTaxSnapshot, vatInsideInclusive } from '@/lib/processingFee';
import { buildInvoiceHtml, type InvoiceTemplateData } from '@/lib/invoiceTemplates';
import { paymentConfirmationAmountStr } from '@/lib/invoicePaymobPayment';

// Invoice tax-snapshot: generateInvoicePdf used to SELECT invoices.subtotal and
// invoices.tax_amount — columns that never existed — so every PDF failed. VAT was
// recomputed at render from a hardcoded rate and discarded. We now snapshot
// vat_amount, vat_rate and processing_fee at issue time and read them back.
//
// VAT basis is UNIFORM: the processing fee is VAT-bearing, so VAT is the slice of
// the full VAT-inclusive amount for every type (announcements + cards included).
// The only carve-out is card shipping — a courier pass-through outside the VAT base.

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

describe('buildInvoiceTaxSnapshot — VAT on the full VAT-inclusive total', () => {
  it('splits VAT out of the inclusive total (fee is VAT-inclusive)', () => {
    // 1000 subscription + 20 fee = 1020 inclusive → VAT = 1020 × 0.14 / 1.14 = 125.26.
    const snap = buildInvoiceTaxSnapshot({ total: 1020, fee: 20 });
    expect(snap.vat_amount).toBeCloseTo(125.26, 2);
    expect(snap.vat_amount).toBeCloseTo(vatInsideInclusive(1020), 2);
    expect(snap.vat_rate).toBe(0.14);
    expect(snap.processing_fee).toBe(20);
  });

  it('announcements now tax the full total including the fee (no vatBasis carve-out)', () => {
    // Uniform basis: VAT on the whole 1020, not on the 1000 balance.
    const snap = buildInvoiceTaxSnapshot({ total: 1020, fee: 20 });
    expect(snap.vat_amount).toBeCloseTo(vatInsideInclusive(1020), 2); // 125.26, NOT 122.81
    expect(snap.vat_amount).not.toBeCloseTo(vatInsideInclusive(1000), 2);
  });

  it('card orders now tax the full total including delivery (no carve-out)', () => {
    // total 435 = product 300 + delivery 115 + fee 20 → VAT on the whole 435.
    const snap = buildInvoiceTaxSnapshot({ total: 435, fee: 20 });
    expect(snap.vat_amount).toBeCloseTo(vatInsideInclusive(435), 2); // 53.42
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
  it('subscription renders without throwing and shows the fee + stored VAT', () => {
    const html = buildInvoiceHtml(makeInvoice({ vat_amount: 125.26, vat_rate: 0.14, processing_fee: 20 }));
    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('رسوم المعالجة'); // fee shown
    expect(html).toContain('125.26'); // stored VAT
    expect(html).toContain('1,020.00'); // total
  });

  it('an OLD invoice reprints its STORED VAT, not a recomputed figure (rate-change safe)', () => {
    const html = buildInvoiceHtml(
      makeInvoice({ total_amount: 1020, processing_fee: 20, vat_amount: 137.77, vat_rate: 0.15 }),
    );
    expect(html).toContain('137.77'); // stored VAT prints
    expect(html).not.toContain('125.26'); // NOT the 14% recomputation of 1020
  });

  it('the existing invoice stays at 125.26 (subscription, total 1020)', () => {
    const html = buildInvoiceHtml(
      makeInvoice({ total_amount: 1020, processing_fee: 20, vat_amount: 125.26, vat_rate: 0.14 }),
    );
    expect(html).toContain('125.26');
    expect(html).toContain('1,020.00');
  });

  it('announcement now shows VAT on the full total (fee taxed), total unchanged', () => {
    // Uniform: stored VAT = vatInsideInclusive(1020) = 125.26 (was 122.81 on the balance).
    const html = buildInvoiceHtml(
      makeInvoice({
        invoice_type: 'announcement_settlement',
        total_amount: 1020,
        base_amount: 1000,
        processing_fee: 20,
        vat_amount: 125.26,
        vat_rate: 0.14,
      }),
    );
    expect(html).toContain('125.26'); // VAT on full total, fee included
    expect(html).not.toContain('122.81'); // NOT the old balance-only VAT
    expect(html).toContain('1,020.00'); // total unchanged
    expect(html).toContain('رسوم المعالجة'); // fee still visible
  });

  it('announcement reads the STORED VAT verbatim (rate-change safe)', () => {
    const html = buildInvoiceHtml(
      makeInvoice({
        invoice_type: 'announcement_cap',
        total_amount: 1020,
        base_amount: 1000,
        processing_fee: 20,
        vat_amount: 130.5,
        vat_rate: 0.15,
      }),
    );
    expect(html).toContain('130.50'); // stored VAT prints regardless of live rate
    expect(html).toContain('1,020.00'); // total unchanged
  });

  it('card order taxes the full total incl. delivery; total unchanged, no carve-out', () => {
    const html = buildInvoiceHtml(
      makeInvoice({
        invoice_type: 'setup_fee',
        total_amount: 435,
        base_amount: 263.16,
        processing_fee: 20,
        vat_amount: 53.42, // vatInsideInclusive(435)
        vat_rate: 0.14,
        metadata: { shipping_fee: 115, qty: 5, processing_fee: 20 },
      }),
    );
    expect(html).toContain('53.42'); // VAT on the FULL total (product + fee + delivery)
    expect(html).toContain('115.00'); // delivery still shown as a line
    expect(html).toContain('رسوم المعالجة'); // fee shown
    expect(html).toContain('435.00'); // total unchanged
    expect(html).not.toContain('الشحن غير خاضع'); // delivery no longer carved out
  });

  it('late fees are left unchanged: VAT via the generic path (total − fee)', () => {
    // With no processing fee (the only way late-fee invoices are raised today),
    // total − fee == total, so VAT already falls on the full amount.
    const html = buildInvoiceHtml(
      makeInvoice({
        invoice_type: 'late_payment_fee',
        total_amount: 500,
        base_amount: 500,
        processing_fee: null,
        vat_amount: null,
        vat_rate: null,
        metadata: { late_fee_rate: 0.05 },
      }),
    );
    expect(typeof html).toBe('string');
    expect(html).toContain(vatInsideInclusive(500).toFixed(2)); // 61.40
    expect(html).toContain('500.00');
  });

  it('legacy invoice (no stored snapshot) still renders by recomputing at 14%', () => {
    const html = buildInvoiceHtml(
      makeInvoice({ total_amount: 1020, processing_fee: null, vat_amount: null, vat_rate: null }),
    );
    expect(typeof html).toBe('string');
    expect(html).toContain('125.26');
  });
});

describe('payment confirmation reports the full charge (fee included)', () => {
  it('uses the invoice total (base + processing fee), not the fee-exclusive subscription', () => {
    const base = 1000;
    const snap = buildInvoiceTaxSnapshot({ total: base + 20, fee: 20 });
    const invoiceTotal = base + snap.processing_fee; // = 1020
    expect(paymentConfirmationAmountStr(invoiceTotal)).toBe('1020');
    expect(paymentConfirmationAmountStr(invoiceTotal)).not.toBe(String(base));
  });

  it('coerces junk to 0 and rounds to 2dp', () => {
    expect(paymentConfirmationAmountStr(null)).toBe('0');
    expect(paymentConfirmationAmountStr('1020.5')).toBe('1020.5');
  });
});
