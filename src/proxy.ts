import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const intlMiddleware = createMiddleware(routing);

// --- Rate limiting: in-memory Map (Edge-compatible, per-instance) ---
const LOGIN_RATE_LIMIT = 5;
const LOGIN_WINDOW_MS = 900 * 1000; // 900 seconds

type RateLimitEntry = { count: number; firstAttempt: number };

const loginAttempts = new Map<string, RateLimitEntry>();

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, retryAfter: 900 };
  }

  const windowEnd = entry.firstAttempt + LOGIN_WINDOW_MS;
  if (now >= windowEnd) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return { allowed: true, retryAfter: 900 };
  }

  if (entry.count >= LOGIN_RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((windowEnd - now) / 1000) };
  }

  entry.count += 1;
  return { allowed: true, retryAfter: 900 };
}

// --- Security headers (applied to all responses) ---
const SECURITY_HEADERS: [string, string][] = [
  [
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel.app https://*.vercel.app https://*.sentry.io https://*.ingest.sentry.io",
      "frame-src 'self' https://*.supabase.co https://accept.paymob.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  ],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
];

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

// --- Route helpers ---
const publicRoutes = ['/login', '/signup', '/onboarding', '/suspended', '/auth/callback', '/accept-invite', '/forgot-password', '/'];
const apiRoutes = ['/auth/callback'];

function isPublicRoute(pathname: string): boolean {
  const cleanPath = pathname.replace(/^\/(ar|en)/, '') || '/';
  return publicRoutes.some(route => cleanPath === route || cleanPath.startsWith(route + '/'));
}

function isApiRoute(pathname: string): boolean {
  return apiRoutes.some(route => pathname.startsWith(route));
}

export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Rate limit POST /api/login
  if (pathname === '/api/login' && request.method === 'POST') {
    const ip = getClientIp(request);
    const { allowed, retryAfter } = checkLoginRateLimit(ip);
    if (!allowed) {
      const res = NextResponse.json(
        { error: 'too_many_attempts', retry_after: retryAfter },
        { status: 429 }
      );
      res.headers.set('Retry-After', String(retryAfter));
      return applySecurityHeaders(res);
    }
  }

  if (isApiRoute(pathname)) {
    const res = NextResponse.next();
    return applySecurityHeaders(res);
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/manifest.json')
  ) {
    const res = NextResponse.next();
    return applySecurityHeaders(res);
  }

  const intlResponse = intlMiddleware(request);

  if (isPublicRoute(pathname)) {
    return applySecurityHeaders(intlResponse);
  }

  let supabaseResponse = intlResponse;
  type CookieEntry = { name: string; value: string; options?: Record<string, unknown> };
  let storedCookies: CookieEntry[] = [];

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return applySecurityHeaders(intlResponse);
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
            return applySecurityHeaders(redirectResp);
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
          return applySecurityHeaders(redirectResp);
        }
      }
    }
  } catch {
    // Auth check failed, continue
  }

  return applySecurityHeaders(supabaseResponse);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
