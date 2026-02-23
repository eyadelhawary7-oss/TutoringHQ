'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle, XCircle, AlertTriangle, Clock } from 'lucide-react';

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

  // ─── GREEN (paid) ───
  if (isPaid) {
    return (
      <div className="fixed inset-0 z-50 bg-green-600 flex flex-col items-center justify-center text-white p-6">
        <div className="w-28 h-28 bg-white/20 rounded-full flex items-center justify-center mb-6">
          <CheckCircle className="w-16 h-16 text-white" />
        </div>
        <h2 className="text-3xl font-bold mb-2">{student.name}</h2>
        <p className="text-green-200 text-lg mb-1">{selectedGroup?.name ?? student.subject}</p>
        <p className="text-4xl font-bold font-mono mt-2 mb-6">{egp(selectedGroup?.fee ?? student.fee ?? 0)}</p>
        {balanceDue > 0 && (
          <div className="bg-white/20 rounded-xl p-4 mb-6 w-full max-w-sm text-center border border-white/30">
            <p className="text-sm text-green-100">{t('balanceDue')}</p>
            <p className="text-2xl font-bold font-mono">{egp(balanceDue)}</p>
          </div>
        )}
        <p className="text-green-200 text-sm">{t('autoDismiss')} {countdown}{t('seconds')}...</p>
      </div>
    );
  }

  // ─── YELLOW (late entry) ───
  if (isLateEntryGranted) {
    return (
      <div className="fixed inset-0 z-50 bg-amber-500 flex flex-col items-center justify-center text-white p-6">
        <div className="w-28 h-28 bg-white/20 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-16 h-16 text-white" />
        </div>
        <h2 className="text-3xl font-bold mb-2">{student.name}</h2>
        <p className="text-amber-100 text-lg mb-2">{selectedGroup?.name ?? student.subject}</p>
        <p className="text-amber-100 text-sm mb-4">{t('entryAllowedUnpaid')}</p>
        <div className="bg-white/20 rounded-xl p-4 w-full max-w-sm text-center border border-white/30">
          <p className="text-sm text-amber-100">{t('amountAddedToBalance', { amount: egp(addedAmount) })}</p>
          <p className="text-3xl font-bold font-mono">{egp(addedAmount)}</p>
        </div>
        <button onClick={onDismiss} className="mt-6 px-8 py-3 bg-white/20 hover:bg-white/30 rounded-xl font-semibold transition-colors border border-white/30">
          {t('nextStudent')}
        </button>
      </div>
    );
  }

  // ─── PURPLE (pending digital payment) ───
  if (isPending) {
    const methodLabel = student.last_payment_method
      ? PAYMENT_METHODS.find((m) => m.value === student.last_payment_method)?.labelKey ?? 'instapay'
      : 'instapay';
    return (
      <div className="fixed inset-0 z-50 bg-violet-600 flex flex-col items-center justify-center text-white p-6">
        <div className="w-28 h-28 bg-white/20 rounded-full flex items-center justify-center mb-6">
          <Clock className="w-16 h-16 text-white animate-pulse" />
        </div>
        <h2 className="text-3xl font-bold mb-2">{student.name}</h2>
        <p className="text-violet-200 text-lg mb-2">{selectedGroup?.name ?? student.subject}</p>
        <p className="text-violet-200 text-sm mb-4">{t('paymentPendingConfirmation')}</p>
        <div className="bg-white/20 rounded-xl p-4 w-full max-w-sm text-center border border-white/30">
          <p className="text-sm text-violet-200">{t('pendingPayment')}</p>
          <p className="text-3xl font-bold font-mono">{egp(addedAmount || balanceDue)}</p>
          <p className="text-sm text-violet-300 mt-1 capitalize">via {t(methodLabel as 'cash')}</p>
        </div>
        <button onClick={onDismiss} className="mt-6 px-8 py-3 bg-white/20 hover:bg-white/30 rounded-xl font-semibold transition-colors border border-white/30">
          {t('nextStudent')}
        </button>
      </div>
    );
  }

  // ─── RED (unpaid) ───
  const fee = selectedGroup?.fee ?? student.fee ?? 0;
  return (
    <div className="fixed inset-0 z-50 bg-red-600 flex flex-col items-center justify-center text-white p-6 overflow-y-auto">
      <div className="w-28 h-28 bg-white/20 rounded-full flex items-center justify-center mb-6">
        <XCircle className="w-16 h-16 text-white" />
      </div>
      <h2 className="text-3xl font-bold mb-2">{student.name}</h2>
      <p className="text-red-200 text-lg mb-6">{selectedGroup?.name ?? student.subject}</p>
      <p className="text-sm text-red-200 mb-3 uppercase tracking-wider font-semibold">{t('selectMethod')}</p>
      <div className="grid grid-cols-2 gap-3 w-full max-w-sm mb-4">
        {PAYMENT_METHODS.map(({ value, icon, labelKey }) => (
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
            className="py-3 px-4 bg-white/20 hover:bg-white/30 rounded-xl font-semibold transition-colors border border-white/30 text-sm disabled:opacity-50"
          >
            <span className="block mb-1">{icon}</span>
            <span>{t(labelKey as 'cash')}</span>
          </button>
        ))}
      </div>
      {canAllowLateEntry && onAllowLateEntry && (
        <button
          disabled={isProcessing}
          onClick={onAllowLateEntry}
          className="w-full max-w-sm py-3 bg-white/10 hover:bg-white/20 border border-white/30 rounded-xl font-semibold transition-colors text-sm disabled:opacity-50"
        >
          {t('allowLateEntry')}
        </button>
      )}
      {isProcessing && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30 z-10">
          <svg className="animate-spin h-12 w-12 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      )}
    </div>
  );
}
