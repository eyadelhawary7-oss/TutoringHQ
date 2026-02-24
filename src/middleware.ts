import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const intlMiddleware = createMiddleware(routing);

const publicRoutes = ['/login', '/signup', '/onboarding', '/suspended', '/auth/callback', '/accept-invite', '/forgot-password', '/'];
const apiRoutes = ['/auth/callback'];

function isPublicRoute(pathname: string): boolean {
  const cleanPath = pathname.replace(/^\/(ar|en)/, '') || '/';
  return publicRoutes.some(route => cleanPath === route || cleanPath.startsWith(route + '/'));
}

function isApiRoute(pathname: string): boolean {
  return apiRoutes.some(route => pathname.startsWith(route));
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isApiRoute(pathname)) {
    return NextResponse.next();
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/manifest.json')
  ) {
    return NextResponse.next();
  }

  const intlResponse = intlMiddleware(request);

  if (isPublicRoute(pathname)) {
    return intlResponse;
  }

  let supabaseResponse = intlResponse;
  type CookieEntry = { name: string; value: string; options?: Record<string, unknown> };
  let storedCookies: CookieEntry[] = [];

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return intlResponse;
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          storedCookies = cookiesToSet as CookieEntry[];
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, (options ?? {}) as Record<string, unknown>)
          );
        },
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
        const localePrefix = pathname.startsWith('/en') ? '/en' : pathname.startsWith('/ar') ? '/ar' : '';
        const suspendedPath = `${localePrefix || '/en'}/suspended`;
        const isBillingPage = cleanPath === '/settings/billing' || cleanPath.startsWith('/settings/billing');

        if (!cleanPath.startsWith('/suspended')) {
          let shouldRedirect = false;
          let redirectUrl = '';

          if (center?.status === 'suspended') {
            if (!isBillingPage) {
              shouldRedirect = true;
              redirectUrl = `${suspendedPath}?reason=center_suspended`;
            }
          } else {
            const billingStatus = (center as { billing_status?: string })?.billing_status;
            const autoSuspendAt = (center as { auto_suspend_at?: string })?.auto_suspend_at;
            if (autoSuspendAt && billingStatus !== 'paid') {
              const suspendDate = new Date(autoSuspendAt);
              if (new Date() >= suspendDate) {
                if (!isBillingPage) {
                  shouldRedirect = true;
                  redirectUrl = `${suspendedPath}?reason=payment_overdue`;
                }
              }
            }
          }

          if (shouldRedirect && redirectUrl) {
            const redirectResp = NextResponse.redirect(new URL(redirectUrl, request.url));
            storedCookies.forEach(({ name, value, options }) =>
              redirectResp.cookies.set(name, value, options ?? {})
            );
            return redirectResp;
          }
        }

        const { data: subscription } = await supabase
          .from('subscriptions')
          .select('status')
          .eq('center_id', userRecord.center_id)
          .single();

        if (subscription?.status === 'suspended' && !cleanPath.startsWith('/suspended')) {
          const redirectResp = NextResponse.redirect(new URL(suspendedPath, request.url));
          storedCookies.forEach(({ name, value, options }) =>
            redirectResp.cookies.set(name, value, options ?? {})
          );
          return redirectResp;
        }
      }
    }
  } catch {
    // Auth check failed, continue
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
