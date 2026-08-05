'use client';

import { useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { MessageCircle, ChevronRight, Mail, ScrollText, Shield } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { getSupportWhatsAppDisplayLabel, getSupportWhatsAppWaMeBase } from '@/lib/supportWhatsApp';
import { SITE } from '@/config/site';
import { SettingsGroup, SettingsGroupLabel, SettingsRow } from '@/components/settings/SettingsRows';

/**
 * `Merged-Center-Setup` §05, Support half — GET IN TOUCH / HELP / ABOUT as
 * labelled groups of hairline-divided rows.
 *
 * NOT drawn here, and why (F32, re-confirmed by grep on this branch):
 *   · "Help center", "Report a problem", "Request a feature". No route, page,
 *     handler or ticket queue exists anywhere in `src/` for any of the three.
 *     A row that goes nowhere, or that silently re-points at the WhatsApp and
 *     email rows two lines above it, is worse than no row.
 *   · "App version" under ABOUT. No app-version value reaches the client —
 *     there is no `NEXT_PUBLIC_APP_VERSION` and `package.json`'s `version` is
 *     never surfaced — so there is no number to print that would not be made
 *     up. The ABOUT group therefore carries only Terms and Privacy, which are
 *     real pages.
 */
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

  const waHref = getSupportWhatsAppWaMeBase();
  const waLabel = getSupportWhatsAppDisplayLabel();

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

        <div className="space-y-5">
          <div>
            <SettingsGroupLabel>{t('groupGetInTouch')}</SettingsGroupLabel>
            <SettingsGroup>
              {waHref && (
                <SettingsRow
                  icon={MessageCircle}
                  label={t('chatOnWhatsapp')}
                  value={t('supportFastest')}
                  externalHref={waHref}
                  description={tBilling('contactSupportViaWhatsapp')}
                />
              )}
              <SettingsRow
                icon={Mail}
                iconClassName="bg-[var(--color-tile)] text-[var(--color-mid)]"
                label={t('emailSupportTitle')}
                description={SITE.supportEmail}
                externalHref={`mailto:${SITE.supportEmail}`}
              />
            </SettingsGroup>
            {waLabel && (
              <p className="mt-2 px-1 text-xs text-[var(--color-muted)]" dir="ltr">
                {waLabel}
              </p>
            )}
          </div>

          <div>
            <SettingsGroupLabel>{t('groupAbout')}</SettingsGroupLabel>
            <SettingsGroup>
              <SettingsRow
                icon={ScrollText}
                iconClassName="bg-[var(--color-tile)] text-[var(--color-mid)]"
                label={tTerms('title')}
                href="/legal/terms"
              />
              <SettingsRow
                icon={Shield}
                iconClassName="bg-[var(--color-tile)] text-[var(--color-mid)]"
                label={tPrivacy('title')}
                href="/legal/privacy"
              />
            </SettingsGroup>
          </div>
        </div>
      </div>
    </div>
  );
}
