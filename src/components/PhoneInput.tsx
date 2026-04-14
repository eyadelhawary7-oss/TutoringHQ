'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Phone } from 'lucide-react';

interface PhoneInputProps {
  onSubmit: (phone: string) => void;
  isLoading: boolean;
  error?: string;
  /** Overrides default login.sendOTP label (e.g. forgot-password flow). */
  submitLabel?: string;
  /** When set, overrides `login` namespace phone label/hint (e.g. forgot-password). */
  phoneLabel?: string;
  phoneHint?: string;
}

export default function PhoneInput({
  onSubmit,
  isLoading,
  error,
  submitLabel,
  phoneLabel: phoneLabelOverride,
  phoneHint: phoneHintOverride,
}: PhoneInputProps) {
  const t = useTranslations('login');
  const tc = useTranslations('common');
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
        <label htmlFor="phone" className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
          {phoneLabelOverride ?? t('phoneLabel')}
        </label>
        <div className="relative" dir="ltr">
          <Phone size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-[var(--color-text-secondary)] pointer-events-none" />
          <div className="flex items-center w-full ps-9 pe-4 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]">
            <span className="text-[var(--color-text-secondary)] font-medium shrink-0 text-sm select-none me-2">+20</span>
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
              className="flex-1 min-w-0 bg-transparent outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] text-sm"
              maxLength={10}
              required
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          {phoneHintOverride ?? t('phoneHint')}
        </p>
        {(validationError || error) && (
          <p className="mt-2 text-sm" style={{ color: 'hsl(var(--destructive))' }}>
            {validationError || error}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isLoading || phone.length < 10}
        className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        style={{ background: 'hsl(var(--primary))' }}
      >
        {isLoading ? (
          <svg className="animate-spin h-5 w-5 text-white shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : null}
        {isLoading ? tc('loading') : (submitLabel ?? t('sendOTP'))}
      </button>
    </form>
  );
}
