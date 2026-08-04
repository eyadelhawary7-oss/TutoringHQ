'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { isWeakPin } from '@/lib/weakPins';
import { formatDate } from '@/lib/formatNumber';
import { isProOrAbove } from '@/lib/teacherPlans';
import { phoneFromCenterhqAuthEmail } from '@/lib/utils/phone';
import MyCodeCard from '../../MyCodeCard';

/**
 * Teacher profile settings. A thin form over PATCH /api/teacher/profile (the
 * already-tested route). The (portal) layout gates auth server-side and wraps
 * this in the TeacherShell, so there is no auth boilerplate here - we only need
 * the access token to call the Bearer-scoped API. Prefill comes from
 * GET /api/teacher/profile (own row only). Cream tokens, RTL logical props.
 *
 * Note: grade_levels is not editable here - teacher_profiles has no such column
 * and the PATCH route does not accept it. Adding it would need a migration plus
 * an API change; deferred.
 */

type SubscriptionStatus = {
  has_subscription: boolean;
  status: string | null;
  plan_key: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
};

const SIX_DIGITS = /^\d{6}$/;

const PAYMENT_METHODS = ['cash', 'instapay', 'vodafone_cash', 'other'] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

type PaymentDetails = {
  instapayAddress: string | null;
  walletPhone: string | null;
  paymentPhone: string | null;
  acceptedMethods: PaymentMethod[];
  defaultPaymentMethod: PaymentMethod | null;
};

