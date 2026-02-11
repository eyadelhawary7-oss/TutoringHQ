import type { ReactNode } from 'react';
import { cairo, inter } from '@/lib/fonts';
import './globals.css';

type Props = {
  children: ReactNode;
};

export default function RootLayout({ children }: Props) {
  // #region agent log
  console.log('[DEBUG] layout.tsx RootLayout rendering', { timestamp: Date.now() });
  // #endregion

  // Default to Arabic for root layout
  // Locale-specific routes will have their own layout in [locale]/layout.tsx
  let locale = 'ar';
  let dir: 'rtl' | 'ltr' = 'rtl';
  let fontClass: string;
  let fontFamily: string;

  try {
    fontClass = cairo.variable;
    fontFamily = 'var(--font-cairo)';
    // #region agent log
    console.log('[DEBUG] layout.tsx fonts loaded OK', { fontClass, timestamp: Date.now() });
    // #endregion
  } catch (e: any) {
    // #region agent log
    console.error('[DEBUG] layout.tsx FONT CRASH', { error: e?.message, stack: e?.stack, timestamp: Date.now() });
    // #endregion
    fontClass = '';
    fontFamily = 'system-ui, sans-serif';
  }

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
