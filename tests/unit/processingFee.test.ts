import { describe, it, expect } from 'vitest';
import {
  applyProcessingFee,
  resolveProcessingFeeAmount,
  vatInsideInclusive,
  buildRedesignedInvoiceLines,
  buildCombinedInvoiceLines,
  processingFeeInfoBodyAr,
  PROCESSING_FEE_DEFAULTS,
} from '@/lib/processingFee';

describe('resolveProcessingFeeAmount', () => {
  it('returns the amount when enabled', () => {
    expect(resolveProcessingFeeAmount({ enabled: true, amount: 20 })).toBe(20);
    expect(resolveProcessingFeeAmount({ enabled: true, amount: 9 })).toBe(9);
  });
  it('returns 0 when disabled', () => {
    expect(resolveProcessingFeeAmount({ enabled: false, amount: 20 })).toBe(0);
  });
  it('returns 0 for non-positive / invalid amounts', () => {
    expect(resolveProcessingFeeAmount({ enabled: true, amount: 0 })).toBe(0);
    expect(resolveProcessingFeeAmount({ enabled: true, amount: -5 })).toBe(0);
    expect(resolveProcessingFeeAmount({ enabled: true, amount: NaN })).toBe(0);
  });
  it('defaults are enabled @ 20', () => {
    expect(PROCESSING_FEE_DEFAULTS).toEqual({ enabled: true, amount: 20 });
  });
});

describe('applyProcessingFee', () => {
  it('adds the fee on top of a VAT-inclusive subscription', () => {
    expect(applyProcessingFee(999, { enabled: true, amount: 20 })).toEqual({
      subscription: 999,
      fee: 20,
      total: 1019,
    });
  });
  it('charges only the subscription when the fee is disabled', () => {
    expect(applyProcessingFee(999, { enabled: false, amount: 20 })).toEqual({
      subscription: 999,
      fee: 0,
      total: 999,
    });
  });
  it('handles an editable amount (e.g. back to 9)', () => {
    expect(applyProcessingFee(499, { enabled: true, amount: 9 })).toEqual({
      subscription: 499,
      fee: 9,
      total: 508,
    });
  });
  it('rounds to two decimals', () => {
    const r = applyProcessingFee(99.999, { enabled: true, amount: 20 });
    expect(r.subscription).toBe(100);
    expect(r.total).toBe(120);
  });
});

describe('vatInsideInclusive', () => {
  it('extracts 14% VAT already inside a VAT-inclusive amount', () => {
    // 499 inclusive → net 437.72, vat 61.28 (matches teacher plan snapshot).
    expect(vatInsideInclusive(499)).toBe(61.28);
  });
  it('returns 0 for non-positive', () => {
    expect(vatInsideInclusive(0)).toBe(0);
    expect(vatInsideInclusive(-10)).toBe(0);
  });
});

describe('buildRedesignedInvoiceLines', () => {
  it('produces the legal Arabic order: subscription, fee, total, VAT-included last', () => {
    const lines = buildRedesignedInvoiceLines({ total: 1019, fee: 20, locale: 'ar' });
    expect(lines.map((l) => l.key)).toEqual([
      'subscription',
      'processing_fee',
      'total',
      'vat_included',
    ]);
    expect(lines[0]).toMatchObject({ amount: 999, label: 'قيمة الاشتراك' });
    expect(lines[1]).toMatchObject({ amount: 20, label: 'رسوم المعالجة', hasInfo: true });
    expect(lines[2]).toMatchObject({ amount: 1019, label: 'الإجمالي', isTotal: true });
    expect(lines[3]).toMatchObject({ label: 'ضريبة القيمة المضافة (مشمولة)', isVatNote: true });
  });

  it('VAT line is informational and does not change the total', () => {
    const lines = buildRedesignedInvoiceLines({ total: 1019, fee: 20 });
    const total = lines.find((l) => l.key === 'total')!;
    const vat = lines.find((l) => l.key === 'vat_included')!;
    expect(total.amount).toBe(1019);
    expect(vat.isVatNote).toBe(true);
    // VAT is a slice already inside the total, not an addition.
    expect(vat.amount).toBeLessThan(total.amount);
  });

  it('omits the processing-fee line when the fee is 0 (toggle off)', () => {
    const lines = buildRedesignedInvoiceLines({ total: 999, fee: 0, locale: 'ar' });
    expect(lines.map((l) => l.key)).toEqual(['subscription', 'total', 'vat_included']);
    expect(lines[0].amount).toBe(999);
    expect(lines[1].amount).toBe(999);
  });
});

