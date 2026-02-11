import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all pathnames except:
  // - API routes, Next.js internals, static files
  // - Root path (/) and /login (public pages without i18n)
  matcher: [
    '/(ar|en)/:path*',
    '/((?!_next|_vercel|api|login|.*\\..*).*)'
  ]
};
