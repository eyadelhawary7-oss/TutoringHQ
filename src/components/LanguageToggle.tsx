'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { useTransition, useEffect, useState } from 'react';

export default function LanguageToggle() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setMounted(true);
      // Load saved locale from localStorage on mount
    const savedLocale = localStorage.getItem('preferred-locale');
    if (savedLocale && savedLocale !== locale) {
      startTransition(() => {
        router.replace(pathname, { locale: savedLocale as 'ar' | 'en' });
      });
    }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const handleLocaleChange = (newLocale: 'ar' | 'en') => {
    // Save to localStorage
    localStorage.setItem('preferred-locale', newLocale);
    
    // Navigate to the new locale
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
  };

  // Prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="relative inline-block">
        <select
          disabled
          className="appearance-none glass-input rounded-lg px-3 py-2 pe-8 text-sm font-medium text-[var(--text-primary)] bg-[var(--glass-bg)] border border-[var(--glass-border)] cursor-pointer disabled:opacity-50"
        >
          <option>AR</option>
        </select>
      </div>
    );
  }

  return (
    <div className="relative inline-block">
      <select
        value={locale}
        onChange={(e) => handleLocaleChange(e.target.value as 'ar' | 'en')}
        disabled={isPending}
        className="appearance-none glass-input rounded-lg px-3 py-2 pe-8 text-sm font-medium text-[var(--text-primary)] bg-[var(--glass-bg)] border border-[var(--glass-border)] cursor-pointer disabled:opacity-50"
        aria-label="Select language"
      >
        <option value="ar">AR</option>
        <option value="en">EN</option>
      </select>
      <div className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-2">
        <svg
          className="h-4 w-4 text-[var(--text-secondary)]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
  );
}
