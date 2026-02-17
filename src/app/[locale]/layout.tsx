import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { cairo, inter, jetbrainsMono } from '@/lib/fonts';
import '../globals.css';
import { UserProvider } from '@/contexts/UserContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
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
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  const messagesRaw = await getMessages();
  // Ensure plain object for Client Component serialization (fixes context-not-found with non-plain objects)
  const messages = JSON.parse(JSON.stringify(messagesRaw)) as typeof messagesRaw;

  // Determine direction and font based on locale
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const fontClass = [locale === 'ar' ? cairo.variable : inter.variable, jetbrainsMono.variable].join(' ');
  const fontFamily = locale === 'ar' ? 'var(--font-cairo)' : 'var(--font-inter)';

  return (
    <html lang={locale} dir={dir} className={fontClass} suppressHydrationWarning data-theme="dark-blue">
      <head>
        <link rel="icon" href="/logo-icon-64.png" type="image/png" />
        <link rel="apple-touch-icon" href="/logo-icon-192.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#070A14" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var t = localStorage.getItem('centerhq-theme');
                if (t && ['dark-blue','midnight','light'].includes(t)) {
                  document.documentElement.setAttribute('data-theme', t);
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className="antialiased"
        style={{ fontFamily }}
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <UserProvider>
            <ThemeProvider>
              <LayoutProvider>
                <AppShell>
                  {children}
                </AppShell>
              </LayoutProvider>
            </ThemeProvider>
          </UserProvider>
        </NextIntlClientProvider>
        <ServiceWorkerRegistrarWrapper />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
