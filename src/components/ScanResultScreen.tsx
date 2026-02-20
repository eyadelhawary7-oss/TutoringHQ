'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Check, X, AlertTriangle, Clock } from 'lucide-react';

interface Student {
  id: string;
  name: string;
  payment_status: string;
  fee: number;
  subject: string;
  student_number?: string | null;
  last_payment_method?: string | null;
  groups?: { id: string; name: string; fee: number }[];
}

interface ScanResultScreenProps {
  student: Student;
  selectedGroup?: { id: string; name: string; fee: number } | null;
  onPaymentSelect: (method: string, groupId?: string, amount?: number) => void;
  onAllowLateEntry?: () => void;
  onDismiss: () => void;
  isProcessing: boolean;
  canAllowLateEntry?: boolean;
  balanceDue?: number;
  addedAmount?: number;
}

const PAYMENT_METHODS: { key: string; value: string; icon: string; labelKey: string }[] = [
  { key: 'cash', value: 'cash', icon: '💵', labelKey: 'cash' },
  { key: 'instapay', value: 'instapay', icon: '📱', labelKey: 'instapay' },
  { key: 'vodafone', value: 'vodafone_cash', icon: '🔴', labelKey: 'vodafone' },
  { key: 'orange', value: 'orange', icon: '🟠', labelKey: 'orange' },
  { key: 'fawry', value: 'fawry', icon: '🟡', labelKey: 'fawry' },
  { key: 'bank', value: 'bank_transfer', icon: '🏦', labelKey: 'bankTransfer' },
];

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
}: ScanResultScreenProps) {
  const t = useTranslations('scan');
  const tCommon = useTranslations('common');
  const selectedGroup = selectedGroupProp ?? student.groups?.[0] ?? null;

  const isPaid = student.payment_status === 'paid';
  const isPending = student.payment_status === 'pending';
  const isLateEntryGranted = student.payment_status === 'late_entry_granted';
  const isUnpaid = !isPaid && !isPending && !isLateEntryGranted;

  const [countdown, setCountdown] = useState(3);

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

  const egp = (amount: number) => `${amount} ${tCommon('egp')}`;

  // ─── GREEN (#16A34A): Already paid ───
  if (isPaid) {
    return (
      <div
        className="scanner-green fixed inset-0 z-[100] flex flex-col items-center justify-center text-white animate-scale-in"
        style={{ background: '#16A34A' }}
      >
        <div className="text-center px-6">
          <div className="text-8xl mb-6">✓</div>
          <div className="text-4xl font-black mb-2">{student.name}</div>
          <div className="text-white/80 text-sm mb-3">{selectedGroup?.name ?? student.subject}</div>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-white/20 mb-4">
            <Check size={14} /> {t('studentPaid')}
          </div>
          {balanceDue > 0 && (
            <div className="mt-4 px-4 py-3 rounded-xl bg-black/20 border border-white/20 text-sm text-amber-100 flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{t('balanceDue')}: {egp(balanceDue)}</span>
            </div>
          )}
          <div className="text-white/60 text-xs mt-4">{t('autoDismiss')} {countdown} {t('seconds')}</div>
        </div>
        <button
          onClick={onDismiss}
          className="mt-10 px-8 py-3 rounded-xl font-bold text-sm bg-white/20 hover:bg-white/30 border border-white/30 transition-colors"
        >
          {t('nextStudent')}
        </button>
      </div>
    );
  }

  // ─── YELLOW (#EAB308): Entry allowed — unpaid ───
  if (isLateEntryGranted) {
    return (
      <div
        className="scanner-yellow fixed inset-0 z-[100] flex flex-col items-center justify-center text-white animate-scale-in"
        style={{ background: '#EAB308' }}
      >
        <div className="text-center px-6">
          <div className="text-7xl mb-6">⚠️</div>
          <div className="text-4xl font-black mb-2 text-slate-900">{student.name}</div>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-black/20 text-slate-900 mb-3">
            <AlertTriangle size={14} /> {t('entryAllowedUnpaid')}
          </div>
          <div className="mt-3 px-4 py-3 rounded-xl bg-black/10 border border-black/20 text-sm space-y-1 text-slate-800">
            {addedAmount > 0 && <div>{t('amountAddedToBalance', { amount: egp(addedAmount) })}</div>}
            {balanceDue > 0 && <div className="font-bold">{t('balanceDue')}: {egp(balanceDue)}</div>}
          </div>
          <div className="text-slate-700 text-xs mt-3">{t('autoDismiss')} {countdown} {t('seconds')}</div>
        </div>
        <button
          onClick={onDismiss}
          className="mt-10 px-8 py-3 rounded-xl font-bold text-sm bg-black/20 hover:bg-black/30 border border-black/30 text-slate-900 transition-colors"
        >
          {t('nextStudent')}
        </button>
      </div>
    );
  }

  // ─── PURPLE (#7C3AED): Payment pending confirmation ───
  if (isPending) {
    const methodLabel = student.last_payment_method
      ? PAYMENT_METHODS.find((m) => m.value === student.last_payment_method)?.labelKey ?? 'instapay'
      : '';
    return (
      <div
        className="scanner-purple fixed inset-0 z-[100] flex flex-col items-center justify-center text-white animate-scale-in"
        style={{ background: '#7C3AED' }}
      >
        <div className="text-center px-6">
          <div className="text-7xl mb-6">⏳</div>
          <div className="text-4xl font-black mb-2">{student.name}</div>
          {methodLabel && <div className="text-white/80 text-sm mb-2">{t(methodLabel as 'cash')}</div>}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-white/20 mb-3">
            <Clock size={14} /> {t('paymentPendingConfirmation')}
          </div>
          {balanceDue > 0 && (
            <div className="mt-3 px-4 py-3 rounded-xl bg-black/20 border border-white/20 text-sm">
              <div className="text-white/80">{t('pendingPayment')}</div>
              <div className="font-bold text-white mt-1">{t('balanceDue')}: {egp(balanceDue)}</div>
            </div>
          )}
          <div className="text-white/60 text-xs mt-3">{t('autoDismiss')} {countdown} {t('seconds')}</div>
        </div>
        <button
          onClick={onDismiss}
          className="mt-10 px-8 py-3 rounded-xl font-bold text-sm bg-white/20 hover:bg-white/30 border border-white/30 transition-colors"
        >
          {t('nextStudent')}
        </button>
      </div>
    );
  }

  // ─── RED (#DC2626): Not paid — payment options ───
  const fee = selectedGroup?.fee ?? student.fee ?? 0;
  return (
    <div
      className="scanner-red fixed inset-0 z-[100] flex flex-col text-white overflow-y-auto"
      style={{ background: '#DC2626' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center pt-10 pb-4 px-6 text-center">
        <div className="text-7xl mb-5">✕</div>
        <div className="text-3xl font-black mb-1">{student.name}</div>
        <div className="text-white/80 text-sm mb-1">{selectedGroup?.name ?? student.subject}</div>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-white/20 mb-2">
          <X size={14} /> {t('notPaid')}
        </div>
        {fee > 0 && <div className="text-white/80 text-sm">{t('feePerLesson')}: {egp(fee)}</div>}
      </div>
      <div className="px-4 pb-4">
        {/* 6 payment buttons in 3×2 grid */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {PAYMENT_METHODS.map(({ key, value, icon, labelKey }) => (
            <button
              key={value}
              disabled={isProcessing}
              onClick={() =>
                onPaymentSelect(
                  value,
                  selectedGroup?.id ?? student.groups?.[0]?.id,
                  selectedGroup?.fee ?? student.groups?.[0]?.fee ?? student.fee
                )
              }
              className="py-4 px-2 rounded-xl font-bold text-white text-sm transition-all hover:bg-white/20 disabled:opacity-50 bg-white/10 border border-white/30"
            >
              <span className="text-2xl block mb-1">{icon}</span>
              <span className="text-xs">{t(labelKey as 'cash')}</span>
            </button>
          ))}
        </div>
        {canAllowLateEntry && onAllowLateEntry && (
          <button
            disabled={isProcessing}
            onClick={onAllowLateEntry}
            className="w-full py-3 rounded-xl font-bold text-sm border-2 border-amber-400 text-amber-200 hover:bg-amber-400/20 transition-colors mb-2 disabled:opacity-50"
          >
            {t('allowLateEntry')}
          </button>
        )}
        <button
          onClick={onDismiss}
          className="w-full py-2 text-sm text-white/60 hover:text-white transition-colors"
        >
          {t('cancelScan')}
        </button>
      </div>
      {isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <svg
            className="animate-spin h-12 w-12 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
