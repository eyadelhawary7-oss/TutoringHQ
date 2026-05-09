'use client';

import { useState, FormEvent, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { Globe } from 'lucide-react';

export default function LoginPage() {
  const t = useTranslations('login');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

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

      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: lookupData.email,
        password: pin,
      });

      if (loginError) {
        setError(t('invalidCredentials'));
        shakePinField();
        setIsLoading(false);
        return;
      }

      if (data.user) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) return;

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

        if (result.centerId) {
          let targetLocale = 'ar';
          try {
            const { data: userData } = await supabase
              .from('users')
              .select('preferred_locale')
              .eq('id', data.user.id)
              .maybeSingle();
            if (userData?.preferred_locale === 'ar' || userData?.preferred_locale === 'en') {
              targetLocale = userData.preferred_locale;
            }
          } catch {
            // Fallback silently - never block login
          }
          const targetPath = result.needsOnboarding ? '/onboarding' : '/dashboard';
          router.push(targetPath, { locale: targetLocale as 'en' | 'ar' });
        } else if (result.contactSales) {
          setError(t('contactSales'));
          shakePinField();
        } else {
          let targetLocale = 'ar';
          try {
            const { data: userData } = await supabase
              .from('users')
              .select('preferred_locale')
              .eq('id', data.user.id)
              .maybeSingle();
            if (userData?.preferred_locale === 'ar' || userData?.preferred_locale === 'en') {
              targetLocale = userData.preferred_locale;
            }
          } catch {
            // Fallback silently - never block login
          }
          router.push('/onboarding', { locale: targetLocale as 'en' | 'ar' });
        }
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
    try {
      sessionStorage.setItem(
        'chq_pending_signup_v1',
        JSON.stringify({
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
        }),
      );
    } catch {
      //
    }
    router.push('/signup');
  };

  return (
    <div
      data-chq-login
      style={{
        background: '#080D14',
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
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '8px',
            fontSize: '12px',
            fontWeight: 500,
            border: '1px solid rgba(148, 163, 184, 0.35)',
            color: 'rgba(226, 232, 240, 0.85)',
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

      <div
        style={{
          width: '56px',
          height: '56px',
          border: '2px solid #0D9488',
          borderRadius: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '12px',
        }}
      >
        <span
          style={{
            ...PLAYFAIR,
            color: '#0D9488',
            fontWeight: 900,
            fontSize: '18px',
          }}
        >
          CH
        </span>
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
          <span style={{ color: '#f8fafc' }}>CENTER</span>
          <span style={{ color: '#0D9488' }}>HQ</span>
        </span>
      </div>

      <div style={{ width: '100%', maxWidth: '360px' }}>
        <form onSubmit={handleLogin} style={{ width: '100%' }}>
          <div
            style={{
              ...SANS,
              fontSize: '10px',
              color: '#64748b',
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
              color: '#f8fafc',
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
                color: '#0D9488',
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
                borderBottom: '1px solid #1e293b',
                paddingBottom: '10px',
                gap: '10px',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#475569"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ flexShrink: 0 }}
                aria-hidden
              >
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.81 19.79 19.79 0 01.01 2.21 2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92v2z" />
              </svg>
              <input
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
                dir="ltr"
                required
                style={{
                  ...PLAYFAIR,
                  flex: 1,
                  background: 'transparent',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#f8fafc',
                  fontSize: '15px',
                  outline: 'none',
                  WebkitTextFillColor: '#f8fafc',
                  WebkitBoxShadow: '0 0 0px 1000px #080D14 inset',
                  caretColor: '#f8fafc',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '32px' }} className={shakePin ? 'micro-shake' : undefined}>
            <label
              style={{
                ...SANS,
                fontSize: '9px',
                color: '#0D9488',
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
                borderBottom: '1px solid #1e293b',
                paddingBottom: '10px',
                gap: '10px',
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#475569"
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
                  color: '#f8fafc',
                  fontSize: '15px',
                  outline: 'none',
                  WebkitTextFillColor: '#f8fafc',
                  WebkitBoxShadow: '0 0 0px 1000px #080D14 inset',
                  caretColor: '#f8fafc',
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
                  color: '#475569',
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
                border: resumeSignup ? '1px solid rgba(45,212,191,0.35)' : '1px solid rgba(239,68,68,0.3)',
                background: resumeSignup ? 'rgba(13,148,136,0.12)' : 'rgba(127,29,29,0.2)',
              }}
            >
              <p
                style={{
                  ...SANS,
                  fontSize: '12px',
                  color: resumeSignup ? '#99f6e4' : '#f87171',
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
                    background: '#0D9488',
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
              background: '#0D9488',
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
                background: '#0f172a',
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
                color: '#64748b',
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
                color: '#64748b',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              {t('noAccount')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
