import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Only match locale routes, completely skip / and /login
  matcher: ['/(ar|en)/:path*']
};
