'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { PageHeader, PlanBadge } from '@/components/shared';
import {
  Building2,
  BookOpen,
  Users,
  QrCode,
  Bell,
  CreditCard,
  Gift,
  MessageCircle,
  Shield,
  KeyRound,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { ChangePinModal } from '@/components/admin/ChangePinModal';
import {
  SettingsGroup,
  SettingsGroupLabel,
  SettingsRow,
  SettingsSignOutButton,
} from '@/components/settings/SettingsRows';
import { signOutToLogin } from '@/lib/auth/sign-out-client';

/**
 * `Merged-Center-Setup` §02 — the settings hub.
 *
 * Drawn as a centre-identity row, then four labelled groups (CENTER / YOU /
 * PLAN / HELP) of hairline-divided rows, then sign out.
 *
 * NOT drawn here, and why — each checked against the live catalog, project
 * `lczmjpnbuhnsislcvzar`, not against a migration file:
 *
 *   · "Identity verification" (YOU group, with a Verified pill). No
 *     `verification_status` / `national_id` / `kyc` column exists on any table
 *     in `public` — V1/V6. There is no state to render.
 *   · "General" (YOU group, value "English"). The design's General screen is
 *     language + currency + week start + time/date format. `centers` and
 *     `users` carry none of `currency`, `week_start`, `time_format`,
 *     `date_format`; only `users.preferred_locale` exists and it is written
 *     from the app-shell locale switcher, not from here — D11.
 *   · A member count on the Team row. The number is real (`users` rows for this
 *     centre) but reading it from here needs either a new `/api/db` caller,
 *     which CLAUDE.md bans, or a new REST route. `/api/settings/limits` cannot
 *     supply it: that route selects `max_teachers, max_students` from `centers`
 *     and neither column exists live (confirmed: 0 rows in
 *     `information_schema.columns` for both), so it 404s before it counts
 *     anything — F19.3.
 *   · "TutoringHQ · v2.4.0" under sign out. No app-version value reaches the
 *     client — no `NEXT_PUBLIC_APP_VERSION`, and `package.json`'s version is
 *     never surfaced — F32.
 *
 * The Scanner row is NOT drawn locked/"Coming soon" as the design shows it:
 * `/settings/scanner` is live and writes `centers.scanner_default_mode`.
 */
/** The enumerated values `/settings/center` writes, and the only ones with a
 *  `settings.governorateOptions.*` label. A value outside this list renders as
 *  nothing rather than as a raw column value. */
const GOVERNORATE_LABELLED = new Set([
  'cairo',
  'alexandria',
  'giza',
  'mansoura',
  'tanta',
  'ismailia',
  'port_said',
  'suez',
  'aswan',
  'luxor',
  'asyut',
  'hurghada',
  'other_upper_egypt',
]);

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

  const center = currentUser?.center ?? null;
  const governorate = center?.governorate;
  // Only render a location when it is one of the enumerated values that has a
  // translation. A raw DB string is not shown, and nothing is invented.
  const governorateLabel =
    governorate && GOVERNORATE_LABELLED.has(governorate)
      ? t(`governorateOptions.${governorate}`)
      : null;

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('title')} />

        <div className="space-y-5">
          {/* Centre identity — the design's first, ungrouped row. */}
          {center?.name && (
            <SettingsGroup>
              <Link
                href="/settings/center"
                className="flex w-full items-center gap-3 px-4 py-4 text-start transition-colors hover:bg-[var(--color-tile)]"
              >
                <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                  {center.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={center.logo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Building2 className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-md font-semibold text-[var(--color-ink)]">
                    {center.name}
                  </span>
                  {(governorateLabel || center.plan) && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-base text-[var(--color-muted)]">
                      {governorateLabel && <span className="truncate">{governorateLabel}</span>}
                      {governorateLabel && center.plan && <span aria-hidden>·</span>}
                      {center.plan && <PlanBadge plan={center.plan} />}
                    </span>
                  )}
                </span>
                <DirectionalIcon icon={ChevronRight} className="h-5 w-5 shrink-0 text-[var(--color-faint)]" aria-hidden />
              </Link>
            </SettingsGroup>
          )}

          <div>
            <SettingsGroupLabel>{t('groupCenter')}</SettingsGroupLabel>
            <SettingsGroup>
              <SettingsRow
                icon={Building2}
                label={t('centerInfo')}
                description={t('menu.centerInfoDesc')}
                href="/settings/center"
              />
              <SettingsRow
                icon={BookOpen}
                iconClassName="bg-[var(--color-sand)] text-[var(--color-brass)]"
                label={t('subjects')}
                description={t('menu.subjectsDesc')}
                href="/settings/subjects"
              />
              {isOwnerOrAdmin && (
                <SettingsRow
                  icon={Users}
                  label={t('teamMembers')}
                  description={t('manageTeamDesc')}
                  href="/settings/team"
                />
              )}
              <SettingsRow
                icon={QrCode}
                iconClassName="bg-[var(--color-tile)] text-[var(--color-mid)]"
                label={t('scannerTitle')}
                description={t('menu.scannerDesc')}
                href="/settings/scanner"
              />
            </SettingsGroup>
          </div>

          <div>
            <SettingsGroupLabel>{t('groupYou')}</SettingsGroupLabel>
            <SettingsGroup>
              <SettingsRow
                icon={Shield}
                label={t('accountSecurityTitle')}
                description={t('menu.accountDesc')}
                href="/settings/account"
              />
              <SettingsRow
                icon={Bell}
                iconClassName="bg-[var(--color-sand)] text-[var(--color-brass)]"
                label={t('sectionNotifications')}
                description={t('menu.notificationsDesc')}
                href="/settings/notifications"
              />
            </SettingsGroup>
          </div>

          <div>
            <SettingsGroupLabel>{t('groupPlan')}</SettingsGroupLabel>
            <SettingsGroup>
              <SettingsRow
                icon={CreditCard}
                label={t('billingMoneyTitle')}
                description={t('menu.billingMoneyDesc')}
                href="/settings/money"
                badge={center?.plan ? <PlanBadge plan={center.plan} /> : undefined}
              />
              {isOwnerOrAdmin && (
                <SettingsRow
                  icon={Gift}
                  iconClassName="bg-[var(--color-sand)] text-[var(--color-brass)]"
                  label={t('manageReferrals')}
                  description={t('menu.referralsDesc')}
                  href="/referrals"
                />
              )}
            </SettingsGroup>
          </div>

          <div>
            <SettingsGroupLabel>{t('groupHelp')}</SettingsGroupLabel>
            <SettingsGroup>
              <SettingsRow
                icon={MessageCircle}
                iconClassName="bg-[var(--color-tile)] text-[var(--color-mid)]"
                label={t('supportTitle')}
                description={t('menu.supportDesc')}
                href="/settings/support"
              />
            </SettingsGroup>
          </div>

          <SettingsSignOutButton
            label={t('logout')}
            icon={LogOut}
            onClick={() => {
              void signOutToLogin(locale);
            }}
          />
        </div>
      </div>
    </div>
  );
}
