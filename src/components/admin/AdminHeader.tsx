'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { supabase } from '@/lib/supabase';
import { Globe } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { ChangePinModal } from './ChangePinModal';
import { TestLiveToggle } from '@/components/admin/TestLiveToggle';

export function AdminHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const locale = useLocale();
  const tSettings = useTranslations('settings');
  const [isPending, startTransition] = useTransition();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [showTestLiveToggle, setShowTestLiveToggle] = useState(false);
  const [userName, setUserName] = useState('');
  const [userPhone, setUserPhone] = useState('');

  useEffect(() => {
    const loadUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Auth email format: {phoneDigits}@centerhq.local - derive phone without querying users (RLS blocks client)
      const phone = user.email?.replace('@centerhq.local', '') ?? '';
      const displayPhone = phone ? `+${phone}` : 'Admin';
      setUserName(user.user_metadata?.name ?? displayPhone);
      setUserPhone(displayPhone);
    };
    loadUser();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token || cancelled) return;
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = (await res.json().catch(() => ({}))) as { role?: string };
      if (!cancelled && j.role === 'super_admin') setShowTestLiveToggle(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest('[data-user-menu-container]')) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLocaleToggle = () => {
    const newLocale = locale === 'ar' ? 'en' : 'ar';
    document.cookie = `NEXT_LOCALE=${newLocale};path=/;max-age=31536000`;
    const basePath = pathname ?? `/${locale}`;
    const newPath = basePath.replace(`/${locale}`, `/${newLocale}`);
    startTransition(() => router.push(newPath));
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      fetch('/api/user/locale', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locale: newLocale }),
      }).catch(() => undefined);
    })();
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
    router.refresh();
  };

  return (
    <>
      <header className="hidden lg:flex fixed top-0 inset-x-0 h-14 z-30 items-center justify-between px-4 md:px-6 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
        <span
          className="text-lg"
          style={{ fontFamily: 'var(--font-bodoni)', fontWeight: 700, letterSpacing: '2px' }}
        >
          <span className="text-[var(--color-text-primary)]">CENTER</span>
          <span className="text-teal-600">HQ</span>
        </span>
        <div className="flex items-center gap-3">
          {showTestLiveToggle ? (
            <Suspense fallback={null}>
              <TestLiveToggle />
            </Suspense>
          ) : null}
          <ThemeToggle />
          <button
            onClick={handleLocaleToggle}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
          >
            <Globe size={14} />
            <span>{locale === 'ar' ? 'English' : 'العربية'}</span>
          </button>
          <div className="relative" data-user-menu-container>
            <button
              onClick={() => setIsUserMenuOpen((v) => !v)}
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 transition-colors"
            >
              {(userName || userPhone || 'U').charAt(0).toUpperCase()}
            </button>
            {isUserMenuOpen && (
              <div className="absolute top-12 end-0 bg-[var(--color-surface-1)] rounded-xl shadow-lg border border-[var(--color-border-subtle)] py-1 z-50 min-w-[200px]">
                <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{userName || '-'}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]" dir="ltr">{userPhone || '-'}</p>
                </div>
                <button
                  onClick={() => {
                    setIsPinModalOpen(true);
                    setIsUserMenuOpen(false);
                  }}
                  className="w-full text-start px-4 py-2.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
                >
                  {tSettings('changePin')}
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full text-start px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  تسجيل الخروج
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
    </>
  );
}
