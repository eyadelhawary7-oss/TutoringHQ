'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatCurrency } from '@/lib/formatNumber';

const LOCAL_MOBILE = /^01[0125]\d{8}$/;
const OTP_LEN = 6;
const RESEND_AFTER_MS = 60_000;

type SuccessData = {
  groupName: string | null;
  teacherDisplayName: string | null;
  feePerClass: number;
};

export default function JoinFlowClient({
  groupId,
  groupName,
  teacherName,
  feePerClass,
}: {
  groupId: string;
  groupName: string | null;
  teacherName: string | null;
  feePerClass: number;
}) {
  const t = useTranslations('joinFlow');
  const locale = useLocale();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [studentName, setStudentName] = useState('');
  const [studentMobile, setStudentMobile] = useState('');
  const [payerType, setPayerType] = useState<'student' | 'parent'>('student');
  const [parentName, setParentName] = useState('');
  const [parentMobile, setParentMobile] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 2
  const [digits, setDigits] = useState<string[]>(Array(OTP_LEN).fill(''));
  const [maskedPhone, setMaskedPhone] = useState('');
  const [expiresAtMs, setExpiresAtMs] = useState(0);
  const [lastSentMs, setLastSentMs] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  // Step 3
  const [success, setSuccess] = useState<SuccessData | null>(null);

  // One ticking clock for the expiry + resend countdowns.
  useEffect(() => {
    if (step !== 2) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (step === 2) otpRefs.current[0]?.focus();
  }, [step]);

  const buildBody = () => ({
    studentName: studentName.trim(),
    studentMobile: studentMobile.trim(),
    payerType,
    parentName: payerType === 'parent' ? parentName.trim() : undefined,
    parentMobile: payerType === 'parent' ? parentMobile.trim() : undefined,
  });

  const validateStep1 = (): string | null => {
    if (studentName.trim().length < 1) return 'nameRequired';
    if (!LOCAL_MOBILE.test(studentMobile.trim())) return 'phoneInvalid';
    if (payerType === 'parent') {
      if (parentName.trim().length < 1) return 'parentNameRequired';
      if (!LOCAL_MOBILE.test(parentMobile.trim())) return 'parentPhoneInvalid';
      if (parentMobile.trim() === studentMobile.trim()) return 'parentPhoneSame';
    }
    return null;
  };

  const sendOtp = async (isResend: boolean) => {
    if (!isResend) {
      const v = validateStep1();
      if (v) {
        setFormError(v);
        return;
      }
    }
    setFormError(null);
    setOtpError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/join/${groupId}/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const json = (await res.json().catch(() => ({}))) as {
        sent?: boolean;
        maskedPhone?: string;
        expiresAt?: string;
        error?: string;
      };
      if (res.ok && json.sent) {
        setMaskedPhone(json.maskedPhone ?? '');
        setExpiresAtMs(json.expiresAt ? Date.parse(json.expiresAt) : Date.now() + 600_000);
        setLastSentMs(Date.now());
        setNowMs(Date.now());
        setDigits(Array(OTP_LEN).fill(''));
        setStep(2);
        return;
      }
      const code = json.error ?? 'generic';
      const msg = code === 'already_enrolled' ? 'alreadyEnrolled'
        : code === 'rate_limited' ? 'rateLimited'
        : 'sendError';
      if (isResend) setOtpError(msg);
      else setFormError(msg);
    } catch {
      if (isResend) setOtpError('sendError');
      else setFormError('sendError');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyOtp = async () => {
    const code = digits.join('');
    if (code.length !== OTP_LEN) return;
    setOtpError(null);
    setVerifying(true);
    try {
      const res = await fetch(`/api/join/${groupId}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildBody(), code }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        enrolled?: boolean;
        groupName?: string | null;
        teacherDisplayName?: string | null;
        feePerClass?: number;
        error?: string;
      };
      if (res.ok && json.enrolled) {
        setSuccess({
          groupName: json.groupName ?? groupName,
          teacherDisplayName: json.teacherDisplayName ?? teacherName,
          feePerClass: typeof json.feePerClass === 'number' ? json.feePerClass : feePerClass,
        });
        setStep(3);
        return;
      }
      const code2 = json.error ?? 'generic';
      const map: Record<string, string> = {
        expired: 'expiredCode',
        invalid_code: 'invalidCode',
        too_many_attempts: 'tooManyAttempts',
        rate_limited: 'rateLimited',
        verification_unavailable: 'verificationUnavailable',
        already_enrolled: 'alreadyEnrolled',
        capacity_full: 'capacityFull',
        GROUP_FULL: 'groupFull',
      };
      setOtpError(map[code2] ?? 'sendError');
      setDigits(Array(OTP_LEN).fill(''));
      otpRefs.current[0]?.focus();
    } catch {
      setOtpError('sendError');
    } finally {
      setVerifying(false);
    }
  };

  const handleDigit = (idx: number, raw: string) => {
    const ch = raw.replace(/\D/g, '').slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = ch;
      return next;
    });
    if (ch && idx < OTP_LEN - 1) otpRefs.current[idx + 1]?.focus();
  };

  const handleDigitKey = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      otpRefs.current[idx - 1]?.focus();
    }
  };

  const inputClass =
    'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-teal-500/30';
  const labelClass = 'mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]';

  // ---- Step 3: success ----
  if (step === 3 && success) {
    return (
      <div className="text-center">
        <CheckCircle2 size={52} className="mx-auto mb-4 text-[var(--color-teal-deep)]" aria-hidden />
        <h2 className="mb-2 text-xl font-bold text-[var(--color-text-primary)]">{t('successTitle')}</h2>
        <p className="font-medium text-[var(--color-text-primary)]">{success.groupName}</p>
        {success.teacherDisplayName && (
          <p className="text-sm text-[var(--color-text-secondary)]">{success.teacherDisplayName}</p>
        )}
        <p className="num mt-1 text-sm font-semibold text-[var(--color-teal-deep)]">
          {t('feePerClass')}: {formatCurrency(success.feePerClass, locale)}
        </p>
        <p className="mt-5 rounded-lg bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text-secondary)]">
          {t('waNote')}
        </p>
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">{t('noLogin')}</p>
      </div>
    );
  }

  // ---- Step 2: OTP ----
  if (step === 2) {
    const expired = nowMs >= expiresAtMs;
    const remainingSec = Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
    const mm = Math.floor(remainingSec / 60);
    const ss = remainingSec % 60;
    const timeStr = `${mm}:${String(ss).padStart(2, '0')}`;
    const resendInSec = Math.max(0, Math.ceil((lastSentMs + RESEND_AFTER_MS - nowMs) / 1000));
    const canResend = resendInSec <= 0;

    return (
      <div>
        <h2 className="mb-1 text-center text-lg font-bold text-[var(--color-text-primary)]">
          {t('verifyTitle')}
        </h2>
        <p className="mb-5 text-center text-sm text-[var(--color-text-secondary)]">
          {t('sentTo', { phone: maskedPhone })}
        </p>

        <div className="mb-3 flex justify-center gap-2" dir="ltr">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                otpRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleDigitKey(i, e)}
              aria-label={t('codeBox', { n: i + 1 })}
              className="h-12 w-10 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-center text-lg font-bold text-[var(--color-text-primary)] focus:border-[var(--color-teal)] focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          ))}
        </div>

        <p className="mb-4 text-center text-xs text-[var(--color-text-muted)]">
          {expired ? t('codeExpired') : t('expiresIn', { time: timeStr })}
        </p>

        {otpError && (
          <p className="mb-4 rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-center text-sm text-[var(--color-danger)]">
            {t(`errors.${otpError}`)}
          </p>
        )}

        <button
          type="button"
          onClick={verifyOtp}
          disabled={verifying || digits.join('').length !== OTP_LEN || expired}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {verifying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {verifying ? t('verifying') : t('verifySubmit')}
        </button>

        <div className="mt-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setOtpError(null);
            }}
            className="font-medium text-[var(--color-text-secondary)] hover:underline"
          >
            {t('back')}
          </button>
          <button
            type="button"
            onClick={() => sendOtp(true)}
            disabled={!canResend || submitting}
            className="font-medium text-[var(--color-brass)] hover:underline disabled:opacity-50"
          >
            {canResend ? t('resend') : t('resendIn', { seconds: resendInSec })}
          </button>
        </div>
      </div>
    );
  }

  // ---- Step 1: details ----
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="join-name" className={labelClass}>
          {t('studentName')}
        </label>
        <input
          id="join-name"
          type="text"
          value={studentName}
          maxLength={120}
          autoComplete="name"
          onChange={(e) => {
            setStudentName(e.target.value);
            setFormError(null);
          }}
          placeholder={t('studentNamePlaceholder')}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="join-mobile" className={labelClass}>
          {t('studentMobile')}
        </label>
        <input
          id="join-mobile"
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={studentMobile}
          autoComplete="tel"
          onChange={(e) => {
            setStudentMobile(e.target.value);
            setFormError(null);
          }}
          placeholder="01XXXXXXXXX"
          className={inputClass}
        />
      </div>

      <div>
        <span className={labelClass}>{t('whoPays')}</span>
        <div className="flex gap-1 rounded-xl bg-[var(--color-surface-2)] p-1">
          {(['student', 'parent'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                setPayerType(opt);
                setFormError(null);
              }}
              className={[
                'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                payerType === opt
                  ? 'bg-[var(--color-teal)] text-white'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-1)]',
              ].join(' ')}
            >
              {opt === 'student' ? t('payerStudent') : t('payerParent')}
            </button>
          ))}
        </div>
      </div>

      {payerType === 'parent' && (
        <>
          <div>
            <label htmlFor="join-parent-name" className={labelClass}>
              {t('parentName')}
            </label>
            <input
              id="join-parent-name"
              type="text"
              value={parentName}
              maxLength={120}
              onChange={(e) => {
                setParentName(e.target.value);
                setFormError(null);
              }}
              placeholder={t('parentNamePlaceholder')}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="join-parent-mobile" className={labelClass}>
              {t('parentMobile')}
            </label>
            <input
              id="join-parent-mobile"
              type="tel"
              inputMode="tel"
              dir="ltr"
              value={parentMobile}
              onChange={(e) => {
                setParentMobile(e.target.value);
                setFormError(null);
              }}
              placeholder="01XXXXXXXXX"
              className={inputClass}
            />
          </div>
        </>
      )}

      <p className="text-xs text-[var(--color-text-muted)]">
        {t.rich('consent', {
          privacy: (chunks) => (
            <Link href="/legal/privacy" className="font-medium text-[var(--color-teal-deep)] hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>

      {formError && (
        <p className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]" role="alert">
          {t(`errors.${formError}`)}
        </p>
      )}

      <button
        type="button"
        onClick={() => sendOtp(false)}
        disabled={submitting}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {submitting ? t('sending') : t('sendCode')}
      </button>
    </div>
  );
}
