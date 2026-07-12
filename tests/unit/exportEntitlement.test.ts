import { describe, it, expect } from 'vitest';
import {
  centerHasExportAccess,
  teacherHasExportAccess,
} from '@/lib/exportEntitlement';

describe('centerHasExportAccess — paid-only during trial', () => {
  it('enrolled + unpaid → gated', () => {
    expect(centerHasExportAccess({ summer_status: 'enrolled', hasEverPaid: false })).toBe(false);
  });

  it('enrolled + paid → access (existing payer swept into free runway is never gated)', () => {
    expect(centerHasExportAccess({ summer_status: 'enrolled', hasEverPaid: true })).toBe(true);
  });

  it('invoiced + unpaid → gated', () => {
    expect(centerHasExportAccess({ summer_status: 'invoiced', hasEverPaid: false })).toBe(false);
  });

  it('invoiced + paid → access', () => {
    expect(centerHasExportAccess({ summer_status: 'invoiced', hasEverPaid: true })).toBe(true);
  });

  it('paid summer_status → access (converted customer)', () => {
    expect(centerHasExportAccess({ summer_status: 'paid', hasEverPaid: false })).toBe(true);
  });

  it('null summer_status → access (normal-billing center, no trial enrollment)', () => {
    expect(centerHasExportAccess({ summer_status: null, hasEverPaid: false })).toBe(true);
  });

  it('undefined summer_status → access', () => {
    expect(centerHasExportAccess({ summer_status: undefined, hasEverPaid: false })).toBe(true);
  });

  it('unknown status → access (only enrolled/invoiced gate)', () => {
    expect(centerHasExportAccess({ summer_status: 'active', hasEverPaid: false })).toBe(true);
  });
});

describe('teacherHasExportAccess — paid-only during trial', () => {
  it('trialing + unpaid → gated', () => {
    expect(teacherHasExportAccess({ subscriptionStatus: 'trialing', hasEverPaid: false })).toBe(false);
  });

  it('trialing + paid → access (existing payer never gated)', () => {
    expect(teacherHasExportAccess({ subscriptionStatus: 'trialing', hasEverPaid: true })).toBe(true);
  });

  it('active → access', () => {
    expect(teacherHasExportAccess({ subscriptionStatus: 'active', hasEverPaid: false })).toBe(true);
  });

  it('null status → access (fail toward access)', () => {
    expect(teacherHasExportAccess({ subscriptionStatus: null, hasEverPaid: false })).toBe(true);
  });

  it('past_due (lapsed but not trialing) → access from this helper', () => {
    // Lapsed teachers are blocked upstream by requireTeacherPrivateAccess; this
    // helper only decides the trial paywall, so a non-trialing status passes here.
    expect(teacherHasExportAccess({ subscriptionStatus: 'past_due', hasEverPaid: false })).toBe(true);
  });
});
