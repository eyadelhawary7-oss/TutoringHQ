'use client';

import { useState, FormEvent, useTransition, useId } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { isRefreshTokenNotFoundError } from '@/lib/supabaseRefreshSilence';
import { decidePostLoginRoute } from '@/lib/postLoginRoute';
import { memoryCacheSet } from '@/lib/clientMemoryCache';
import { PENDING_SIGNUP_KEY } from '@/lib/signup/usePendingSignup';
import { Globe } from 'lucide-react';

export default function LoginPage() {
  const t = useTranslations('login');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const phoneFieldId = useId();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [shakePin, setShakePin] = useState(false);
  const [resumeSignup, setResumeSignup] = useState<{
    last_step_completed: number;
    pending: {
      center_name: string;
      owner_name: string;
      email: string;
      city: string;
      plan_key: string;
      billing_period: string;
      referral_code: string | null;
    };
  } | null>(null);

  const PLAYFAIR = {
    fontFamily: "var(--font-playfair), 'Playfair Display', 'Didot', Georgia, serif",
    fontVariantNumeric: 'tabular-nums' as const,
    fontFeatureSettings: '"zero" 1, "tnum" 1',
  } as const;
  const SANS = {
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as const;

  const shakePinField = () => {
    setShakePin(true);
    setTimeout(() => setShakePin(false), 500);
  };

  const handleLocaleToggle = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    startTransition(() => router.replace(pathname, { locale: next }));
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!phone || !pin) {
      setError(t('invalidCredentials'));
      shakePinField();
      return;
    }

    setIsLoading(true);
    try {
      const lookupRes = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const lookupData = (await lookupRes.json()) as {
        email?: string;
        error?: string;
      };

      if (!lookupRes.ok || !lookupData.email) {
        let resume: typeof resumeSignup = null;
        const errMsg =
          typeof lookupData.error === 'string' ? lookupData.error : '';
        if (errMsg === 'Phone number not registered') {
          try {
            const pr = await fetch(
              `/api/signup/check-pending?phone=${encodeURIComponent(phone)}`,
            );
            const pd = (await pr.json()) as {
              exists?: boolean;
              completed?: boolean;
              expired?: boolean;
              pending?: NonNullable<typeof resumeSignup>['pending'];
              last_step_completed?: number;
            };
            if (pd.exists && pd.pending && !pd.completed && !pd.expired) {
              resume = {
                last_step_completed: pd.last_step_completed ?? 1,
                pending: pd.pending,
              };
            }
          } catch {
            //
          }
        }
        setResumeSignup(resume);
        setError(errMsg || t('phoneNotFound'));
        shakePinField();
        setIsLoading(false);
        return;
      }

      setResumeSignup(null);

      const verifyRes = await fetch('/api/auth/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as { error?: string };

      if (!verifyRes.ok) {
        if (verifyRes.status === 423 || verifyData.error === 'ACCOUNT_LOCKED') {
          setError(t('accountLocked'));
        } else if (verifyRes.status >= 500 || verifyData.error === 'auth_system_error') {
          setError(t('authSystemError'));
        } else {
          setError(t('invalidCredentials'));
        }
        shakePinField();
        setIsLoading(false);
        return;
      }

      // Server set the @supabase/ssr cookies on its response. The browser
      // client reads from those same cookies, so getSession() now returns the
      // freshly-established session.
      const {
        data: { session },
        error: sessionErr,
      } = await supabase.auth.getSession();
      if (sessionErr && !isRefreshTokenNotFoundError(sessionErr)) {
        /* non-public noise only */
      }
      if (!session) {
        setError(t('authSystemError'));
        shakePinField();
        setIsLoading(false);
        return;
      }

      // Resolve role + preferred locale once (the same CORE columns /api/me
      // returns). Role drives teacher routing; the locale is reused for every
      // redirect below so we never re-query users per branch.
      let preferredLocale: 'ar' | 'en' = 'ar';
      let userRole: string | null = null;
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('role, preferred_locale')
          .eq('id', session.user.id)
          .maybeSingle();
        if (userData?.preferred_locale === 'ar' || userData?.preferred_locale === 'en') {
          preferredLocale = userData.preferred_locale;
        }
        userRole = (userData?.role as string | null) ?? null;
      } catch {
        // Fallback silently - never block login
      }

      // Teacher (Model B: center-less on public.users) owns the /teacher portal.
      // Checked FIRST - before center_id / onboarding - so a teacher is never
      // funnelled to the centre dashboard or onboarding (decidePostLoginRoute
      // rule 1). A NULL center_id is not a "needs onboarding" signal for them.
      if (userRole === 'teacher') {
        router.push('/teacher', { locale: preferredLocale });
        return;
      }

      const checkRes = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const checkData = await checkRes.json();
      if (checkData.isAdmin) {
        router.replace('/admin');
        return;
      }

      const res = await fetch('/api/auth/check-invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();

      const decision = decidePostLoginRoute({
        role: userRole,
        isAdmin: false,
        centerId: (result.centerId as string | null) ?? null,
        needsOnboarding: Boolean(result.needsOnboarding),
        contactSales: Boolean(result.contactSales),
      });
      if (decision.kind === 'contactSales') {
        setError(t('contactSales'));
        shakePinField();
      } else {
        router.push(decision.path, { locale: preferredLocale });
      }
    } catch {
      setError(t('invalidCredentials'));
      shakePinField();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResumeSignup = () => {
    if (!resumeSignup) return;
    const p = resumeSignup.pending;
    const stage =
      resumeSignup.last_step_completed >= 2
        ? 'payment'
        : resumeSignup.last_step_completed >= 1
          ? 'plan'
          : 'info';
    // Hand the resumed signup to the form in-memory (tab-scoped) instead of
    // sessionStorage — it carries PII (owner name, phone, email, city). The
    // server already holds the canonical pending-signup row; this is just a
    // soft-nav handoff that the signup form reads via usePendingSignup.
    memoryCacheSet(PENDING_SIGNUP_KEY, {
      centerName: p.center_name,
      ownerName: p.owner_name,
      phone,
      email: p.email,
      city: p.city,
      plan: p.plan_key,
      billingPeriod: p.billing_period,
      referralCode: p.referral_code ?? '',
      notes: '',
      stage,
    });
    router.push('/signup');
  };

  return (
    <div
      data-chq-login
      style={{
        background: 'var(--color-surface-0)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: '16px', insetInlineEnd: '16px' }}>
        <button
          type="button"
          onClick={handleLocaleToggle}
          disabled={isPending}
          aria-label={t('localeToggleAria')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <Globe size={13} className="shrink-0" aria-hidden />
          <span style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }} dir="ltr">
            {locale === 'ar' ? 'EN' : 'AR'}
          </span>
        </button>
      </div>

      <div style={{ marginBottom: '44px' }}>
        <span
          style={{
            fontFamily: "var(--font-bodoni), 'Bodoni Moda', Georgia, serif",
            fontWeight: 700,
            letterSpacing: '2px',
            fontSize: '14px',
          }}
        >
          <span style={{ color: 'var(--color-text-primary)' }}>Tutoring</span>
          <span style={{ color: 'var(--color-teal)' }}>HQ</span>
        </span>
      </div>

      <div style={{ width: '100%', maxWidth: '360px' }}>
        <form onSubmit={handleLogin} style={{ width: '100%' }}>
          <div
            style={{
              ...SANS,
              fontSize: '10px',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '2px',
              textAlign: 'center',
              marginBottom: '8px',
            }}
          >
            {t('welcomeBack')}
          </div>

          <h1
            style={{
              ...PLAYFAIR,
              fontSize: '26px',
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              textAlign: 'center',
              letterSpacing: '-0.3px',
              lineHeight: '1.2',
              marginBottom: '40px',
            }}
          >
            {t('headline')}
          </h1>

          <div style={{ marginBottom: '32px' }}>
            <label
              style={{
                ...SANS,
                fontSize: '9px',
                color: 'var(--color-teal)',
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                fontWeight: 700,
                display: 'block',
                marginBottom: '8px',
              }}
            >
              {t('phone')}
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '10px',
                gap: '10px',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-text-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
                aria-hidden
              >
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.01 2.21 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
              </svg>
              <input
                key={phoneFieldId}
                name={`login-phone-${phoneFieldId}`}
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => {
                  let value = e.target.value.replace(/[^0-9+]/g, '');
                  if (value.length === 1 && value !== '+') {
                    value = '+20' + value;
                  }
                  if (value.length <= 13) {
                    setPhone(value);
                  }
                  setError('');
                  setResumeSignup(null);
                }}
                placeholder="+20 1XXXXXXXXX"
                autoComplete="off"
                data-1p-ignore
                data-lpignore="true"
                dir="ltr"
                required
                style={{
                  ...PLAYFAIR,
                  flex: 1,
                  background: 'transparent',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-primary)',
                  fontSize: '15px',
                  outline: 'none',
                  WebkitTextFillColor: 'var(--color-text-primary)',
                  WebkitBoxShadow: '0 0 0px 1000px var(--color-surface-0) inset',
                  caretColor: 'var(--color-text-primary)',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '32px' }} className={shakePin ? 'micro-shake' : undefined}>
            <label
              style={{
                ...SANS,
                fontSize: '9px',
                color: 'var(--color-teal)',
                textTransform: 'uppercase',
                letterSpacing: '1.5px',
                fontWeight: 700,
                display: 'block',
                marginBottom: '8px',
              }}
            >
              {t('pin')}
            </label>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '10px',
                gap: '10px',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-text-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
                aria-hidden
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <input
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9]/g, '');
                  if (value.length <= 6) setPin(value);
                  setError('');
                }}
                placeholder="••••••"
                autoComplete="current-password"
                dir="ltr"
                required
                style={{
                  ...PLAYFAIR,
                  flex: 1,
                  background: 'transparent',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-primary)',
                  fontSize: '15px',
                  outline: 'none',
                  WebkitTextFillColor: 'var(--color-text-primary)',
                  WebkitBoxShadow: '0 0 0px 1000px var(--color-surface-0) inset',
                  caretColor: 'var(--color-text-primary)',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0,
                  color: 'var(--color-text-muted)',
                }}
                aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error ? (
            <div
              style={{
                marginBottom: '16px',
                padding: '10px 14px',
                borderRadius: '10px',
                border: resumeSignup ? '1px solid var(--color-border-brand)' : '1px solid rgba(220,38,38,0.35)',
                background: resumeSignup ? 'var(--color-teal-soft)' : 'rgba(220,38,38,0.08)',
              }}
            >
              <p
                style={{
                  ...SANS,
                  fontSize: '12px',
                  color: resumeSignup ? 'var(--color-teal-deep)' : '#b91c1c',
                  marginBottom: resumeSignup ? '10px' : 0,
                }}
              >
                {resumeSignup ? t('resumeSignupHint') : error}
              </p>
              {resumeSignup ? (
                <button
                  type="button"
                  onClick={handleResumeSignup}
                  style={{
                    ...PLAYFAIR,
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: 'var(--color-teal)',
                    color: 'white',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {t('resumeSignupCta')}
                </button>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isLoading || !phone || !pin}
            style={{
              ...PLAYFAIR,
              width: '100%',
              padding: '15px',
              borderRadius: '12px',
              background: 'var(--color-teal)',
              color: 'white',
              border: 'none',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
              opacity: isLoading || !phone || !pin ? 0.4 : 1,
              transition: 'opacity 0.2s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              letterSpacing: '0.2px',
            }}
          >
            {isLoading ? (
              <div
                style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(255,255,255,0.3)',
                  borderTopColor: 'white',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
            ) : (
              t('submit')
            )}
          </button>

          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: '28px',
              marginBottom: '28px',
            }}
          >
            <div
              style={{
                width: '40px',
                height: '1px',
                background: 'var(--color-border)',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <Link
              href="/forgot-password"
              className="chq-login-forgot-link"
              style={{
                ...SANS,
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              {t('forgotPin')}
            </Link>
            <Link
              href="/signup"
              style={{
                ...SANS,
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              {t('noAccount')}
            </Link>
            <Link
              href="/teacher/landing"
              style={{
                ...SANS,
                fontSize: '11px',
                color: 'var(--color-text-muted)',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              {t('teacherStartHere')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
