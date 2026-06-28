import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Bodoni_Moda, Fraunces, IBM_Plex_Sans_Arabic, Playfair_Display } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import WebVitalsReporter from '@/lib/monitoring/WebVitalsReporter';
import { SITE_URL } from '@/config/site';
import '../globals.css';

// ADR 031: IBM Plex Sans Arabic is the product font (Arabic + Latin in one
// face). Cairo stays loaded as a unicode-range fallback while Plex arrives.
const plex = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-plex',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});

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

// Serif display face for the summer ribbon + popup (matches the approved mock).
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-fraunces',
  weight: ['400', '600', '700'],
});

import { UserProvider } from '@/contexts/UserContext';
import { LayoutProvider } from '@/contexts/LayoutContext';
import AppShell from '@/components/AppShell';
import ServiceWorkerRegistrarWrapper from '@/components/ServiceWorkerRegistrarWrapper';
import { ToastProvider, PWAInstallBanner } from '@/components/ui';
import { SwUpdateBanner } from '@/components/ui/SwUpdateBanner';
import { PostHogProvider } from '@/components/PostHogProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import FloatingWhatsAppButton from '@/components/support/FloatingWhatsAppButton';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isAr = locale === 'ar';
  const description = isAr
    ? 'نظام إدارة السنترات التعليمية في مصر. حضور QR، متابعة الطلاب، فواتير تلقائية وإشعارات واتساب.'
    : "Egypt's tutoring center operating system. QR attendance, student tracking, automated billing & WhatsApp notifications.";

  return {
    metadataBase: new URL(SITE_URL),
    title: {
      template: '%s | TutoringHQ',
      default: 'TutoringHQ – نظام إدارة السنترات التعليمية',
    },
    description,
    keywords: [
      'سنتر تعليمي',
      'نظام إدارة سنتر',
      'حضور QR',
      'برنامج سنتر مصر',
      'tutoring center management Egypt',
      'center management system',
      'QR system for centers',
      'TutoringHQ',
    ],
    alternates: {
      canonical: '/',
    },
    openGraph: {
      title: 'TutoringHQ – نظام إدارة السنترات التعليمية',
      description,
      url: SITE_URL,
      siteName: 'TutoringHQ',
      locale: isAr ? 'ar_EG' : 'en_US',
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: 'TutoringHQ – نظام إدارة السنترات التعليمية',
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: 'TutoringHQ',
    },
    icons: {
      apple: '/icons/icon-192.png',
    },
    other: {
      'mobile-web-app-capable': 'yes',
    },
  };
}

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
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function() {
  try {
    var stored = localStorage.getItem('chq-theme');
    /* ADR 031: cream is the default; a stored 'light' preference from the
       removed theme falls back to cream. */
    var theme = stored === 'dark' ? 'dark' : 'cream';
    document.documentElement.classList.add(theme);
    document.documentElement.classList.remove(theme === 'dark' ? 'cream' : 'dark');
    document.documentElement.classList.remove('light');
  } catch(e) {
    document.documentElement.classList.add('cream');
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.remove('light');
  }
})();
`,
          }}
        />
        <link
          rel="preload"
          href="/fonts/Cairo-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link rel="icon" href="/logo-icon-64.png" type="image/png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body
        className={`${plex.variable} ${cairo.variable} ${playfair.variable} ${bodoniModa.variable} ${fraunces.variable} antialiased bg-[var(--color-surface-0)] text-[var(--color-text-primary)] min-h-screen w-full font-cairo`}
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
                <FloatingWhatsAppButton />
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
