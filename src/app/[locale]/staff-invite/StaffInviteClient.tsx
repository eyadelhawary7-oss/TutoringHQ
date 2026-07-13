'use client';

import { useState } from 'react';
import PublicLocaleToggle from '@/components/PublicLocaleToggle';

type Labels = {
  header: string;
  helper: string;
  invitedAs: string;
  nameLabel: string;
  phoneLabel: string;
  emailLabel: string;
  emailOptional: string;
  submit: string;
  submitting: string;
  successHeader: string;
  successHelper: string;
  invalidHeader: string;
  invalidHelper: string;
  errorGeneric: string;
  errorPhone: string;
  errorName: string;
};

type Props = {
  locale: 'ar' | 'en';
  mode: 'form' | 'invalid';
  token: string;
  roleLabel: string;
  labels: Labels;
};

const EG_PHONE = /^1[0125]\d{8}$/;

function normalizeLocalPhone(v: string): string {
  const d = v.replace(/\D/g, '');
  if (d.startsWith('0')) return d.slice(1);
  if (d.startsWith('20')) return d.slice(2);
  return d;
}

export default function StaffInviteClient({ locale, mode, token, roleLabel, labels }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError(labels.errorName);
      return;
    }
    if (!EG_PHONE.test(normalizeLocalPhone(phone))) {
      setError(labels.errorPhone);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/staff-invite/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          name: name.trim(),
          phone: phone.replace(/\D/g, ''),
          email: email.trim() || undefined,
        }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      setError(labels.errorGeneric);
    } catch {
      setError(labels.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      dir={dir}
      className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--color-surface-0)]"
    >
      <div className="absolute top-4 end-4">
        <PublicLocaleToggle />
      </div>
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 md:p-8">
        {mode === 'invalid' ? (
          <div className="text-center">
            <h1 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
              {labels.invalidHeader}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">{labels.invalidHelper}</p>
          </div>
        ) : done ? (
          <div className="text-center">
            <h1 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
              {labels.successHeader}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)]">{labels.successHelper}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">
              {labels.header}
            </h1>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">{labels.helper}</p>
            {roleLabel && (
              <div className="mb-4 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border-subtle)] px-3 py-2 text-sm">
                <span className="text-[var(--color-text-muted)]">{labels.invitedAs} </span>
                <span className="font-semibold text-[var(--color-text-primary)]">{roleLabel}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {labels.nameLabel}
                </label>
                <input
                  value={name}
                  onChange={(ev) => setName(ev.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm"
                  autoComplete="name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {labels.phoneLabel}
                </label>
                <input
                  value={phone}
                  onChange={(ev) => setPhone(ev.target.value)}
                  type="tel"
                  dir="ltr"
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm text-start"
                  autoComplete="tel"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">
                  {labels.emailLabel}{' '}
                  <span className="text-[var(--color-text-muted)] font-normal">
                    {labels.emailOptional}
                  </span>
                </label>
                <input
                  value={email}
                  onChange={(ev) => setEmail(ev.target.value)}
                  type="email"
                  dir="ltr"
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm text-start"
                  autoComplete="email"
                />
              </div>
            </div>

            {error && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !name.trim() || !phone.trim()}
              className="mt-5 w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50"
            >
              {submitting ? labels.submitting : labels.submit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
