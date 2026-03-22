'use client';

import { useState, FormEvent, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter, usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { Eye, EyeOff, Phone, Lock, Globe } from 'lucide-react';

export default function LoginPage() {
  const t = useTranslations('login');
  const tc = useTranslations('common');
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
      const lookupData = await lookupRes.json();

      if (!lookupRes.ok || !lookupData.email) {
        setError(lookupData.error || t('phoneNotFound'));
        shakePinField();
        setIsLoading(false);
        return;
      }

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
        const { data: { session } } = await supabase.auth.getSession();
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
            // Fallback silently — never block login
          }
          const targetPath = result.needsOnboarding ? '/onboarding' : '/dashboard';
          router.push(`/${targetLocale}${targetPath}`);
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
            // Fallback silently — never block login
          }
          router.push(`/${targetLocale}/onboarding`);
        }
      }
    } catch {
      setError(t('invalidCredentials'));
      shakePinField();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12" style={{ background: 'var(--gradient-hero)' }}>
      {/* Language toggle */}
      <div className="absolute top-4 end-4">
        <button
          onClick={handleLocaleToggle}
          disabled={isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-white/20 text-white/70 hover:text-white transition-colors"
        >
          <Globe size={13} />
          <span>{locale === 'ar' ? 'EN' : 'ع'}</span>
        </button>
      </div>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-black text-2xl mb-4 shadow-lg" style={{ background: 'hsl(var(--primary))' }}>
            CH
          </div>
          <h1 className="text-2xl font-black text-white">CenterHQ</h1>
          <p className="text-white/50 text-sm mt-1">{t('title')}</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 p-6 shadow-xl" style={{ background: 'hsl(var(--card) / 0.95)', backdropFilter: 'blur(20px)' }}>
          <form onSubmit={handleLogin} className="space-y-4">
            {/* Phone */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('phone')}</label>
              <div className="relative">
                <Phone size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
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
                  }}
                  placeholder={t('phonePlaceholder')}
                  className="w-full ps-9 pe-4 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
                  dir="ltr"
                  required
                  autoComplete="tel"
                />
              </div>
            </div>

            {/* PIN */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">{t('pin')}</label>
              <div className={`relative ${shakePin ? 'micro-shake' : ''}`}>
                <Lock size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
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
                  placeholder={t('pinPlaceholder')}
                  className="w-full ps-9 pe-10 py-2.5 rounded-lg border border-input bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring transition-shadow font-mono tracking-widest"
                  dir="ltr"
                  required
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="absolute top-1/2 -translate-y-1/2 end-3 text-muted-foreground hover:text-foreground"
                >
                  {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Demo hint */}
            <p className="text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2">
              <span className="font-semibold">Demo:</span> 01000000000 / 123456
            </p>

            {/* Error */}
            {error && (
              <div className="rounded-lg px-3 py-2.5 text-sm font-medium" style={{ background: 'hsl(var(--destructive) / 0.1)', color: 'hsl(var(--destructive))' }}>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
              style={{ background: 'hsl(var(--primary))' }}
            >
              {isLoading ? tc('loading') : t('submit')}
            </button>

            {/* Forgot PIN */}
            <div className="text-center">
              <Link href="/forgot-password" className="text-sm hover:underline" style={{ color: 'hsl(var(--primary))' }}>
                {t('forgotPin')}
              </Link>
            </div>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t('noAccount')}{' '}
            <Link href="/signup" className="font-semibold hover:underline" style={{ color: 'hsl(var(--primary))' }}>
              {t('registerLink')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
