import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const intlMiddleware = createMiddleware(routing);

// Routes that don't require authentication
const publicRoutes = ['/login', '/onboarding', '/suspended', '/auth/callback', '/'];

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
        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('center_id', userRecord.center_id)
          .single();

        // If subscription is suspended and not already on suspended page
        const cleanPath = pathname.replace(/^\/(ar|en)/, '') || '/';
        if (subscription?.status === 'suspended' && !cleanPath.startsWith('/suspended')) {
          const suspendedUrl = new URL('/suspended', request.url);
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
