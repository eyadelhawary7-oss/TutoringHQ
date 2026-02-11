import type { ReactNode } from 'react';
import { cairo, inter } from '@/lib/fonts';
import './globals.css';

type Props = {
  children: ReactNode;
};

export default function RootLayout({ children }: Props) {
  // Default to Arabic for root layout
  // Locale-specific routes will have their own layout in [locale]/layout.tsx
  const locale = 'ar';
  const dir = 'rtl';
  const fontClass = cairo.variable;
  const fontFamily = 'var(--font-cairo)';

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
