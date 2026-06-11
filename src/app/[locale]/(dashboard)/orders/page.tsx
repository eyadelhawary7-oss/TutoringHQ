import { getTranslations } from 'next-intl/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getShippingFee, getShippingZone } from '@/lib/bostaShipping';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { Link } from '@/i18n/routing';
import OrdersPageClient, { type CardOrdersShippingQuote } from './OrdersPageClient';

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout_error?: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  let initialShippingQuote: CardOrdersShippingQuote | null = null;
  const bostaShippingRates = supabaseAdmin ? await loadBostaShippingRates() : null;

  if (supabaseAdmin) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) {
      // CORE lookup (Rule 151): identity columns only, error DESTRUCTURED.
      // The old wide select bundled can_place_card_orders with center_id and
      // dropped the error, so a PostgREST schema-cache error nulled the row,
      // the permission gate below never fired, and a blocked user fell through
      // to the full orders page (fail-open). A CORE error is infrastructure
      // failure - never coerce it to "no user"; show an error state instead.
      const { data: coreRow, error: coreErr } = await supabaseAdmin
        .from('users')
        .select('id, center_id, role')
        .eq('id', user.id)
        .maybeSingle();

      if (coreErr) {
        Sentry.withScope((scope) => {
          scope.setTag('route', 'orders-page');
          scope.setTag('step', 'core_user_lookup');
          Sentry.captureException(coreErr);
        });
        const t = await getTranslations({ locale, namespace: 'permissions.loadError' });
        return (
          <div className="min-h-screen w-full bg-[var(--color-surface-0)] flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-8">
              <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{t('title')}</h1>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('message')}</p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {t('backToDashboard')}
              </Link>
            </div>
          </div>
        );
      }

      const cid = (coreRow as { center_id?: string | null } | null)?.center_id;
      const role = (coreRow as { role?: string | null } | null)?.role ?? '';
      const isPrivileged = ['owner', 'admin', 'super_admin'].includes(role);

      // PERMISSIONS lookup: best-effort. On error, warn in Sentry and keep the
      // default of false - permission gates fail CLOSED (Rule 149), so column
      // drift shows the restricted state, never the full orders page.
      let canPlaceCardOrders = false;
      if (cid && !isPrivileged) {
        const { data: permsRow, error: permsErr } = await supabaseAdmin
          .from('users')
          .select('can_place_card_orders')
          .eq('id', user.id)
          .maybeSingle();
        if (permsErr) {
          Sentry.withScope((scope) => {
            scope.setTag('route', 'orders-page');
            scope.setTag('step', 'permission_flags');
            Sentry.captureMessage(
              `orders page permission-column lookup failed: ${permsErr.message}`,
              'warning',
            );
          });
        } else {
          canPlaceCardOrders = Boolean(
            (permsRow as { can_place_card_orders?: boolean | null } | null)
              ?.can_place_card_orders,
          );
        }
      }

      if (cid && !isPrivileged && !canPlaceCardOrders) {
        const t = await getTranslations({ locale, namespace: 'permissions.ownerOnly' });
        return (
          <div className="min-h-screen w-full bg-[var(--color-surface-0)] flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] card-shadow p-8">
              <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">{t('title')}</h1>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('message')}</p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {t('backToDashboard')}
              </Link>
            </div>
          </div>
        );
      }
      if (cid) {
        const { data: center } = await supabaseAdmin
          .from('centers')
          .select('governorate')
          .eq('id', cid)
          .maybeSingle();
        const govRaw = (center as { governorate?: string | null } | null)?.governorate;
        const gov = govRaw != null ? String(govRaw).trim() : '';
        initialShippingQuote = {
          hasGovernorate: gov.length > 0,
          fee: getShippingFee(gov || undefined, bostaShippingRates),
          zoneEn: getShippingZone(gov || undefined, bostaShippingRates),
        };
      }
    }
  }

  return (
    <OrdersPageClient
      checkoutError={sp.checkout_error ?? null}
      initialShippingQuote={initialShippingQuote}
      bostaShippingRates={bostaShippingRates}
    />
  );
}