describe('buildCombinedInvoiceLines — late-fee invoice math', () => {
  // CRITICAL money rule: late fee = percentage × SUBSCRIPTION only. The flat
  // processing fee is a separate line, never inside the base the % is taken on.
  const SUBSCRIPTION = 10000;
  const LATE_RATE = 0.05;
  const lateFee = Math.round(SUBSCRIPTION * LATE_RATE * 100) / 100; // 500, NOT 5% of (sub + 20)
  const PROCESSING_FEE = 20;
  const total = Math.round((SUBSCRIPTION + lateFee + PROCESSING_FEE) * 100) / 100; // 10520

  it('late fee is 5% of the subscription, not of (subscription + processing fee)', () => {
    expect(lateFee).toBe(500);
    // Guard: 5% of (subscription + fee) would be 501 — the fee must be excluded.
    expect(lateFee).not.toBe(Math.round((SUBSCRIPTION + PROCESSING_FEE) * LATE_RATE * 100) / 100);
  });

  it('total = subscription + (rate × subscription) + 20 flat', () => {
    expect(total).toBe(10520);
  });

  it('emits subscription → late fee → processing fee → total → VAT(included) in order', () => {
    const lines = buildCombinedInvoiceLines({
      charges: [
        { key: 'subscription', label: 'قيمة الاشتراك', amount: SUBSCRIPTION },
        { key: 'late_fee', label: 'غرامة التأخر في السداد', amount: lateFee },
      ],
      fee: PROCESSING_FEE,
      total,
      locale: 'ar',
    });
    expect(lines.map((l) => l.key)).toEqual([
      'subscription',
      'late_fee',
      'processing_fee',
      'total',
      'vat_included',
    ]);
    expect(lines[0].amount).toBe(10000);
    expect(lines[1].amount).toBe(500);
    expect(lines[2]).toMatchObject({ amount: 20, hasInfo: true });
    expect(lines[3]).toMatchObject({ amount: 10520, isTotal: true });
  });

  it('VAT is shown as included in the total, never added on top', () => {
    const lines = buildCombinedInvoiceLines({
      charges: [
        { key: 'subscription', label: 'قيمة الاشتراك', amount: SUBSCRIPTION },
        { key: 'late_fee', label: 'غرامة التأخر في السداد', amount: lateFee },
      ],
      fee: PROCESSING_FEE,
      total,
      locale: 'ar',
    });
    const totalLine = lines.find((l) => l.isTotal)!;
    const vat = lines.find((l) => l.isVatNote)!;
    expect(totalLine.amount).toBe(10520);
    expect(vat.isVatNote).toBe(true);
    expect(vat.amount).toBe(vatInsideInclusive(10520)); // 14% slice already inside
    expect(vat.amount).toBeLessThan(totalLine.amount); // not an addition
    // Sum of the charge lines + fee equals the total; VAT is not part of that sum.
    const charged = lines
      .filter((l) => !l.isTotal && !l.isVatNote)
      .reduce((s, l) => s + l.amount, 0);
    expect(Math.round(charged * 100) / 100).toBe(totalLine.amount);
  });

  it('drops the processing-fee line when the fee is 0 (toggle off)', () => {
    const lines = buildCombinedInvoiceLines({
      charges: [
        { key: 'subscription', label: 'قيمة الاشتراك', amount: SUBSCRIPTION },
        { key: 'late_fee', label: 'غرامة التأخر في السداد', amount: lateFee },
      ],
      fee: 0,
      total: SUBSCRIPTION + lateFee,
      locale: 'ar',
    });
    expect(lines.map((l) => l.key)).toEqual(['subscription', 'late_fee', 'total', 'vat_included']);
    expect(lines.find((l) => l.isTotal)!.amount).toBe(10500);
  });
});

describe('buildCombinedInvoiceLines — reactivation invoice', () => {
  it('reactivation fee → processing fee (ⓘ) → total → VAT(included)', () => {
    const lines = buildCombinedInvoiceLines({
      charges: [{ key: 'reactivation_fee', label: 'رسوم إعادة التفعيل', amount: 1000 }],
      fee: 20,
      total: 1020,
      locale: 'ar',
    });
    expect(lines.map((l) => l.key)).toEqual([
      'reactivation_fee',
      'processing_fee',
      'total',
      'vat_included',
    ]);
    expect(lines.find((l) => l.isTotal)!.amount).toBe(1020);
  });

  it('defaults total to sum(charges) + fee when not provided', () => {
    const lines = buildCombinedInvoiceLines({
      charges: [{ key: 'reactivation_fee', label: 'x', amount: 1000 }],
      fee: 20,
    });
    expect(lines.find((l) => l.isTotal)!.amount).toBe(1020);
  });
});

describe('processingFeeInfoBodyAr', () => {
  it('interpolates the live fee amount', () => {
    expect(processingFeeInfoBodyAr(20)).toContain('20 جنيهًا');
    expect(processingFeeInfoBodyAr(9)).toContain('9 جنيهًا');
  });
  it('falls back to 20 for invalid input', () => {
    expect(processingFeeInfoBodyAr(0)).toContain('20 جنيهًا');
  });
});
