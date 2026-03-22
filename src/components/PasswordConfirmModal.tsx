'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';

interface PasswordConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void | Promise<void>;
  title: string;
  message?: string;
  loading?: boolean;
  error?: string;
  /** Mask input as password (default: true) */
  type?: 'password' | 'text';
}

export default function PasswordConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  loading = false,
  error,
  type = 'password',
}: PasswordConfirmModalProps) {
  const t = useTranslations('common');
  const [pin, setPin] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    await onConfirm(pin);
  };

  const handleClose = () => {
    setPin('');
    onClose();
  };

  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ background: 'rgba(0, 0, 0, 0.5)', zIndex: 9999 }}
      onClick={handleClose}
    >
      <div
        className="modal-spring-in rounded-xl shadow-xl max-w-sm w-full p-6 bg-[var(--color-surface-1)]"
        style={{ opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
        {message && (
          <p className="text-sm text-[var(--text-secondary)] mb-4">{message}</p>
        )}
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('pin', { defaultValue: 'PIN' })}
          </label>
          <input
            type={type}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t('pinPlaceholder', { defaultValue: 'Enter your PIN' })}
            className="w-full px-3 py-2 border border-[var(--color-border-default)] rounded-lg bg-[var(--color-surface-1)] text-[var(--text-primary)] mb-4"
            autoComplete="current-password"
            autoFocus
            disabled={loading}
          />
          {error && (
            <p className="text-sm text-red-600 mb-3">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!pin.trim() || loading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? t('loading') : t('confirm')}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 bg-[var(--color-surface-1)] border border-[var(--color-border-default)] rounded-lg hover:bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return mounted && typeof document !== 'undefined'
    ? createPortal(modal, document.body)
    : null;
}
