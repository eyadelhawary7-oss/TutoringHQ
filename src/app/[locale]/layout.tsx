import { routing } from '@/i18n/routing';
import { notFound } from 'next/navigation';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import { cairo, inter } from '@/lib/fonts';
import '../globals.css';
import { UserProvider } from '@/contexts/UserContext';
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
  const fontClass = locale === 'ar' ? cairo.variable : inter.variable;
  const fontFamily = locale === 'ar' ? 'var(--font-cairo)' : 'var(--font-inter)';

  return (
    <html lang={locale} dir={dir} className={fontClass} suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#4f46e5" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </head>
      <body
        className="antialiased"
        style={{ fontFamily }}
        suppressHydrationWarning
      >
        <NextIntlClientProvider messages={messages}>
          <UserProvider>
            {children}
          </UserProvider>
        </NextIntlClientProvider>
        <ServiceWorkerRegistrarWrapper />
      </body>
    </html>
  );
}
