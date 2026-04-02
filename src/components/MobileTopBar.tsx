'use client';

import Image from 'next/image';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { Globe, Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { supabase } from '@/lib/supabase';

interface MobileTopBarProps {
  openMenu: boolean;
  setOpenMenu: (open: boolean) => void;
}

export default function MobileTopBar({ openMenu, setOpenMenu }: MobileTopBarProps) {
  const { user } = useUser();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const centerName = user?.center?.name || user?.name || user?.phone || 'User';

  const handleLocaleToggle = () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    localStorage.setItem('preferred-locale', newLocale);
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as 'ar' | 'en' });
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

  return (
    <header className="lg:hidden fixed top-0 inset-x-0 z-40 bg-[var(--color-surface-1)] border-b border-[var(--color-border-subtle)] min-h-14 flex items-center justify-center print:hidden relative px-4">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10 lg:hidden">
        {openMenu ? (
          <X className="h-6 w-6 cursor-pointer text-[var(--color-text-primary)]" onClick={() => setOpenMenu(false)} />
        ) : (
          <Menu className="h-6 w-6 cursor-pointer text-[var(--color-text-primary)]" onClick={() => setOpenMenu(true)} />
        )}
      </div>

      <Link
        href={user && !user.center_id ? '/admin' : '/dashboard'}
        className="flex items-center gap-2 shrink-0"
      >
        {user?.center?.logo_url ? (
          <img src={user.center.logo_url} alt={centerName} className="w-7 h-7 rounded-lg object-contain shrink-0" />
        ) : (
          <Image src="/logo-icon.png" alt="CenterHQ" width={28} height={28} className="w-7 h-7 rounded-lg shrink-0 object-contain" />
        )}
        <span className="font-bold text-sm text-[var(--color-text-primary)]">CenterHQ</span>
      </Link>

      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors disabled:opacity-50"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : '\u0639'}</span>
        </button>
      </div>
    </header>
  );
}