/** "201012345678" (auth-email digits) -> "+20 101 234 5678". */
function formatRegisteredPhone(digits: string): string {
  const local = digits.startsWith('20') ? digits.slice(2) : digits.replace(/^0/, '');
  if (local.length === 10) {
    return `+20 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  return `+${digits}`;
}

export default function TeacherSettingsPage() {
  const t = useTranslations('teacherSettings');
  const locale = useLocale();
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Payment details (parent pays the teacher directly).
  const [instapayAddress, setInstapayAddress] = useState('');
  const [walletPhone, setWalletPhone] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [acceptedMethods, setAcceptedMethods] = useState<PaymentMethod[]>([]);
  const [defaultMethod, setDefaultMethod] = useState<PaymentMethod | ''>('');
  const [paySaving, setPaySaving] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaved, setPaySaved] = useState(false);

  // Your account (read-only phone from the auth session).
  const [phone, setPhone] = useState<string | null>(null);

  // Subscription section.
  const [sub, setSub] = useState<SubscriptionStatus | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(false);

  // Change PIN form.
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showCurrentPin, setShowCurrentPin] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/login');
      return null;
    }
    return fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await authedFetch('/api/teacher/profile');
      if (!res) return;
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = (await res.json()) as {
        displayName?: string | null;
        subject?: string | null;
        paymentDetails?: PaymentDetails | null;
      };
      setDisplayName(data.displayName ?? '');
      setSubject(data.subject ?? '');

      const pd = data.paymentDetails;
      setInstapayAddress(pd?.instapayAddress ?? '');
      setWalletPhone(pd?.walletPhone ?? '');
      setPaymentPhone(pd?.paymentPhone ?? '');
      setAcceptedMethods(Array.isArray(pd?.acceptedMethods) ? pd.acceptedMethods : []);
      setDefaultMethod(pd?.defaultPaymentMethod ?? '');

      // Registered phone: teachers authenticate as {digits}@centerhq.local.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const email = session?.user?.email ?? '';
      const digits =
        phoneFromCenterhqAuthEmail(email) ?? (session?.user?.phone ?? '').replace(/\D/g, '');
      setPhone(digits ? formatRegisteredPhone(digits) : null);

      // Subscription summary (best-effort: a failure hides the detail, the
      // page still works).
      const subRes = await authedFetch('/api/teacher/subscription/status');
      if (subRes?.ok) {
        setSub((await subRes.json()) as SubscriptionStatus);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    if (displayName.trim().length < 2) {
      setError(t('errorName'));
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch('/api/teacher/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          subject: subject.trim() ? subject.trim() : null,
        }),
      });
      if (!res) return;
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setError(t('errorGeneric'));
        return;
      }
      setSaved(true);
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  const toggleMethod = (m: PaymentMethod) => {
    setPaySaved(false);
    setAcceptedMethods((prev) => {
      const next = prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m];
      // Clear the default if it is no longer an accepted method.
      if (!next.includes(m) && defaultMethod === m) {
        setDefaultMethod('');
      }
      return next;
    });
  };

  const handleSavePayment = async () => {
    setPayError(null);
    setPaySaved(false);
    // Guard: the default must be among the accepted methods (mirrors the API).
    if (defaultMethod && !acceptedMethods.includes(defaultMethod)) {
      setPayError(t('payment.errorDefaultNotAccepted'));
      return;
    }
    setPaySaving(true);
    try {
      const res = await authedFetch('/api/teacher/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentDetails: {
            instapayAddress: instapayAddress.trim() || null,
            walletPhone: walletPhone.trim() || null,
            paymentPhone: paymentPhone.trim() || null,
            acceptedMethods,
            defaultPaymentMethod: defaultMethod || null,
          },
        }),
      });
      if (!res) return;
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { code?: string };
        if (d.code === 'default_not_accepted') {
          setPayError(t('payment.errorDefaultNotAccepted'));
        } else {
          setPayError(t('errorGeneric'));
        }
        return;
      }
      setPaySaved(true);
    } catch {
      setPayError(t('errorGeneric'));
    } finally {
      setPaySaving(false);
    }
  };

  const handleChangePin = async () => {
    setPinError(null);
    setPinSuccess(false);
    if (!SIX_DIGITS.test(currentPin) || !SIX_DIGITS.test(newPin) || !SIX_DIGITS.test(confirmPin)) {
      setPinError(t('changePin.errorFormat'));
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(t('changePin.errorMatch'));
      return;
    }
    if (isWeakPin(newPin)) {
      setPinError(t('changePin.errorWeak'));
      return;
    }
    setPinSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/settings/change-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ currentPin, newPin }),
      });
      if (res.ok) {
        setPinSuccess(true);
        setCurrentPin('');
        setNewPin('');
        setConfirmPin('');
        return;
      }
      if (res.status === 429) {
        setPinError(t('changePin.errorRateLimit'));
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (data.error === 'invalid_current_pin') setPinError(t('changePin.errorCurrentWrong'));
      else if (data.error === 'weak_pin') setPinError(t('changePin.errorWeak'));
      else if (data.error === 'invalid_format') setPinError(t('changePin.errorFormat'));
      else setPinError(t('errorGeneric'));
    } catch {
      setPinError(t('errorGeneric'));
    } finally {
      setPinSubmitting(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/subscription/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
      });
      if (!res.ok) {
        setCancelError(true);
        return;
      }
      setSub((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
      setCancelOpen(false);
    } catch {
      setCancelError(true);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="h-44 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center shadow-card">
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{t('errorTitle')}</h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
        <button
          onClick={load}
          className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('nameLabel')}
            </label>
            <input
              type="text"
              value={displayName}
              maxLength={120}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSaved(false);
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('subjectLabel')}
            </label>
            <input
              type="text"
              value={subject}
              maxLength={80}
              onChange={(e) => {
                setSubject(e.target.value);
                setSaved(false);
              }}
              placeholder={t('subjectPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] p-3 text-sm text-[var(--color-teal-deep)]">
              {t('saved')}
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>

      {/* Payment details (parent pays the teacher directly; relayed in reminders) */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <h2 className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">
          {t('payment.title')}
        </h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('payment.subtitle')}</p>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('payment.instapayLabel')}
            </label>
            <input
              type="text"
              value={instapayAddress}
              maxLength={200}
              dir="ltr"
              onChange={(e) => {
                setInstapayAddress(e.target.value);
                setPaySaved(false);
              }}
              placeholder={t('payment.instapayPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('payment.walletLabel')}
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={walletPhone}
              maxLength={20}
              dir="ltr"
              onChange={(e) => {
                setWalletPhone(e.target.value);
                setPaySaved(false);
              }}
              placeholder={t('payment.walletPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('payment.paymentPhoneLabel')}
            </label>
            <input
              type="tel"
              inputMode="numeric"
              value={paymentPhone}
              maxLength={20}
              dir="ltr"
              onChange={(e) => {
                setPaymentPhone(e.target.value);
                setPaySaved(false);
              }}
              placeholder={t('payment.paymentPhonePlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-start text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('payment.acceptedLabel')}
            </span>
            <div className="flex flex-col gap-2">
              {PAYMENT_METHODS.map((m) => (
                <label
                  key={m}
                  className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-primary)]"
                >
                  <input
                    type="checkbox"
                    checked={acceptedMethods.includes(m)}
                    onChange={() => toggleMethod(m)}
                    className="h-4 w-4 rounded border-[var(--color-border)] text-teal-600 focus:ring-teal-500"
                  />
                  {t(`payment.method.${m}`)}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('payment.defaultLabel')}
            </label>
            <select
              value={defaultMethod}
              onChange={(e) => {
                setDefaultMethod(e.target.value as PaymentMethod | '');
                setPaySaved(false);
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            >
              <option value="">{t('payment.defaultNone')}</option>
              {acceptedMethods.map((m) => (
                <option key={m} value={m}>
                  {t(`payment.method.${m}`)}
                </option>
              ))}
            </select>
          </div>

          {payError && (
            <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
              {payError}
            </div>
          )}
          {paySaved && (
            <div className="rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] p-3 text-sm text-[var(--color-teal-deep)]">
              {t('saved')}
            </div>
          )}

          <button
            type="button"
            onClick={handleSavePayment}
            disabled={paySaving}
            className="flex items-center justify-center gap-2 self-start rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {paySaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {paySaving ? t('saving') : t('save')}
          </button>
        </div>
      </section>

      {/* My code (give to a center to be added; referral link lives on home) */}
      <MyCodeCard />

      {/* Change PIN */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)]">
          {t('changePin.title')}
        </h2>
        {pinSuccess ? (
          <div className="rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] p-3 text-sm text-[var(--color-teal-deep)]">
            {t('changePin.success')}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('changePin.currentLabel')}
              </label>
              <div className="relative">
                <input
                  type={showCurrentPin ? 'text' : 'password'}
                  inputMode="numeric"
                  autoComplete="current-password"
                  value={currentPin}
                  maxLength={6}
                  dir="ltr"
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 pe-11 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPin((v) => !v)}
                  aria-label={showCurrentPin ? t('changePin.hide') : t('changePin.show')}
                  className="absolute end-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                  {showCurrentPin ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('changePin.newLabel')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={newPin}
                maxLength={6}
                dir="ltr"
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
                {t('changePin.confirmLabel')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirmPin}
                maxLength={6}
                dir="ltr"
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {pinError && (
              <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
                {pinError}
              </div>
            )}

            <button
              type="button"
              onClick={handleChangePin}
              disabled={pinSubmitting}
              className="flex items-center justify-center gap-2 self-start rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pinSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {pinSubmitting ? t('changePin.submitting') : t('changePin.submit')}
            </button>
          </div>
        )}
      </section>

      {/* Your account */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)]">
          {t('account.title')}
        </h2>
        <p className="mb-1 text-sm font-medium text-[var(--color-text-primary)]">
          {t('account.phoneLabel')}
        </p>
        <p className="text-base font-semibold text-[var(--color-text-primary)]" dir="ltr">
          {phone ?? '-'}
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{t('account.phoneNote')}</p>
      </section>

      {/* Subscription */}
      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <h2 className="mb-4 text-lg font-bold text-[var(--color-text-primary)]">
          {t('subscription.title')}
        </h2>
        {!sub || !sub.status ? (
          <p className="text-sm text-[var(--color-text-secondary)]">{t('subscription.none')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[var(--color-surface-2)] px-3 py-1 text-xs font-semibold text-[var(--color-text-primary)]">
                {isProOrAbove(sub.plan_key)
                  ? t('subscription.planPro')
                  : t('subscription.planStandard')}
              </span>
              <span
                className={[
                  'rounded-full px-3 py-1 text-xs font-semibold',
                  sub.status === 'active' || sub.status === 'trialing'
                    ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                    : sub.status === 'past_due'
                      ? 'bg-[var(--color-brass-soft)] text-[var(--color-brass)]'
                      : sub.status === 'suspended'
                        ? 'bg-[var(--color-danger-muted)] text-[var(--color-danger)]'
                        : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
                ].join(' ')}
              >
                {sub.status === 'active'
                  ? t('subscription.statusActive')
                  : sub.status === 'trialing'
                    ? t('subscription.statusTrialing')
                    : sub.status === 'past_due'
                      ? t('subscription.statusPastDue')
                      : sub.status === 'suspended'
                        ? t('subscription.statusSuspended')
                        : t('subscription.statusCancelled')}
              </span>
            </div>

            {sub.status === 'trialing' && sub.trial_ends_at && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('subscription.trialEnds', { date: formatDate(sub.trial_ends_at, locale) })}
              </p>
            )}
            {sub.status === 'active' && (sub.current_period_end ?? sub.next_billing_at) && (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('subscription.renews', {
                  date: formatDate((sub.current_period_end ?? sub.next_billing_at) as string, locale),
                })}
              </p>
            )}
            {sub.status === 'past_due' && (
              <p className="text-sm font-medium text-[var(--color-brass)]">
                {t('subscription.pastDueNote')}
              </p>
            )}

            <div className="mt-1 flex flex-col items-start gap-2">
              {!isProOrAbove(sub.plan_key) &&
                (sub.status === 'active' || sub.status === 'trialing') && (
                  <Link
                    href="/teacher/subscription/upgrade"
                    className="text-sm font-medium text-[var(--color-teal-deep)] hover:underline"
                  >
                    {t('subscription.upgradeLink')}
                  </Link>
                )}
              <Link
                href="/teacher/billing"
                className="text-sm font-medium text-[var(--color-teal-deep)] hover:underline"
              >
                {t('subscription.historyLink')}
              </Link>
              {(sub.status === 'trialing' ||
                sub.status === 'active' ||
                sub.status === 'past_due' ||
                sub.status === 'suspended') && (
                <button
                  type="button"
                  onClick={() => {
                    setCancelError(false);
                    setCancelOpen(true);
                  }}
                  className="text-sm font-medium text-[var(--color-danger)]/70 transition-colors hover:text-[var(--color-danger)] hover:underline"
                >
                  {t('subscription.cancelLink')}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Cancel confirmation dialog */}
      {cancelOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setCancelOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
          >
            <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">
              {t('subscription.cancelConfirmTitle')}
            </h2>
            <p className="mb-5 text-sm text-[var(--color-text-secondary)]">
              {t('subscription.cancelConfirmBody')}
            </p>
            {cancelError && (
              <p className="mb-3 text-sm text-[var(--color-danger)]" role="alert">
                {t('errorGeneric')}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-2)]"
              >
                {t('subscription.cancelConfirmNo')}
              </button>
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={cancelling}
                className="flex items-center gap-2 rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {t('subscription.cancelConfirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
