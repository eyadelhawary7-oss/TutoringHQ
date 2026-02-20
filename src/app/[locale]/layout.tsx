import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { cairo, inter, jetbrainsMono } from '@/lib/fonts';
import '../globals.css';
import { UserProvider } from '@/contexts/UserContext';
import { LayoutProvider } from '@/contexts/LayoutContext';
import AppShell from '@/components/AppShell';
import ServiceWorkerRegistrarWrapper from '@/components/ServiceWorkerRegistrarWrapper';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
  const fontClass = [locale === 'ar' ? cairo.variable : inter.variable, jetbrainsMono.variable].join(' ');
  const fontFamily = locale === 'ar' ? 'var(--font-cairo)' : 'var(--font-inter)';

  return (
    <html lang={locale} dir={dir} className={fontClass} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo-icon-64.png" type="image/png" />
        <link rel="apple-touch-icon" href="/logo-icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f8fafc" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body
        className="antialiased bg-background text-foreground"
        style={{ fontFamily }}
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <UserProvider>
            <LayoutProvider>
              <AppShell>
                {children}
              </AppShell>
            </LayoutProvider>
          </UserProvider>
        </NextIntlClientProvider>
        <ServiceWorkerRegistrarWrapper />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
