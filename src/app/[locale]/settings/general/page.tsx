'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import {
  Building2,
  BookOpen,
  Users,
  QrCode,
  Bell,
  CreditCard,
  MessageCircle,
  Shield,
  KeyRound,
  ChevronRight,
} from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ChangePinModal } from '@/components/admin/ChangePinModal';

export default function SettingsMenuPage() {
  const t = useTranslations('settings');
  const router = useRouter();
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const { user: currentUser, hasPermission } = useUser();
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isPlatformAdminNoCenter, setIsPlatformAdminNoCenter] = useState(false);
  const [checkedAdmin, setCheckedAdmin] = useState(false);

  // Redirect assistants/teachers without can_view_settings.
  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  // Platform admin with no center_id gets a narrow fallback (no settings menu applies to them).
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.center_id) {
      setCheckedAdmin(true);
      return;
    }
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setCheckedAdmin(true);
        return;
      }
      try {
        const res = await fetch('/api/admin/check', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const data = await res.json();
        setIsPlatformAdminNoCenter(!!data?.isAdmin);
      } catch {
        setIsPlatformAdminNoCenter(false);
      } finally {
        setCheckedAdmin(true);
      }
    })();
  }, [currentUser]);

  const isOwnerOrAdmin = currentUser?.role === 'owner' || currentUser?.role === 'super_admin';

  if (currentUser && !currentUser.center_id && checkedAdmin && isPlatformAdminNoCenter) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <PageHeader title={t('title')} />
          <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-6 space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('platformAdminSettingsHint')}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setIsPinModalOpen(true)}
                className="inline-flex items-center justify-center gap-2 px-4 py-3 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <KeyRound className="w-4 h-4 shrink-0" />
                {t('changePin')}
              </button>
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-2 px-4 py-3 border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg hover:bg-[var(--color-surface-0)] transition-colors"
              >
                <Shield className="w-4 h-4 shrink-0" />
                {t('backToAdminConsole')}
              </Link>
            </div>
          </div>
        </div>
        <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
      </div>
    );
  }

  const rows: {
    href: string;
    icon: typeof Building2;
    title: string;
    desc: string;
    hidden?: boolean;
  }[] = [
    { href: '/settings/center', icon: Building2, title: t('centerInfo'), desc: t('menu.centerInfoDesc') },
    { href: '/settings/subjects', icon: BookOpen, title: t('subjects'), desc: t('menu.subjectsDesc') },
    { href: '/settings/team', icon: Users, title: t('teamMembers'), desc: t('manageTeamDesc'), hidden: !isOwnerOrAdmin },
    { href: '/settings/scanner', icon: QrCode, title: t('scannerTitle'), desc: t('menu.scannerDesc') },
    { href: '/settings/notifications', icon: Bell, title: t('sectionNotifications'), desc: t('menu.notificationsDesc') },
    { href: '/settings/money', icon: CreditCard, title: t('billingMoneyTitle'), desc: t('menu.billingMoneyDesc') },
    { href: '/settings/support', icon: MessageCircle, title: t('supportTitle'), desc: t('menu.supportDesc') },
    { href: '/settings/account', icon: Shield, title: t('accountSecurityTitle'), desc: t('menu.accountDesc') },
  ];

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('title')} />
        <div className="space-y-3">
          {rows.filter((r) => !r.hidden).map((row) => (
            <Link
              key={row.href}
              href={row.href}
              className="group flex items-center gap-4 w-full p-5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow btn-lift text-start transition-colors hover:border-teal-500/30"
            >
              <div className="p-2 bg-teal-100 rounded-xl shrink-0">
                <row.icon className="w-5 h-5 text-teal-600" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-[var(--color-text-primary)]">{row.title}</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{row.desc}</p>
              </div>
              <DirectionalIcon icon={ChevronRight} className="w-5 h-5 text-teal-600 shrink-0" aria-hidden />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
