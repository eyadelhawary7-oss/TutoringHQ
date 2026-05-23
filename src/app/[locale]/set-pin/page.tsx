import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  SIGNUP_SESSION_COOKIE,
  verifySignupSession,
} from '@/lib/signupSessionCookie';
import { findLiveTokenForUser } from '@/lib/pinSetupTokens';
import SetPinClient from './SetPinClient';

/**
 * /set-pin — Owner Set-PIN-on-first-login page.
 *
 * Server component decides which view to render based on three signals:
 *   - URL `?t=<token>`     → Fallback path (chq_pin_setup_link). Render form.
 *   - chq_signup_session cookie + paid+activated DB state + live webhook token
 *                          → Happy path. Render form (no URL token).
 *   - cookie present but state not yet finalized
 *                          → Finalizing/poll view; resolves to form once webhook
 *                            finishes. NEVER grants set-PIN authority by itself.
 *   - neither cookie nor token (or stale cookie)
 *                          → Fallback "request a link" form.
 *
 * Trust anchor: server-side gating happens here AND is re-verified at
 * /api/auth/set-initial-pin. The page render is a UX shortcut; the submit
 * route is the security boundary.
 */
export default async function SetPinPage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'setPin' });

  const rawT = sp.t;
  const urlToken =
    typeof rawT === 'string'
      ? rawT.trim()
      : Array.isArray(rawT) && typeof rawT[0] === 'string'
        ? rawT[0].trim()
        : '';

  // Fallback URL path.
  if (urlToken) {
    return (
      <SetPinClient
        locale={locale === 'ar' ? 'ar' : 'en'}
        mode="form"
        urlToken={urlToken}
        labels={buildLabels(t)}
      />
    );
  }

  const cookieStore = await cookies();
  const session = verifySignupSession(cookieStore.get(SIGNUP_SESSION_COOKIE)?.value ?? null);

  if (!session) {
    // No proof of which browser this is and no fallback token. Offer the
    // request-a-link path.
    return (
      <SetPinClient
        locale={locale === 'ar' ? 'ar' : 'en'}
        mode="fallback"
        labels={buildLabels(t)}
      />
    );
  }

  // Cookie path — verify center is paid+activated AND a webhook token exists.
  let mode: 'form' | 'finalizing' | 'fallback' = 'finalizing';
  try {
    const admin = getSupabaseAdmin();
    const { data: center } = await admin
      .from('centers')
      .select('id, status, approved_at')
      .eq('id', session.centerId)
      .maybeSingle();
    const cs = center as { status?: string | null; approved_at?: string | null } | null;
    const paidActivated =
      !!cs &&
      (cs.status === 'paid_pending_activation' ||
        (cs.status === 'active' && !!cs.approved_at));

    if (!paidActivated) {
      mode = 'finalizing';
    } else {
      const { data: owner } = await admin
        .from('users')
        .select('id, pin_code')
        .eq('center_id', session.centerId)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      const ow = owner as { id?: string | null; pin_code?: string | null } | null;
      if (!ow?.id) {
        mode = 'finalizing';
      } else if (ow.pin_code) {
        // Owner already finished — redirect to login on the client.
        mode = 'fallback';
      } else {
        const live = await findLiveTokenForUser(admin, ow.id);
        mode = live ? 'form' : 'finalizing';
      }
    }
  } catch {
    // Don't expose system errors; degrade to fallback view.
    mode = 'fallback';
  }

  return (
    <SetPinClient
      locale={locale === 'ar' ? 'ar' : 'en'}
      mode={mode}
      labels={buildLabels(t)}
    />
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function buildLabels(t: Translator) {
  return {
    header: t('header'),
    helper: t('helper'),
    pinLabel: t('pinLabel'),
    confirmLabel: t('confirmLabel'),
    show: t('show'),
    hide: t('hide'),
    submit: t('submit'),
    submitting: t('submitting'),
    errorWeak: t('errorWeak'),
    errorMismatch: t('errorMismatch'),
    errorInvalidToken: t('errorInvalidToken'),
    errorAlreadySet: t('errorAlreadySet'),
    errorServer: t('errorServer'),
    errorNotFinalized: t('errorNotFinalized'),
    finalizingHeader: t('finalizingHeader'),
    finalizingHelper: t('finalizingHelper'),
    fallbackHeader: t('fallbackHeader'),
    fallbackHelper: t('fallbackHelper'),
    fallbackPhoneLabel: t('fallbackPhoneLabel'),
    fallbackSubmit: t('fallbackSubmit'),
    fallbackSent: t('fallbackSent'),
  };
}
