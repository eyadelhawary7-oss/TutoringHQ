import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { NextRequest } from 'next/server';

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Exclude landing page and login from i18n routing
  if (pathname === '/' || pathname.startsWith('/login')) {
    return;
  }

  // Apply i18n middleware to all other routes
  return intlMiddleware(request);
}

export const config = {
  // Match all pathnames except API routes, Next.js internals, and static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
