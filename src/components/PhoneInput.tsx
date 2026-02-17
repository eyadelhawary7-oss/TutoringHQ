'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface PhoneInputProps {
  onSubmit: (phone: string) => void;
  isLoading: boolean;
  error?: string;
}

export default function PhoneInput({ onSubmit, isLoading, error }: PhoneInputProps) {
  const t = useTranslations('login');
  const [phone, setPhone] = useState('');
  const [validationError, setValidationError] = useState('');

  const formatPhoneToInternational = (input: string): string => {
    let cleaned = input.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    return '+20' + cleaned;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError('');

    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
    if (cleaned.length !== 10 || !/^1[0125][0-9]{8}$/.test(cleaned)) {
      setValidationError(t('invalidPhone'));
      return;
    }

    const internationalPhone = formatPhoneToInternational(phone);
    onSubmit(internationalPhone);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="phone"
          className="block text-sm font-medium text-text-primary mb-2"
        >
          {t('phoneLabel')}
        </label>
        <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-bg-tertiary" dir="ltr">
          <span className="text-text-secondary font-medium shrink-0 text-sm select-none">+20</span>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, ''));
              setValidationError('');
            }}
            placeholder="1XXXXXXXXX"
            className="flex-1 outline-none text-sm bg-transparent text-text-primary"
            maxLength={10}
            required
          />
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          {t('phoneHint', { defaultValue: 'Enter without the leading zero' })}
        </p>
        {(validationError || error) && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {validationError || error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || phone.length < 10}
        className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-lg shadow-md hover:shadow-lg transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2 min-h-[48px]"
      >
        {isLoading ? (
          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : null}
        {isLoading ? t('otpSent') : t('sendOTP')}
      </button>
    </form>
  );
}
