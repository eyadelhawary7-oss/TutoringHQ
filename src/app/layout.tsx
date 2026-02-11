import type { ReactNode } from 'react';
import { cairo, inter } from '@/lib/fonts';
import './globals.css';

type Props = {
  children: ReactNode;
  params?: Promise<{ locale?: string }>;
};

export default async function RootLayout({ children, params }: Props) {
  // Get locale from params if it exists (for [locale] routes)
  const resolvedParams = params ? await params : null;
  const locale = resolvedParams?.locale || 'ar';
  
  // Determine direction and font based on locale
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const fontClass = locale === 'ar' ? cairo.variable : inter.variable;
  const fontFamily = locale === 'ar' ? 'var(--font-cairo)' : 'var(--font-inter)';

  return (
    <html lang={locale} dir={dir} className={fontClass} suppressHydrationWarning>
      <body 
        className="antialiased" 
        style={{ fontFamily }}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
