import { describe, it, expect } from 'vitest';
import { buildIdempotencyKey, buildRequestFingerprint } from '@/lib/savedCard/idempotency';
import { CENTER_OWNER, TEACHER_OWNER } from './savedCardFakes';

describe('saved-card idempotency key', () => {
  it('is deterministic for the same owner+invoice+period', () => {
    const a = buildIdempotencyKey({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07' });
    const b = buildIdempotencyKey({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07' });
    expect(a).toBe(b);
  });

  it('differs by owner, invoice, and period', () => {
    const base = buildIdempotencyKey({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07' });
    expect(base).not.toBe(buildIdempotencyKey({ owner: TEACHER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07' }));
    expect(base).not.toBe(buildIdempotencyKey({ owner: CENTER_OWNER, invoiceId: 'inv-2', billingPeriod: '2026-07' }));
    expect(base).not.toBe(buildIdempotencyKey({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-08' }));
  });
});

describe('saved-card request fingerprint', () => {
  it('treats 100 and 100.00 as the same charge body', () => {
    const a = buildRequestFingerprint({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07', amount: 100, currency: 'EGP' });
    const b = buildRequestFingerprint({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07', amount: 100.0, currency: 'EGP' });
    expect(a).toBe(b);
  });

  it('changes when the amount changes', () => {
    const a = buildRequestFingerprint({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07', amount: 100, currency: 'EGP' });
    const b = buildRequestFingerprint({ owner: CENTER_OWNER, invoiceId: 'inv-1', billingPeriod: '2026-07', amount: 150, currency: 'EGP' });
    expect(a).not.toBe(b);
  });
});
