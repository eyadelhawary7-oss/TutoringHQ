/**
 * Build a locale-prefixed path without doubling segments like `/en/en/dashboard`.
 */
export function buildLocaleHref(target: string, currentLocale: 'en' | 'ar'): string {
  const stripped = target.replace(/^\/(en|ar)(?=\/|$)/, '') || '/';
  return `/${currentLocale}${stripped === '/' ? '' : stripped}`;
}
