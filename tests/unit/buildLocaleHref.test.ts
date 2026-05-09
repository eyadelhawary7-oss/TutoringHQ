import { describe, expect, it } from 'vitest';
import { buildLocaleHref } from '@/lib/locale/buildLocaleHref';

describe('buildLocaleHref', () => {
  it('prefixes dashboard from en login', () => {
    expect(buildLocaleHref('/dashboard', 'en')).toBe('/en/dashboard');
  });
  it('does not double locale for already-prefixed path', () => {
    expect(buildLocaleHref('/en/dashboard', 'en')).toBe('/en/dashboard');
  });
  it('rewrites ar login target', () => {
    expect(buildLocaleHref('/dashboard', 'ar')).toBe('/ar/dashboard');
  });
  it('maps root from en', () => {
    expect(buildLocaleHref('/', 'en')).toBe('/en');
  });
});
