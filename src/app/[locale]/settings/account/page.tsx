'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { Shield, KeyRound, LogOut, ChevronRight } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

export default function AccountSettingsPage() {
  const t = useTranslations('settings');
  const tBilling = useTranslations('billing');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  const handleLogout = async () => {
    await signOutToLogin(locale);
  };

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('accountSecurityTitle')} />
        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
          <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
            <div className="p-2 bg-teal-100 rounded-xl shrink-0">
              <Shield className="w-4 h-4 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('account')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{tBilling('securityAndSignOut')}</p>
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-center flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setIsPinModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] text-sm font-semibold rounded-lg transition-colors"
              >
                <KeyRound className="w-4 h-4" /> {t('changePin')}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--color-danger)] hover:opacity-90 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" /> {t('logout')}
              </button>
            </div>
          </div>
        </div>
      </div>
      <ChangePinModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
    </div>
  );
}
