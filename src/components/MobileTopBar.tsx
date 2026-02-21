'use client';

import Image from 'next/image';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { Globe, Menu } from 'lucide-react';

interface MobileTopBarProps {
  onMenuClick?: () => void;
}

export default function MobileTopBar({ onMenuClick }: MobileTopBarProps) {
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
  };

  return (
    <header
      className="md:hidden sticky top-0 z-30 h-14 flex items-center justify-between px-4 border-b print:hidden"
      style={{
        background: 'hsl(var(--card))',
        borderColor: 'hsl(var(--border))',
      }}
    >
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <button onClick={onMenuClick} className="p-2 -ms-2 rounded-lg hover:bg-slate-100 transition-colors" aria-label="Open menu">
            <Menu size={20} style={{ color: 'hsl(var(--foreground))' }} />
          </button>
        )}
        <Link
          href={user && !user.center_id ? '/admin' : '/dashboard'}
          className="flex items-center gap-2 shrink-0"
        >
          {user?.center?.logo_url ? (
            <img src={user.center.logo_url} alt={centerName} className="w-7 h-7 rounded-lg object-contain shrink-0" />
          ) : (
            <Image src="/logo-icon.png" alt="CenterHQ" width={28} height={28} className="w-7 h-7 rounded-lg shrink-0 object-contain" />
          )}
        </Link>
        <span className="font-bold text-sm" style={{ color: 'hsl(var(--card-foreground))' }}>CenterHQ</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:bg-slate-100 disabled:opacity-50"
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : '\u0639'}</span>
        </button>
      </div>
    </header>
  );
}
