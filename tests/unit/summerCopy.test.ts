import { describe, it, expect } from 'vitest';
import {
  getSummerCopy,
  summerAccent,
  countdownLabel,
  summerRibbonGradient,
  summerCtaColors,
  summerChipLabel,
  summerOfferTag,
  summerPopupFooter,
} from '@/lib/summer/copy';

describe('getSummerCopy — two phases, per-portal CTA, both locales', () => {
  const opts = { floorLabel: 'Aug 30', trialDays: 14 };

  it('phase1 carries the exact mock headlines per portal', () => {
    expect(getSummerCopy('combined', 'phase1', 'en', opts).ribbon).toBe(
      'Free all summer for centers and teachers',
    );
    expect(getSummerCopy('centers', 'phase1', 'en', opts).ribbon).toBe(
      'Run your center free all summer',
    );
    expect(getSummerCopy('teachers', 'phase1', 'en', opts).ribbon).toBe('Start free all summer');
    expect(getSummerCopy('combined', 'phase1', 'en', opts).popupTitle).toBe('Free all summer');
    expect(getSummerCopy('centers', 'phase1', 'en', opts).popupTitle).toBe(
      'Your center, free all summer',
    );
    expect(getSummerCopy('teachers', 'phase1', 'en', opts).popupTitle).toBe(
      'Your groups, free all summer',
    );
  });

  it('phase1 sub + body carry the floor date in both locales', () => {
    const en = getSummerCopy('combined', 'phase1', 'en', opts);
    expect(en.ribbonSub).toContain('Aug 30');
    expect(en.popupBody).toContain('Aug 30');
    const ar = getSummerCopy('combined', 'phase1', 'ar', opts);
    expect(ar.ribbonSub).toContain('Aug 30');
    expect(ar.popupBody).toContain('Aug 30');
  });

  it('customer-facing copy uses TutoringHQ, never the internal "CenterHQ"', () => {
    for (const portal of ['combined', 'centers', 'teachers'] as const) {
      for (const loc of ['en', 'ar'] as const) {
        const c = getSummerCopy(portal, 'phase1', loc, opts);
        const blob = `${c.ribbon} ${c.ribbonSub} ${c.popupTitle} ${c.popupBody} ${c.ribbonCta} ${c.popupCta}`;
        expect(blob).not.toContain('CenterHQ');
      }
    }
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

  it('per-portal accent tokens', () => {
    expect(summerAccent('teachers')).toBe('#8f7322');
    expect(summerAccent('centers')).toBe('#2e5a4c');
    expect(summerAccent('combined')).toBe('#2e5a4c');
  });

  it('ribbon gradient uses full-strength literal hex per portal (matches the mock)', () => {
    expect(summerRibbonGradient('combined')).toBe('linear-gradient(160deg, #2e5a4c, #244a3e)');
    expect(summerRibbonGradient('centers')).toBe('linear-gradient(160deg, #2e5a4c, #244a3e)');
    expect(summerRibbonGradient('teachers')).toBe('linear-gradient(160deg, #8f7322, #7a6019)');
  });

  it('cream CTA: cream background, dark in-brand text per portal', () => {
    expect(summerCtaColors('centers')).toEqual({ bg: '#fbf9f4', text: '#244a3e' });
    expect(summerCtaColors('combined')).toEqual({ bg: '#fbf9f4', text: '#244a3e' });
    expect(summerCtaColors('teachers')).toEqual({ bg: '#fbf9f4', text: '#7a6019' });
  });

  it('chip + popup helpers exist in both locales (chip is display-only marketing)', () => {
    expect(summerChipLabel('en')).toBe('Code');
    expect(summerChipLabel('ar')).toBe('الكود');
    expect(summerOfferTag('en').toLowerCase()).toContain('summer');
    expect(summerPopupFooter('en', 'Aug 30')).toContain('Aug 30');
    expect(summerPopupFooter('ar', 'Aug 30').toLowerCase()).not.toContain('offer ends');
  });
});
