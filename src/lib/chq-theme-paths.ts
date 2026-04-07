/**
 * Locale-stripped paths where users may opt into light theme via localStorage.
 * All other routes force dark (dashboard, admin, authenticated app).
 */
const THEME_PUBLIC_EXACT = new Set([
  '/',
  '/login',
  '/signup',
  '/forgot-password',
  '/suspended',
  '/offline',
  '/session-expired',
  '/status',
  '/onboarding',
  '/auth/callback',
]);

export function stripLocaleFromPathname(pathname: string): string {
  return pathname.replace(/^\/(ar|en)(\/|$)/, '$2') || '/';
}

export function isChqThemePublicPath(pathname: string): boolean {
  const clean = stripLocaleFromPathname(pathname);
  if (THEME_PUBLIC_EXACT.has(clean)) return true;
  if (clean.startsWith('/refer/')) return true;
  return false;
}
