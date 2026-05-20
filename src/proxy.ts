import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const intlMiddleware = createMiddleware(routing);

/** Strip one leading locale segment for path checks. */
function stripLocalePrefix(pathname: string): string {
  return pathname.replace(/^\/(ar|en)(\/|$)/, '/') || '/';
}

const ALLOWED_API_ORIGINS = new Set([
  'https://centerhq.app',
  'https://www.centerhq.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

/** Public POST webhooks (server-to-server; Origin often absent). */
const PUBLIC_WEBHOOK_PREFIXES = [
  '/api/paymob/webhook',
  '/api/bosta/webhook',
  '/api/whatsapp/webhook',
  '/api/whatsapp/inbound',
];

function isPublicWebhookPath(pathname: string): boolean {
  return PUBLIC_WEBHOOK_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAllowedCorsOrigin(origin: string | null): boolean {
  if (origin == null || origin === '') return true;
  return ALLOWED_API_ORIGINS.has(origin.trim());
}

// --- Security headers (applied to all responses) ---
const SECURITY_HEADERS: [string, string][] = [
  [
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://us-assets.i.posthog.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https: https://us-assets.i.posthog.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel.app https://*.vercel.app https://*.sentry.io https://*.ingest.sentry.io https://us.i.posthog.com https://us-assets.i.posthog.com https://accept.paymob.com",
      "frame-src 'self' https://*.supabase.co https://accept.paymob.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  ],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-XSS-Protection', '1; mode=block'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

function applySecurityHeaders(response: NextResponse, requestId: string): NextResponse {
  response.headers.set('X-Request-ID', requestId);
  for (const [key, value] of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

// --- Route helpers ---
const publicRoutes = ['/login', '/signup', '/onboarding', '/suspended', '/auth/callback', '/accept-invite', '/forgot-password', '/status', '/pricing', '/demo-request', '/privacy', '/terms', '/session-expired', '/'];
const apiRoutes = ['/auth/callback'];

function isPublicRoute(pathname: string): boolean {
  const cleanPath = stripLocalePrefix(pathname);
  return publicRoutes.some(route => cleanPath === route || cleanPath.startsWith(route + '/'));
}

/** Logged-in-only app areas (same protection as dashboard pages like /students, /payments). */
const AUTHENTICATED_ROUTE_PREFIXES = [
  '/dashboard',
  '/students',
  '/payments',
  '/settings',
  '/scan',
  '/groups',
  '/schedule',
  '/attendance',
  '/rooms',
  '/academic',
  '/branches',
  '/referrals',
  '/analytics',
  '/benchmarks',
  '/ceo',
  '/ceo-dashboard',
  '/messages',
  '/offline',
  '/orders',
  '/notifications',
  '/whatsapp-pack',
  '/whatsapp',
  '/admin',
];

function pathRequiresAuthentication(cleanPath: string): boolean {
  return AUTHENTICATED_ROUTE_PREFIXES.some(
    (prefix) => cleanPath === prefix || cleanPath.startsWith(`${prefix}/`)
  );
}

function isApiRoute(pathname: string): boolean {
  return apiRoutes.some(route => pathname.startsWith(route));
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export default async function proxy(request: NextRequest) {
  const requestId = newRequestId();
  const { pathname } = request.nextUrl;

  const blockedPaths = ['/.env', '/wp-admin', '/phpinfo', '/.git', '/admin.php'];
  if (blockedPaths.some((p) => pathname.startsWith(p))) {
    return applySecurityHeaders(new NextResponse('Not Found', { status: 404 }), requestId);
  }

  if (pathname.startsWith('/api')) {
    const method = request.method;
    const origin = request.headers.get('origin');
    if (method === 'OPTIONS') {
      if (!isAllowedCorsOrigin(origin)) {
        return applySecurityHeaders(new NextResponse(null, { status: 403 }), requestId);
      }
    } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && origin && !isAllowedCorsOrigin(origin)) {
      if (!isPublicWebhookPath(pathname)) {
        return applySecurityHeaders(NextResponse.json({ error: 'Forbidden' }, { status: 403 }), requestId);
      }
    }
  }

  // Paymob card-order webhook — public; Paymob calls with no user session.
  if (pathname === '/api/paymob/webhook') {
    return applySecurityHeaders(NextResponse.next(), requestId);
  }

  if (pathname === '/api/bosta/webhook') {
    return applySecurityHeaders(NextResponse.next(), requestId);
  }

  if (isApiRoute(pathname)) {
    const res = NextResponse.next();
    return applySecurityHeaders(res, requestId);
  }

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') ||
    pathname.startsWith('/sw.js') ||
    pathname.startsWith('/manifest.json')
  ) {
    const res = NextResponse.next();
    return applySecurityHeaders(res, requestId);
  }

  const intlResponse = intlMiddleware(request);

  if (isPublicRoute(pathname)) {
    return applySecurityHeaders(intlResponse, requestId);
  }

  const supabaseResponse = intlResponse;
  type CookieEntry = { name: string; value: string; options?: Record<string, unknown> };
  let storedCookies: CookieEntry[] = [];

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      return applySecurityHeaders(intlResponse, requestId);
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

    const cleanPathForAuth = stripLocalePrefix(pathname);
    if (!user && pathRequiresAuthentication(cleanPathForAuth) && !isPublicRoute(pathname)) {
      const localeSeg = pathname.startsWith('/ar') ? '/ar' : '/en';
      const loginUrl = new URL(`${localeSeg}/login`, request.url);
      const redirectResp = NextResponse.redirect(loginUrl);
      storedCookies.forEach(({ name, value, options }) =>
        redirectResp.cookies.set(name, value, options ?? {})
      );
      return applySecurityHeaders(redirectResp, requestId);
    }

    if (user) {
      const { data: userRecord } = await supabase
        .from('users')
        .select('center_id')
        .eq('id', user.id)
        .single();

      if (userRecord?.center_id) {
        const { data: center } = await supabase
          .from('centers')
          .select('status, billing_status, auto_suspend_at, is_blacklisted')
          .eq('id', userRecord.center_id)
          .single();

        const cleanPath = stripLocalePrefix(pathname);
        const localePrefix = pathname.startsWith('/en') ? '/en' : pathname.startsWith('/ar') ? '/ar' : '';
        const suspendedPath = `${localePrefix || '/en'}/suspended`;
        const allowsBlacklistedEscape =
          cleanPath.startsWith('/settings') || cleanPath === '/session-expired';

        if ((center as { is_blacklisted?: boolean } | null)?.is_blacklisted === true) {
          if (!allowsBlacklistedEscape) {
            const blocked = new NextResponse('Unauthorized', { status: 401 });
            storedCookies.forEach(({ name, value, options }) =>
              blocked.cookies.set(name, value, options ?? {})
            );
            return applySecurityHeaders(blocked, requestId);
          }
        }

        if (!cleanPath.startsWith('/suspended')) {
          let shouldRedirect = false;
          let redirectUrl = '';

          if (center?.status === 'suspended') {
            shouldRedirect = true;
            redirectUrl = `${suspendedPath}?reason=center_suspended`;
          } else {
            const billingStatus = (center as { billing_status?: string })?.billing_status;
            const autoSuspendAt = (center as { auto_suspend_at?: string })?.auto_suspend_at;
            if (autoSuspendAt && billingStatus !== 'paid') {
              const suspendDate = new Date(autoSuspendAt);
              if (new Date() >= suspendDate) {
                shouldRedirect = true;
                redirectUrl = `${suspendedPath}?reason=payment_overdue`;
              }
            }
          }

          if (shouldRedirect && redirectUrl) {
            const redirectResp = NextResponse.redirect(new URL(redirectUrl, request.url));
            storedCookies.forEach(({ name, value, options }) =>
              redirectResp.cookies.set(name, value, options ?? {})
            );
            return applySecurityHeaders(redirectResp, requestId);
          }
        }

        // Only consult the subscriptions row as a fallback when the center itself
        // is not explicitly active. If centers.status === 'active' (e.g. an admin
        // manually unsuspended the center), a stale subscriptions.status='suspended'
        // row must NOT keep redirecting the owner away from the dashboard.
        if (center?.status !== 'active') {
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
            return applySecurityHeaders(redirectResp, requestId);
          }
        }
      }
    }
  } catch {
    // Auth check failed, continue
  }

  return applySecurityHeaders(supabaseResponse, requestId);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
