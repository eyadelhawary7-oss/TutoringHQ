import { describe, it, expect } from 'vitest';
import { getSummerCopy, summerAccent, countdownLabel } from '@/lib/summer/copy';

describe('getSummerCopy — two phases, per-portal CTA, both locales', () => {
  const opts = { floorLabel: 'Aug 30', trialDays: 14 };

  it('phase1 mentions the floor date and "nothing now"', () => {
    const en = getSummerCopy('combined', 'phase1', 'en', opts);
    expect(en.ribbon).toContain('Aug 30');
    expect(en.popupBody.toLowerCase()).toContain('free');
    const ar = getSummerCopy('combined', 'phase1', 'ar', opts);
    expect(ar.ribbon).toContain('Aug 30');
  });

  it('phase2 is the evergreen trial message (mentions the trial length)', () => {
    const en = getSummerCopy('centers', 'phase2', 'en', opts);
    expect(en.ribbon).toContain('14');
    expect(en.ribbon.toLowerCase()).toContain('trial');
  });

  it('teachers CTA says "start your free trial"; centers say "start free"', () => {
    expect(getSummerCopy('teachers', 'phase2', 'en', opts).ribbonCta).toBe('Start your free trial');
    expect(getSummerCopy('centers', 'phase2', 'en', opts).ribbonCta).toBe('Start free');
  });

  it('countdown label reads "billing starts in", never "offer ends"', () => {
    expect(countdownLabel('en').toLowerCase()).toContain('billing starts');
    expect(countdownLabel('en').toLowerCase()).not.toContain('offer ends');
  });

  it('no code chip — copy never references a promo code', () => {
    for (const phase of ['phase1', 'phase2'] as const) {
      for (const loc of ['en', 'ar'] as const) {
        const c = getSummerCopy('combined', phase, loc, opts);
        const blob = `${c.ribbon} ${c.popupBody} ${c.popupTitle}`.toLowerCase();
        expect(blob).not.toContain('code');
        expect(blob).not.toContain('كود');
      }
    }
  });

  it('per-portal accent tokens', () => {
    expect(summerAccent('teachers')).toBe('#8f7322');
    expect(summerAccent('centers')).toBe('#2e5a4c');
    expect(summerAccent('combined')).toBe('#2e5a4c');
  });
});
