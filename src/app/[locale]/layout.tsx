import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Playfair_Display } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import WebVitalsReporter from '@/lib/monitoring/WebVitalsReporter';
import '../globals.css';

const cairo = localFont({
  src: [
    { path: '../../../public/fonts/Cairo-Regular.woff2', weight: '400' },
    { path: '../../../public/fonts/Cairo-Medium.woff2', weight: '500' },
    { path: '../../../public/fonts/Cairo-SemiBold.woff2', weight: '600' },
    { path: '../../../public/fonts/Cairo-Bold.woff2', weight: '700' },
  ],
  variable: '--font-cairo',
  display: 'swap',
  preload: true,
});

const playfair = Playfair_Display({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '600', '700', '900'],
  variable: '--font-playfair',
  display: 'swap',
});

import { UserProvider } from '@/contexts/UserContext';
import { LayoutProvider } from '@/contexts/LayoutContext';
import AppShell from '@/components/AppShell';
import ServiceWorkerRegistrarWrapper from '@/components/ServiceWorkerRegistrarWrapper';
import { ToastProvider, PWAInstallBanner } from '@/components/ui';
import { SwUpdateBanner } from '@/components/ui/SwUpdateBanner';
import { PostHogProvider } from '@/components/PostHogProvider';
import { ThemeProvider } from '@/components/ThemeProvider';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = {
  title: {
    template: '%s | CenterHQ',
    default: 'CenterHQ',
  },
  description: 'إدارة السناتر التعليمية - حضور QR، مدفوعات، تقارير',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CenterHQ',
  },
  icons: {
    apple: '/icons/icon-192.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0D9488',
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messagesRaw = await getMessages();
  const messages = JSON.parse(JSON.stringify(messagesRaw)) as typeof messagesRaw;

  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <html lang={locale} dir={dir} className={`dark ${cairo.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="/fonts/Cairo-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Cairo-Medium.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
      try {
        var p = window.location.pathname;
        var clean = p.replace(/^\\/(ar|en)(\\/|$)/, '$2') || '/';
        var pub = {'/':1,'/login':1,'/signup':1,'/forgot-password':1,'/suspended':1,'/offline':1,'/session-expired':1,'/status':1,'/onboarding':1,'/auth/callback':1};
        var isPublic = !!pub[clean] || clean.indexOf('/refer/') === 0;
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
        if (isPublic && localStorage.getItem('chq-theme') === 'light') {
          document.documentElement.classList.remove('dark');
          document.documentElement.classList.add('light');
        }
      } catch(e) {}
    `,
          }}
        />
        <link rel="icon" href="/logo-icon-64.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body
        className="antialiased bg-[#080D14] text-slate-100 min-h-screen w-full font-cairo"
        suppressHydrationWarning
      >
        <PostHogProvider>
        <ThemeProvider>
        <NextIntlClientProvider messages={messages}>
          <ToastProvider>
            <UserProvider>
              <LayoutProvider>
                <AppShell>
                  {children}
                </AppShell>
              </LayoutProvider>
            </UserProvider>
            <PWAInstallBanner />
          </ToastProvider>
        </NextIntlClientProvider>
        </ThemeProvider>
        <ServiceWorkerRegistrarWrapper />
        <SwUpdateBanner />
        <WebVitalsReporter />
        <Analytics />
        <SpeedInsights />
        </PostHogProvider>
      </body>
    </html>
  );
}
