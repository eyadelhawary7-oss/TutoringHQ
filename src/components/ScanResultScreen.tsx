'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CheckCircle, XCircle, AlertTriangle, Clock, Loader2 } from 'lucide-react';
import { formatCurrency } from '@/lib/formatNumber';

interface Student {
  id: string;
  name: string;
  payment_status: string;
  fee: number;
  subject: string;
  student_number?: string | null;
  last_payment_method?: string | null;
  groups?: { id: string; name: string; fee_per_class: number }[];
}

interface ScanResultScreenProps {
  student: Student;
  selectedGroup?: { id: string; name: string; fee_per_class: number } | null;
  onPaymentSelect: (method: string, groupId?: string, amount?: number) => void;
  /** Called with audit reason slug after operator confirms */
  onAllowLateEntry?: (reason: string) => void;
  onDismiss: () => void;
  isProcessing: boolean;
  canAllowLateEntry?: boolean;
  balanceDue?: number;
  addedAmount?: number;
  /** Outstanding debt (balance_due) - shown in unpaid debt header */
  outstandingBalance?: number;
  /** Modal headline for unpaid debt path, e.g. "Pay 100 EGP - Name" */
  paymentHeadline?: string | null;
}

// Two tuition methods only — design/NEW-MODEL.md. `value` is what lands in
// payments.method, so each one must be a spelling payments_method_check
// accepts. This list previously offered 'vodacash', 'orange', 'fawry' and
// 'bank' at the door.
const PAYMENT_METHODS: { key: string; value: string; icon: string; labelKey: string }[] = [
  { key: 'cash', value: 'cash', icon: '💵', labelKey: 'cash' },
  { key: 'instapay', value: 'instapay', icon: '📱', labelKey: 'instapay' },
];

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function ModalChrome({
  borderClass,
  children,
}: {
  borderClass: string;
  children: ReactNode;
}) {
  return (
    <div className="chq-spring-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        className={`relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--color-surface-1)] shadow-2xl border border-[var(--color-border-subtle)] border-t-4 ${borderClass}`}
      >
        {children}
      </div>
    </div>
  );
}

