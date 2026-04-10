import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/routing';

function envFallbackOrigin(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    const trimmed = process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    try {
      return new URL(trimmed).origin;
    } catch {
      return trimmed;
    }
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

async function sameDeploymentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() ?? h.get('host') ?? '';
  if (!host) {
    return envFallbackOrigin();
  }
  const protoHdr = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol =
    protoHdr === 'http' || protoHdr === 'https'
      ? protoHdr
      : host.startsWith('localhost') || host.startsWith('127.')
        ? 'http'
        : 'https';
  return `${protocol}://${host}`;
}

export default async function AdminCentersIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const safeLocale = locale === 'en' ? 'en' : 'ar';

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    redirect(`/${safeLocale}/login`);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    redirect(`/${safeLocale}/login`);
  }

  let check: { isAdmin?: boolean } = {};
  try {
    const origin = await sameDeploymentOrigin();
    const res = await fetch(`${origin}/api/admin/check`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    });
    check = (await res.json().catch(() => ({}))) as { isAdmin?: boolean };
  } catch {
    const t = await getTranslations({ locale: safeLocale, namespace: 'errors' });
    const dir = safeLocale === 'ar' ? 'rtl' : 'ltr';
    return (
      <div
        className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center bg-[var(--color-surface-0)] p-6"
        dir={dir}
      >
        <div className="chq-spring-in w-full max-w-md space-y-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-800/50 bg-red-900/30">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#EF4444"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div>
            <h1 className="mb-2 text-xl font-semibold text-white">{t('unexpectedTitle')}</h1>
            <p className="text-sm text-slate-400">{t('unexpectedDesc')}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              href="/admin/centers"
              className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 btn-press chq-focus"
            >
              {t('tryAgain')}
            </Link>
            <Link
              href="/dashboard"
              className="rounded-xl bg-slate-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-600 btn-press chq-focus"
            >
              {t('goDashboard')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!check?.isAdmin) {
    redirect(`/${safeLocale}/dashboard`);
  }

  redirect(`/${safeLocale}/admin?tab=centers`);
}
