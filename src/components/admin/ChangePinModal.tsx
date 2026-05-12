'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';

interface ChangePinModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangePinModal({ isOpen, onClose }: ChangePinModalProps) {
  const tSettings = useTranslations('settings');
  const tPin = useTranslations('settings.pin');
  const tResetPassword = useTranslations('resetPassword');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const resetForm = () => {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    if (!/^\d{6}$/.test(newPin)) {
      setError(tPin('errorMinDigits'));
      return;
    }
    if (newPin !== confirmPin) {
      setError(tPin('errorMismatch'));
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error(tPin('errorUserNotFound'));

      const res = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ currentPin, newPin }),
      });

      if (res.status === 429) {
        setError(tPin('errorGeneric'));
        return;
      }

      const json = await res.json() as { error?: string; ok?: boolean };

      if (!res.ok) {
        if (json.error === 'weak_pin') {
          setError(tResetPassword('weakPin'));
        } else if (json.error === 'wrong_current_pin') {
          setError(tPin('errorCurrentInvalid'));
        } else if (json.error === 'invalid_format') {
          setError(tPin('errorMinDigits'));
        } else {
          setError(tPin('errorGeneric'));
        }
        return;
      }

      setSuccess(true);
      setTimeout(() => handleClose(), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : tPin('errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const fields = [
    { fieldKey: 'currentPin' as const, value: currentPin, setter: setCurrentPin },
    { fieldKey: 'newPin' as const, value: newPin, setter: setNewPin },
    { fieldKey: 'confirmPin' as const, value: confirmPin, setter: setConfirmPin },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        className="modal-spring-in bg-[var(--color-surface-1)] rounded-2xl p-6 w-full max-w-sm space-y-4"
        dir={dir}
      >
        <h2 className="text-lg font-bold text-[var(--color-text-primary)]">{tSettings('changePin')}</h2>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
        )}
        {success && (
          <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
            {tPin('updateSuccess')}
          </p>
        )}

        {fields.map(({ fieldKey, value, setter }) => (
          <div key={fieldKey} className="space-y-1">
            <label className="text-sm font-medium text-[var(--color-text-primary)] block">
              {tPin(fieldKey)}
            </label>
            <input
              type="password"
              inputMode="numeric"
              value={value}
              onChange={(e) => setter(e.target.value)}
              disabled={loading || success}
              className="w-full px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
              dir="ltr"
            />
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-0)]"
          >
            {tCommon('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || success}
            className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 disabled:opacity-50"
          >
            {loading ? '...' : tPin('updatePin')}
          </button>
        </div>
      </div>
    </div>
  );
}
