'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';
import { toAr } from '@/lib/number-utils';

const TOP_CENTERS_WHATSAPP = 'https://wa.me/201220601410?text=مرحباً، أنا مهتم بخطة كبار السناتر لأكثر من 2000 طالب أسبوعياً';

type Plan = 'starter' | 'pro' | 'business' | 'enterprise';

const PLAN_OPTIONS: { id: Plan; price: number; limitKey: string }[] = [
  { id: 'starter', price: 2000, limitKey: 'starterLimit' },
  { id: 'pro', price: 4500, limitKey: 'proLimit' },
  { id: 'business', price: 6500, limitKey: 'businessLimit' },
  { id: 'enterprise', price: 9000, limitKey: 'enterpriseLimit' },
];

export default function SignupPage() {
  const t = useTranslations('signup');
  const tLanding = useTranslations('landing');
  const router = useRouter();
  const locale = useLocale();

  const [formData, setFormData] = useState({
    centerName: '',
    phone: '',
    email: '',
    plan: 'starter' as Plan,
    termsAccepted: false,
    referralCode: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [earlyAdopterSpots, setEarlyAdopterSpots] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/pricing-plans')
      .then((r) => r.json())
      .then((d) => setEarlyAdopterSpots(d.early_adopter_spots_remaining ?? null))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!formData.termsAccepted) {
      setError(t('terms'));
      return;
    }
    let cleanPhone = formData.phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = cleanPhone.substring(1);
    if (cleanPhone.length !== 10 || !/^1[0125][0-9]{8}$/.test(cleanPhone)) {
      setError(t('invalidPhone'));
      return;
    }
    const code = formData.referralCode.trim();
    if (code && code.length !== 8) {
      setError(t('referralCodeInvalid'));
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          centerName: formData.centerName.trim(),
          phone: '+20' + cleanPhone,
          email: formData.email.trim() || undefined,
          plan: formData.plan,
          termsAccepted: formData.termsAccepted,
          referralCode: formData.referralCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error === 'referralCodeInvalid' ? t('referralCodeInvalid') : (data.error || t('error')));
        return;
      }
      setSuccess(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setError(t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  const formatNum = (n: number) => (locale === 'ar' ? toAr(n) : n.toLocaleString());

  if (success) {
    return (
      <div className="min-h-screen bg-white" data-theme="light">
        <div className="absolute top-4 end-4 z-10">
          <LanguageToggle />
        </div>
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <div className="max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-text-primary mb-3">
              {t('success')}
            </h1>
            <p className="text-text-secondary mb-6">
              {t('successMessage')}
            </p>
            <Link
              href="/"
              className="inline-block py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg"
            >
              {tLanding('backToHome')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" data-theme="light">
      <div className="absolute top-4 end-4 z-10">
        <LanguageToggle />
      </div>

      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <Image src="/logo-icon.png" alt="CenterHQ" width={64} height={64} className="w-16 h-16 mx-auto mb-3 object-contain" />
              <h1 className="text-3xl font-bold text-text-primary">
                CenterHQ
              </h1>
              <p className="text-sm text-indigo-600 mt-1">
                {tLanding('subtitle')}
              </p>
            </Link>
          </div>

          {earlyAdopterSpots != null && earlyAdopterSpots > 0 && (
            <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-center">
              <p className="font-semibold">🎉 {t('earlyAdopterBanner', { defaultValue: 'Only {count} early adopter spots remaining!', count: earlyAdopterSpots })}</p>
              <p className="text-sm mt-1">{t('earlyAdopterDiscount', { defaultValue: '40% discount locked in forever for the first 10 centers.' })}</p>
            </div>
          )}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl p-8">
            <h2 className="text-xl font-bold text-text-primary mb-6 text-center">
              {t('title')}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  {t('centerName')} *
                </label>
                <input
                  type="text"
                  required
                  value={formData.centerName}
                  onChange={(e) => { setFormData({ ...formData, centerName: e.target.value }); setError(''); }}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-text-primary"
                  placeholder="اسم السنتر"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  {t('phone')} *
                </label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={formData.phone}
                  onChange={(e) => {
                    let v = e.target.value.replace(/\D/g, '');
                    if (v.startsWith('0') && v.length > 1) v = v.substring(1);
                    setFormData({ ...formData, phone: v }); setError('');
                  }}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-text-primary"
                  placeholder="1220601310"
                />
                <p className="mt-1 text-xs text-text-secondary">
                  {locale === 'ar' ? 'ادخل الرقم بدون الصفر' : 'Enter without the leading zero'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  {t('email')}
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-text-primary"
                  placeholder="email@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  {t('referralCode')}
                </label>
                <input
                  type="text"
                  maxLength={8}
                  value={formData.referralCode}
                  onChange={(e) => { setFormData({ ...formData, referralCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }); setError(''); }}
                  className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-text-primary font-mono tracking-widest"
                  placeholder="XXXXXXXX"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  {t('selectPlan')} *
                </label>
                <div className="space-y-3">
                  {PLAN_OPTIONS.map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-3 p-4 bg-white border rounded-lg cursor-pointer transition-colors ${
                        formData.plan === opt.id
                          ? 'border-indigo-600 ring-2 ring-indigo-500/20'
                          : 'border-gray-200 hover:border-indigo-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="plan"
                        value={opt.id}
                        checked={formData.plan === opt.id}
                        onChange={() => setFormData({ ...formData, plan: opt.id })}
                        className="mt-1 w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div className="flex-1">
                        <span className="block text-text-primary font-medium">
                          {t(opt.id)} — EGP {formatNum(opt.price)}/month
                        </span>
                        <span className="block text-sm text-text-secondary mt-0.5">
                          {t(opt.limitKey)}
                        </span>
                      </div>
                    </label>
                  ))}
                  <a
                    href={TOP_CENTERS_WHATSAPP}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-4 border-2 rounded-lg transition-colors block bg-white"
                    style={{ borderColor: '#25D366', backgroundColor: 'rgba(37, 211, 102, 0.08)' }}
                  >
                    <span className="mt-1 flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(37, 211, 102, 0.2)' }}>
                      <svg className="w-6 h-6" style={{ color: '#25D366' }} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                      </svg>
                    </span>
                    <div className="flex-1">
                      <span className="block text-text-primary font-medium">
                        {tLanding('planTopCenters')}
                      </span>
                      <span className="block text-sm text-text-secondary mt-0.5">
                        {t('topCentersDesc')}
                      </span>
                    </div>
                    <span className="mt-2 px-3 py-1.5 text-sm font-medium rounded-lg text-white" style={{ backgroundColor: '#25D366' }}>
                      {t('contactWhatsApp', { defaultValue: 'Contact via WhatsApp' })}
                    </span>
                  </a>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.termsAccepted}
                  onChange={(e) => { setFormData({ ...formData, termsAccepted: e.target.checked }); setError(''); }}
                  className="mt-1 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-text-secondary">
                  {t('terms')}
                </span>
              </label>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '...' : t('submit')}
              </button>
            </form>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-text-secondary">
              {t('hasAccount')}{' '}
              <Link href="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
                {tLanding('loginButton')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
