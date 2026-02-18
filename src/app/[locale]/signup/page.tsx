'use client';

import { useState, FormEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import LanguageToggle from '@/components/LanguageToggle';

const WHATSAPP_ADMIN = 'https://wa.me/201220601410';

type PlanOption = { value: string; name: string; price: string; students: string; setupFee: string; isCustom?: boolean };

export default function SignupPage() {
  const [formData, setFormData] = useState({
    centerName: '',
    ownerName: '',
    phone: '',
    city: '',
    plan: 'STARTER' as string,
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const t = useTranslations('signup');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let phone = formData.phone.replace(/\s/g, '').replace(/\D/g, '');
      if (!phone.startsWith('+')) {
        if (phone.startsWith('0')) phone = '+20' + phone.substring(1);
        else if (!phone.startsWith('20')) phone = '+20' + phone;
        else phone = '+' + phone;
      }
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, phone }),
      });
      const data = await response.json();
      if (response.ok) {
        setSubmitted(true);
      } else {
        setError(data.error || 'Signup failed');
      }
    } catch (err) {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-white" data-theme="light">
        <div className="fixed bottom-4 right-4 z-50">
          <LanguageToggle />
        </div>
        <div className="min-h-screen flex flex-col items-center justify-center px-4">
          <div className="max-w-md w-full">
            <div className="text-center mb-8">
              <Link href="/" className="inline-block mb-4">
                <Image src="/logo-icon.png" alt="CenterHQ" width={64} height={64} className="w-16 h-16 mx-auto mb-3 object-contain" />
                <h1 className="text-2xl font-bold text-text-primary">CenterHQ</h1>
              </Link>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xl p-8 text-center">
              <div className="mb-6">
                <svg className="w-20 h-20 text-green-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-text-primary mb-4">{t('requestSubmitted')}</h2>
              <p className="text-text-secondary mb-6">{t('receivedRequest')}</p>
              <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg p-6 mb-6 text-start">
                <h3 className="font-semibold text-text-primary mb-3 text-center">{t('nextStepsTitle')}</h3>
                <ol className="space-y-3 text-text-secondary">
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm">1</span>
                    <span>{t('step1')}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm">2</span>
                    <span>{t('step2')}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm">3</span>
                    <span>{t('step3')}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-600 text-white rounded-full flex items-center justify-center text-sm">4</span>
                    <span>{t('step4')}</span>
                  </li>
                </ol>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
                <p className="text-text-primary font-medium mb-2">{t('contactInfo')}</p>
                <p className="text-text-secondary text-lg font-bold" dir="ltr">{formData.phone}</p>
              </div>
              <a
                href={WHATSAPP_ADMIN}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-green-600 hover:underline"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
                </svg>
                {t('contactUsWhatsApp')}
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" data-theme="light">
      <div className="fixed bottom-4 right-4 z-50">
        <LanguageToggle />
      </div>
      <div className="min-h-screen flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block mb-4">
              <Image src="/logo-icon.png" alt="CenterHQ" width={64} height={64} className="w-16 h-16 mx-auto mb-3 object-contain" />
              <h1 className="text-3xl font-bold text-text-primary mb-2">{t('title')}</h1>
            </Link>
            <p className="text-text-secondary">{t('subtitle')}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 shadow-xl p-8">
            {error && (
              <div className="bg-red-500/10 border border-red-500 text-red-600 dark:text-red-400 p-3 rounded-lg mb-6">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-text-secondary mb-2 font-medium">{t('centerName')} *</label>
                <input
                  type="text"
                  value={formData.centerName}
                  onChange={(e) => setFormData({ ...formData, centerName: e.target.value })}
                  placeholder={t('centerNamePlaceholder')}
                  required
                  className="w-full px-4 py-3 bg-white border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-text-primary"
                />
              </div>
              <div>
                <label className="block text-text-secondary mb-2 font-medium">{t('ownerName')} *</label>
                <input
                  type="text"
                  value={formData.ownerName}
                  onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                  placeholder={t('ownerNamePlaceholder')}
                  required
                  className="w-full px-4 py-3 bg-white border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-text-primary"
                />
              </div>
              <div>
                <label className="block text-text-secondary mb-2 font-medium">{t('phone')} (WhatsApp) *</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+20 1XXXXXXXXX"
                  required
                  dir="ltr"
                  className="w-full px-4 py-3 bg-white border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-text-primary"
                />
                <p className="text-text-secondary text-sm mt-1">{t('phoneHelper')}</p>
              </div>
              <div>
                <label className="block text-text-secondary mb-2 font-medium">{t('city')} *</label>
                <select
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  required
                  className="w-full px-4 py-3 bg-white border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-text-primary"
                >
                  <option value="">{t('selectCity')}</option>
                  <option value="Cairo">القاهرة - Cairo</option>
                  <option value="Giza">الجيزة - Giza</option>
                  <option value="Alexandria">الإسكندرية - Alexandria</option>
                  <option value="Qalyubia">القليوبية - Qalyubia</option>
                  <option value="6th October">6 أكتوبر - 6th October</option>
                  <option value="Nasr City">مدينة نصر - Nasr City</option>
                  <option value="Heliopolis">مصر الجديدة - Heliopolis</option>
                  <option value="Other">أخرى - Other</option>
                </select>
              </div>
              <div>
                <label className="block text-text-secondary mb-2 font-medium">{t('selectPlan')} *</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { value: 'STARTER', name: 'STARTER', price: '2,000', students: '150', setupFee: '1,000' },
                    { value: 'PRO', name: 'PRO', price: '4,500', students: '500', setupFee: '2,000' },
                    { value: 'BUSINESS', name: 'BUSINESS', price: '6,500', students: '1,000', setupFee: '3,000' },
                    { value: 'ENTERPRISE', name: 'ENTERPRISE', price: '9,000', students: '2,000', setupFee: '5,000' },
                    { value: 'TOP_CENTERS', name: 'TOP CENTERS', price: 'Custom', students: '2,000+', setupFee: 'Custom', isCustom: true },
                  ].map((plan) => (
                    <label
                      key={plan.value}
                      className={`cursor-pointer border-2 rounded-lg p-4 transition ${
                        formData.plan === plan.value
                          ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                          : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400'
                      }`}
                      onClick={(e) => {
                        if ((plan as PlanOption).isCustom) {
                          e.preventDefault();
                          window.open('https://wa.me/201220601410?text=I%20am%20interested%20in%20the%20TOP%20CENTERS%20plan', '_blank');
                        }
                      }}
                    >
                      <input
                        type="radio"
                        name="plan"
                        value={plan.value}
                        checked={formData.plan === plan.value}
                        onChange={(e) => {
                          if (!(plan as PlanOption).isCustom) {
                            setFormData({ ...formData, plan: e.target.value });
                          }
                        }}
                        className="sr-only"
                        disabled={(plan as PlanOption).isCustom}
                      />
                      <div className="font-bold text-text-primary mb-1">{plan.name}</div>
                      <div className="text-2xl font-bold text-indigo-600 mb-1" dir="ltr">
                        {plan.price === 'Custom' ? (
                          <span>Custom Pricing</span>
                        ) : (
                          <>
                            EGP {plan.price}<span className="text-sm text-text-tertiary">/mo</span>
                          </>
                        )}
                      </div>
                      <div className="text-text-secondary text-sm mb-2">
                        {plan.students.includes('+') ? `${plan.students} ${t('students')}` : `${t('upTo')} ${plan.students} ${t('students')}`}
                      </div>
                      <div className="text-text-tertiary text-xs">
                        {t('setupFee')}: {plan.setupFee === 'Custom' ? 'Contact us' : `EGP ${plan.setupFee}`}
                      </div>
                      {(plan as PlanOption).isCustom && (
                        <div className="mt-2 text-green-600 text-sm font-medium">
                          → Click to contact on WhatsApp
                        </div>
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-text-secondary mb-2 font-medium">
                  {t('notes')} ({t('optional')})
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder={t('notesPlaceholder')}
                  rows={3}
                  className="w-full px-4 py-3 bg-white border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 text-text-primary"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-4 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition text-lg"
              >
                {loading ? t('submitting') : t('submitRequest')}
              </button>
              <p className="text-text-secondary text-sm text-center">
                {t('alreadyHaveAccount')}{' '}
                <Link href="/login" className="text-indigo-600 hover:underline font-medium">
                  {t('login')}
                </Link>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
