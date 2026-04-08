import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Bodoni_Moda, Playfair_Display } from 'next/font/google';
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
  preload: false,
});

const playfair = Playfair_Display({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-playfair',
  weight: ['400', '500', '600', '700', '900'],
});

const bodoniModa = Bodoni_Moda({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-bodoni',
  weight: ['400', '700', '900'],
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
    <html
      lang={locale}
      dir={dir}
      className={`${cairo.variable} ${playfair.variable} ${bodoniModa.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    var theme = localStorage.getItem('chq-theme') || 'dark';
    document.documentElement.classList.add(theme);
    document.documentElement.classList.remove(
      theme === 'dark' ? 'light' : 'dark'
    );
  } catch(e) {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  }
})();
`,
          }}
        />
        <link rel="icon" href="/logo-icon-64.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body
        className="antialiased bg-[var(--color-surface-0)] text-[var(--color-text-primary)] min-h-screen w-full font-cairo"
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
