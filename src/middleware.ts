import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { NextRequest } from 'next/server';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // #region agent log
  console.log('[DEBUG] middleware hit', { pathname, url: request.url, timestamp: Date.now() });
  // #endregion
  return intlMiddleware(request);
}

export const config = {
  // Only match locale routes, completely skip / and /login
  matcher: ['/(ar|en)/:path*']
};
