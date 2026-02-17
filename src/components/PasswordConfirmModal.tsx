'use client';

import { useState } from 'react';
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
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    await onConfirm(password);
  };

  const handleClose = () => {
    setPassword('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
      onClick={handleClose}
    >
      <div
        className="glass rounded-xl shadow-xl max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
        {message && (
          <p className="text-sm text-[var(--text-secondary)] mb-4">{message}</p>
        )}
        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            {t('password', { defaultValue: 'Password' })}
          </label>
          <input
            type={type}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder', { defaultValue: 'Enter your password' })}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-bg-tertiary text-text-primary mb-4"
            autoComplete="current-password"
            autoFocus
            disabled={loading}
          />
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!password.trim() || loading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? t('loading') : t('confirm')}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 glass rounded-lg"
            >
              {t('cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