export default function ScanResultScreen({
  student,
  selectedGroup: selectedGroupProp,
  onPaymentSelect,
  onAllowLateEntry,
  onDismiss,
  isProcessing,
  canAllowLateEntry = true,
  balanceDue = 0,
  addedAmount = 0,
  outstandingBalance = 0,
  paymentHeadline = null,
}: ScanResultScreenProps) {
  const t = useTranslations('scan');
  const tsScan = useTranslations('scanner');
  const tAllow = useTranslations('scanner.allowEntry');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const selectedGroup = selectedGroupProp ?? student.groups?.[0] ?? null;
  const hasVibrated = useRef(false);

  const isPaid = student.payment_status === 'paid';
  const isPending = student.payment_status === 'pending';
  const isLateEntryGranted = student.payment_status === 'late_entry_granted';
  const isUnpaid = !isPaid && !isPending && !isLateEntryGranted;

  const [countdown, setCountdown] = useState(3);
  const [allowReason, setAllowReason] = useState('parent_paying_tomorrow');
  const [busyPaymentMethod, setBusyPaymentMethod] = useState<string | null>(null);
  const [busyAllowEntry, setBusyAllowEntry] = useState(false);

  useEffect(() => {
    if (!isProcessing) {
      setBusyPaymentMethod(null);
      setBusyAllowEntry(false);
    }
  }, [isProcessing]);

  useEffect(() => {
    if (hasVibrated.current) return;
    hasVibrated.current = true;
    if (isPaid) vibrate([100]);
    else if (isUnpaid) vibrate([50, 50, 100]);
    else if (isLateEntryGranted || isPending) vibrate([200]);
  }, [isPaid, isUnpaid, isLateEntryGranted, isPending]);

  useEffect(() => {
    if (!isPaid && !isPending && !isLateEntryGranted) return;
    const tid = setTimeout(() => setCountdown(3), 0);
    const id = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 3 : c - 1));
    }, 1000);
    return () => {
      clearTimeout(tid);
      clearInterval(id);
    };
  }, [isPaid, isPending, isLateEntryGranted]);

  const egp = (amount: number) => formatCurrency(amount, locale);

  // ─── GREEN (paid) ───
  if (isPaid) {
    return (
      <ModalChrome borderClass="border-t-emerald-500">
        <div className="flex flex-col items-center text-center px-6 py-8 text-[var(--color-text-primary)]">
          <div className="relative w-28 h-28 flex items-center justify-center mb-6">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="absolute w-28 h-28 rounded-full border-2 border-emerald-500/40"
                style={{
                  animation: `scanner-green-pulse 600ms ease-out ${i * 200}ms forwards`,
                }}
              />
            ))}
            <div className="relative w-28 h-28 bg-emerald-500/15 rounded-full flex items-center justify-center">
              <CheckCircle className="w-16 h-16 text-emerald-500" style={{ animation: 'scanner-green-check 600ms ease-out forwards' }} />
            </div>
          </div>
          <h2 className="text-2xl font-bold mb-2">{student.name}</h2>
          <p className="text-[var(--color-text-secondary)] text-lg mb-1">{selectedGroup?.name ?? student.subject}</p>
          <p className="text-3xl font-bold font-mono mt-2 mb-6 text-emerald-600">{egp(selectedGroup?.fee_per_class ?? student.fee ?? 0)}</p>
          {balanceDue > 0 && (
            <div className="bg-[var(--color-surface-0)] rounded-xl p-4 mb-6 w-full border border-[var(--color-border-subtle)]">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('balanceDue')}</p>
              <p className="text-2xl font-bold font-mono">{egp(balanceDue)}</p>
            </div>
          )}
          <p className="text-[var(--color-text-secondary)] text-sm mb-4">
            {t('autoDismiss')} {countdown}
            {t('seconds')}...
          </p>
        </div>
      </ModalChrome>
    );
  }

  // ─── YELLOW (late entry) ───
  if (isLateEntryGranted) {
    return (
      <ModalChrome borderClass="border-t-amber-500">
        <div className="flex flex-col items-center text-center px-6 py-8">
          <div
            className="w-28 h-28 bg-amber-500/15 rounded-full flex items-center justify-center mb-6"
            style={{ animation: 'scanner-yellow-glow 800ms ease-in-out 2' }}
          >
            <AlertTriangle className="w-16 h-16 text-amber-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-[var(--color-text-primary)]">{student.name}</h2>
          <p className="text-[var(--color-text-secondary)] text-lg mb-2">{selectedGroup?.name ?? student.subject}</p>
          <p className="text-sm text-amber-800 mb-4">{t('entryAllowedUnpaid')}</p>
          <div className="bg-[var(--color-surface-0)] rounded-xl p-4 w-full border border-[var(--color-border-subtle)]">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('amountAddedToBalance', { amount: egp(addedAmount) })}</p>
            <p className="text-3xl font-bold font-mono text-[var(--color-text-primary)]">{egp(addedAmount)}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-6 px-8 py-3 rounded-xl font-semibold bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-[var(--color-text-primary)]"
          >
            {t('nextStudent')}
          </button>
        </div>
      </ModalChrome>
    );
  }

  // ─── PURPLE (pending digital payment) ───
  if (isPending) {
    const methodLabel = student.last_payment_method
      ? PAYMENT_METHODS.find((m) => m.value === student.last_payment_method)?.labelKey ?? 'instapay'
      : 'instapay';
    return (
      <ModalChrome borderClass="border-t-violet-500">
        <div className="flex flex-col items-center text-center px-6 py-8">
          <div className="w-28 h-28 bg-violet-500/15 rounded-full flex items-center justify-center mb-6">
            <Clock className="w-16 h-16 text-violet-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2 text-[var(--color-text-primary)]">{student.name}</h2>
          <p className="text-[var(--color-text-secondary)] text-lg mb-2">{selectedGroup?.name ?? student.subject}</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('paymentPendingConfirmation')}</p>
          <div className="bg-[var(--color-surface-0)] rounded-xl p-4 w-full border border-[var(--color-border-subtle)]">
            <p className="text-sm text-[var(--color-text-secondary)]">{t('pendingAmountLabel')}</p>
            <p className="text-3xl font-bold font-mono text-[var(--color-text-primary)]">{egp(addedAmount || balanceDue)}</p>
            <p className="text-sm text-[var(--color-text-tertiary)] mt-1 capitalize">
              {t('paidVia', { method: t(methodLabel as 'cash') })}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="mt-6 px-8 py-3 rounded-xl font-semibold bg-[var(--color-surface-0)] border border-[var(--color-border-default)] text-[var(--color-text-primary)]"
          >
            {t('nextStudent')}
          </button>
        </div>
      </ModalChrome>
    );
  }

  // ─── RED / debt unpaid (card, not full bleed) ───
  const fee = selectedGroup?.fee_per_class ?? student.fee ?? 0;
  const headline =
    paymentHeadline ||
    (outstandingBalance > 0
      ? `${t('payPrefix')} ${egp(outstandingBalance)}, ${student.name}`
      : student.name);

  return (
    <ModalChrome borderClass="border-t-red-600">
      <div className="px-6 py-8 text-[var(--color-text-primary)]">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-24 h-24 bg-red-500/15 rounded-full flex items-center justify-center mb-4">
            <XCircle className="w-14 h-14 text-red-600" />
          </div>
          <h2 className="text-xl font-bold leading-snug px-1">{headline}</h2>
          <p className="text-[var(--color-text-secondary)] mt-2">{selectedGroup?.name ?? student.subject}</p>
          {outstandingBalance > 0 && (
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1">
              {t('sessionFeeLabel')}: <span className="font-mono font-semibold text-[var(--color-text-primary)]">{egp(fee)}</span>
            </p>
          )}
        </div>

        <p className="text-center text-xs uppercase tracking-wider font-semibold text-[var(--color-text-secondary)] mb-3">{t('selectMethod')}</p>
        <div className="grid grid-cols-2 gap-3 w-full mb-4">
          {PAYMENT_METHODS.map(({ value, icon, labelKey }) => {
            const busyHere = busyPaymentMethod === value;
            const disablePayments =
              isProcessing || busyPaymentMethod !== null || busyAllowEntry;
            return (
            <button
              key={value}
              type="button"
              disabled={disablePayments}
              onClick={() => {
                setBusyPaymentMethod(value);
                onPaymentSelect(
                  value,
                  selectedGroup?.id ?? student.groups?.[0]?.id,
                  selectedGroup?.fee_per_class ?? student.groups?.[0]?.fee_per_class ?? student.fee,
                );
              }}
              className="min-h-[44px] py-3 px-4 bg-[var(--color-surface-0)] hover:bg-[var(--color-surface-2)] rounded-xl font-semibold transition-colors border border-[var(--color-border-default)] text-sm disabled:opacity-50 text-[var(--color-text-primary)]"
            >
              {busyHere ? (
                <>
                  <Loader2 className="mx-auto mb-1 h-5 w-5 animate-spin text-teal-600" aria-hidden />
                  <span className="block text-xs">{tsScan('processing')}</span>
                </>
              ) : (
                <>
                  <span className="block mb-1">{icon}</span>
                  <span>{t(labelKey as 'cash')}</span>
                </>
              )}
            </button>
            );
          })}
        </div>

        {canAllowLateEntry && onAllowLateEntry && (
          <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)]">{tAllow('reasonLabel')}</label>
            <select
              value={allowReason}
              onChange={(e) => setAllowReason(e.target.value)}
              className="w-full rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-0)] px-3 py-2.5 text-sm text-[var(--color-text-primary)]"
            >
              <option value="parent_paying_tomorrow">{tAllow('reason_parent_paying_tomorrow')}</option>
              <option value="first_time_visit">{tAllow('reason_first_time_visit')}</option>
              <option value="scholarship">{tAllow('reason_scholarship')}</option>
              <option value="other">{tAllow('reason_other')}</option>
            </select>
            <button
              type="button"
              disabled={isProcessing || busyPaymentMethod !== null || busyAllowEntry}
              onClick={() => {
                setBusyAllowEntry(true);
                onAllowLateEntry(allowReason);
              }}
              className="w-full py-3 bg-[var(--color-surface-0)] hover:bg-[var(--color-surface-2)] border border-[var(--color-border-default)] rounded-xl font-semibold transition-colors text-sm disabled:opacity-50 text-[var(--color-text-primary)] inline-flex flex-col items-center justify-center gap-1"
            >
              {busyAllowEntry ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-teal-600" aria-hidden />
                  <span className="text-xs">{tsScan('processing')}</span>
                </>
              ) : (
                t('allowLateEntry')
              )}
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full py-2 text-sm text-[var(--color-text-secondary)] underline-offset-2 hover:underline"
        >
          {tCommon('cancel')}
        </button>

        {isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/25 rounded-2xl z-10">
            <svg className="animate-spin h-12 w-12 text-teal-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        )}
      </div>
    </ModalChrome>
  );
}
