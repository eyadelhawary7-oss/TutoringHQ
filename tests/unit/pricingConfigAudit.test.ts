/**
 * Regression for FIX 2 (pricing-config audit log records old + new values).
 *
 * The prior audit shape `{ changed_keys: [...] }` recorded key names only.
 * A destructive pricing change (e.g. a super_admin zeroing every multiplier)
 * left no recoverable trail. The new shape records before/after per key so
 * the change is reversible from the audit row.
 */
import { describe, it, expect } from 'vitest';
import { buildPricingConfigAuditDetails } from '@/lib/pricingConfigAudit';

describe('buildPricingConfigAuditDetails (FIX 2)', () => {
  it('records old + new value for each changed key (existing prior row)', () => {
    const updates = [
      { key: 'pricing.interval.monthly_multiplier', value: 1.1 },
      { key: 'pricing.interval.annual_multiplier', value: 0.9 },
    ];
    const priorByKey = new Map<string, unknown>([
      ['pricing.interval.monthly_multiplier', 1.2],
      ['pricing.interval.annual_multiplier', 0.8],
    ]);
    const details = buildPricingConfigAuditDetails(updates, priorByKey, 'pricing-page');
    expect(details).toEqual({
      changes: [
        { key: 'pricing.interval.monthly_multiplier', old: 1.2, new: 1.1 },
        { key: 'pricing.interval.annual_multiplier', old: 0.8, new: 0.9 },
      ],
      save_source: 'pricing-page',
    });
  });

  it('records old=null when there is no prior row for a key (first write)', () => {
    const updates = [{ key: 'pricing.banner.text_en', value: 'Spring sale!' }];
    const details = buildPricingConfigAuditDetails(updates, new Map(), 'unknown');
    expect(details.changes).toEqual([
      { key: 'pricing.banner.text_en', old: null, new: 'Spring sale!' },
    ]);
  });

  it('records old=null when the prior row had value=null (preserves shape)', () => {
    const updates = [{ key: 'pricing.shipping.default_cost', value: 60 }];
    const priorByKey = new Map<string, unknown>([['pricing.shipping.default_cost', null]]);
    const details = buildPricingConfigAuditDetails(updates, priorByKey, 'pricing-page');
    expect(details.changes).toEqual([
      { key: 'pricing.shipping.default_cost', old: null, new: 60 },
    ]);
  });

  it('records the destructive-change shape recoverably (zero all multipliers)', () => {
    // The exact scenario the audit gap blocked: super_admin zeros revenue
    // multipliers. With FIX 2, the audit row carries the prior values so
    // the change is reversible.
    const updates = [
      { key: 'pricing.interval.monthly_multiplier', value: 0 },
      { key: 'pricing.interval.annual_multiplier', value: 0 },
      { key: 'pack_price_per_parent', value: 0 },
      { key: 'qr_card_price', value: 0 },
    ];
    const priorByKey = new Map<string, unknown>([
      ['pricing.interval.monthly_multiplier', 1.2],
      ['pricing.interval.annual_multiplier', 0.85],
      ['pack_price_per_parent', 50],
      ['qr_card_price', 62],
    ]);
    const details = buildPricingConfigAuditDetails(updates, priorByKey, 'pricing-page');
    expect(details.changes).toHaveLength(4);
    for (const change of details.changes) {
      expect(change.new).toBe(0);
      expect(change.old).not.toBe(0);
      expect(change.old).not.toBeNull();
    }
    expect(details.save_source).toBe('pricing-page');
  });

  it('carries save_source verbatim (so unknown / pricing-page / future sources are distinguishable)', () => {
    expect(
      buildPricingConfigAuditDetails([{ key: 'k', value: 1 }], new Map(), 'unknown')
        .save_source,
    ).toBe('unknown');
    expect(
      buildPricingConfigAuditDetails([{ key: 'k', value: 1 }], new Map(), 'pricing-page')
        .save_source,
    ).toBe('pricing-page');
  });
});
