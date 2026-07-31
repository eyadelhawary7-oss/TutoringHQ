'use client';

import { useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { MessageCircle, ChevronRight, Mail, ScrollText } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { getSupportWhatsAppDisplayLabel, getSupportWhatsAppWaMeBase } from '@/lib/supportWhatsApp';
import { SITE } from '@/config/site';

export default function SupportSettingsPage() {
  const t = useTranslations('settings');
  const tBilling = useTranslations('billing');
  const tTerms = useTranslations('legal.terms');
  const tPrivacy = useTranslations('legal.privacy');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('supportTitle')} />
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
              <MessageCircle className="w-4 h-4 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{tBilling('whatsappSupport')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{tBilling('contactSupportViaWhatsapp')}</p>
            </div>
          </div>
          <div className="p-6">
            <p className="text-sm text-[var(--color-text-secondary)] mb-3" dir="ltr">
              {t('supportContact', {
                email: SITE.supportEmail,
                phone: getSupportWhatsAppDisplayLabel() || ',',
              })}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {getSupportWhatsAppWaMeBase() ? (
                <a
                  href={getSupportWhatsAppWaMeBase()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors btn-lift w-fit"
                >
                  <MessageCircle className="w-4 h-4 shrink-0" aria-hidden />
                  {t('chatOnWhatsapp')}
                </a>
              ) : null}
              <a
                href={`mailto:${SITE.supportEmail}`}
                className="border border-[var(--color-border-default)] hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)] rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2 transition-colors w-fit"
              >
                <Mail className="w-4 h-4 shrink-0" aria-hidden />
                {t('emailSupportTitle')}
              </a>
            </div>
          </div>
        </div>

        <div className="mt-4 bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
          <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
            <div className="p-2 bg-teal-100 rounded-xl shrink-0">
              <ScrollText className="w-4 h-4 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('legalTitle')}</h3>
            </div>
          </div>
          <div className="divide-y divide-[var(--color-border-subtle)]">
            <Link
              href="/legal/terms"
              className="flex items-center justify-between gap-3 px-6 py-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
            >
              {tTerms('title')}
              <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
            </Link>
            <Link
              href="/legal/privacy"
              className="flex items-center justify-between gap-3 px-6 py-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)] transition-colors"
            >
              {tPrivacy('title')}
              <DirectionalIcon icon={ChevronRight} className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
