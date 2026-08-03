'use client';

import { useTransition } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';

/**
 * One implementation of the teacher portal's language switch, shared by the
 * desktop sidebar (TeacherNav) and the mobile appbar globe (TeacherAppBar) so
 * the two can never drift.
 *
 * Switches locale while keeping the current route (next-intl rewrites the
 * prefix), then persists the choice server-side best-effort — a failure there
 * never blocks the visual switch.
 */
export function useLocaleToggle(): () => void {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  return () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => {
      router.replace(pathname, { locale: newLocale });
    });
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      fetch('/api/user/locale', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locale: newLocale }),
      }).catch(() => undefined);
    })();
  };
}
