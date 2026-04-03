import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
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

import { UserProvider } from '@/contexts/UserContext';
import { LayoutProvider } from '@/contexts/LayoutContext';
import AppShell from '@/components/AppShell';
import ServiceWorkerRegistrarWrapper from '@/components/ServiceWorkerRegistrarWrapper';
import PwaInstallBanner from '@/components/PwaInstallBanner';
import { ToastProvider } from '@/contexts/ToastContext';
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
  description: 'إدارة السناتر التعليمية — حضور QR، مدفوعات، تقارير',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
    <html lang={locale} dir={dir} className={`${cairo.variable}`} suppressHydrationWarning>
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
        var t = localStorage.getItem('chq-theme');
        if (t === 'light') document.documentElement.classList.add('light');
      } catch(e) {}
    `,
          }}
        />
        <link rel="icon" href="/logo-icon-64.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0D9488" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CenterHQ" />
      </head>
      <body
        className="antialiased bg-[var(--color-surface-0)] text-[var(--color-text-primary)] font-cairo"
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
          </ToastProvider>
          <PwaInstallBanner />
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
