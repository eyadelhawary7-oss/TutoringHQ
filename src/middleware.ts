import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const intlMiddleware = createMiddleware(routing);

// Routes that don't require authentication
const publicRoutes = ['/login', '/signup', '/onboarding', '/suspended', '/auth/callback', '/accept-invite', '/forgot-password', '/'];

// Routes that should not have locale prefix handling  
const apiRoutes = ['/auth/callback'];

function isPublicRoute(pathname: string): boolean {
  // Strip locale prefix if present
  const cleanPath = pathname.replace(/^\/(ar|en)/, '') || '/';
  return publicRoutes.some(route => cleanPath === route || cleanPath.startsWith(route + '/'));
}

function isApiRoute(pathname: string): boolean {
  return apiRoutes.some(route => pathname.startsWith(route));
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes from intl middleware
  if (isApiRoute(pathname)) {
    return NextResponse.next();
  }

  // Skip static assets and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/manifest.json')
  ) {
    return NextResponse.next();
  }

  // Run intl middleware first for locale handling
  const intlResponse = intlMiddleware(request);

  // For public routes, just return intl response
  if (isPublicRoute(pathname)) {
    return intlResponse;
  }

  // For protected routes, check auth via cookie
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return intlResponse;
    }

    // Get auth token from cookies
    const accessToken = request.cookies.get('sb-access-token')?.value
      || request.cookies.get(`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`)?.value;

    // If no auth cookie found, let the page handle auth check client-side
    // This avoids blocking server-side rendering while still allowing client-side auth
    if (!accessToken) {
      return intlResponse;
    }

    // Check subscription status for authenticated routes
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: userRecord } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .single();

      if (userRecord?.center_id) {
        const { data: center } = await supabase
          .from('centers')
          .select('status, billing_status, auto_suspend_at')
          .eq('id', userRecord.center_id)
          .single();

        const cleanPath = pathname.replace(/^\/(ar|en)/, '') || '/';
        const localePrefix = pathname.startsWith('/en') ? '/en' : '';
        const suspendedPath = `${localePrefix}/suspended`;
        /** Allow suspended users to access billing page to submit payment proof */
        const isBillingPage = cleanPath === '/settings/billing' || cleanPath.startsWith('/settings/billing');

        if (!cleanPath.startsWith('/suspended')) {
          if (center?.status === 'suspended') {
            if (!isBillingPage) {
              const suspendedUrl = new URL(suspendedPath, request.url);
              suspendedUrl.searchParams.set('reason', 'center_suspended');
              return NextResponse.redirect(suspendedUrl);
            }
          } else {
            const billingStatus = (center as { billing_status?: string })?.billing_status;
            const autoSuspendAt = (center as { auto_suspend_at?: string })?.auto_suspend_at;
            if (autoSuspendAt && billingStatus !== 'paid') {
              const suspendDate = new Date(autoSuspendAt);
              if (new Date() >= suspendDate) {
                if (!isBillingPage) {
                  const suspendedUrl = new URL(suspendedPath, request.url);
                  suspendedUrl.searchParams.set('reason', 'payment_overdue');
                  return NextResponse.redirect(suspendedUrl);
                }
              }
            }
          }
        }

        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('center_id', userRecord.center_id)
          .single();

        if (subscription?.status === 'suspended' && !cleanPath.startsWith('/suspended')) {
          const suspendedUrl = new URL(suspendedPath, request.url);
          return NextResponse.redirect(suspendedUrl);
        }
      }
    }
  } catch {
    // If any auth check fails, continue normally
  }

  return intlResponse;
}

export const config = {
  // Match all routes except API, Next.js internals, and static files
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
