'use client';

import { useTranslations } from 'next-intl';

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
  onPaymentSelect: (method: string, groupId?: string, groupFee?: number) => void;
  onAllowLateEntry?: () => void;
  onDismiss: () => void;
  isProcessing: boolean;
  canAllowLateEntry?: boolean;
}

const paymentMethods = [
  { key: 'cash', value: 'cash' },
  { key: 'instapay', value: 'instapay' },
  { key: 'vodafone', value: 'vodafone_cash' },
  { key: 'orangeCash', value: 'orange' },
  { key: 'fawry', value: 'fawry' },
  { key: 'bankTransfer', value: 'bank_transfer' },
];

export default function ScanResultScreen({ student, selectedGroup: selectedGroupProp, onPaymentSelect, onAllowLateEntry, onDismiss, isProcessing, canAllowLateEntry = true }: ScanResultScreenProps) {
  const t = useTranslations('scan');
  const selectedGroup = selectedGroupProp ?? student.groups?.[0] ?? null;

  const isPaid = student.payment_status === 'paid';
  const isPending = student.payment_status === 'pending';
  const isLateEntryGranted = student.payment_status === 'late_entry_granted';
  const isUnpaid = !isPaid && !isPending && !isLateEntryGranted;

  const screenType = isPaid ? 'green' : isPending ? 'purple' : isLateEntryGranted ? 'yellow' : 'red';
  const payButtonStyle = { background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)' };

  const bgStyle =
    screenType === 'red' ? { background: 'linear-gradient(to bottom, #991B1B, #DC2626, #EF4444)' } :
    screenType === 'green' ? { background: 'linear-gradient(to bottom, #047857, #059669, #10B981)' } :
    screenType === 'purple' ? { background: 'linear-gradient(to bottom, #4C1D95, #6D28D9, #8B5CF6)' } :
    { background: 'linear-gradient(to bottom, #B45309, #D97706, #F59E0B)' };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-colors duration-300 min-h-screen w-full overflow-y-auto py-8"
      style={bgStyle}
      dir="rtl"
      onClick={screenType === 'green' ? onDismiss : undefined}
    >
      <div className="text-white mb-2" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
        {screenType === 'red' && <span className="text-7xl sm:text-8xl">✕</span>}
        {screenType === 'green' && <span className="text-7xl sm:text-8xl">✓</span>}
        {screenType === 'purple' && <span className="text-6xl sm:text-7xl">⏳</span>}
        {screenType === 'yellow' && <span className="text-6xl sm:text-7xl">⚠</span>}
      </div>

      <h1 className="text-5xl sm:text-7xl md:text-8xl font-bold text-center px-4 mb-2 text-white" style={{ textShadow: '0 4px 8px rgba(0,0,0,0.3)' }}>
        {student.name}
      </h1>

      {student.student_number && (
        <p className="text-xl sm:text-2xl text-center mb-2 text-white/95">{student.student_number}</p>
      )}

      <p className="text-2xl sm:text-3xl text-center mb-2 text-white/90">{student.subject}</p>

      <p className="text-xl sm:text-2xl text-center mb-6 text-white/80">
        {isPaid && `✓ ${t('studentPaid')}`}
        {isPending && t('recordedAwaitingTransfer')}
        {isLateEntryGranted && t('lateEntryUnpaid')}
        {isUnpaid && t('studentUnpaid')}
      </p>

      {isPending && student.last_payment_method && (
        <p className="text-lg sm:text-xl text-center mb-2 text-white/90">
          {t(paymentMethods.find(m => m.value === student.last_payment_method)?.key ?? 'instapay')}
        </p>
      )}
      {isPending && (
        <p className="text-base sm:text-lg text-center mb-6 text-white/80">{t('pendingPayment')}</p>
      )}

      {isUnpaid && (
        <div className="w-full max-w-lg px-4">
          <div className="grid grid-cols-3 gap-3 mb-4">
            {paymentMethods.map((method) => (
              <button
                key={method.value}
                disabled={isProcessing}
                onClick={() => onPaymentSelect(method.value, selectedGroup?.id ?? student.groups?.[0]?.id, selectedGroup?.fee ?? student.groups?.[0]?.fee ?? student.fee)}
                className="py-4 px-2 rounded-xl font-bold text-white text-base sm:text-lg transition-all hover:opacity-90 disabled:opacity-50"
                style={payButtonStyle}
              >
                {t(method.key)}
              </button>
            ))}
          </div>
          {canAllowLateEntry && onAllowLateEntry && (
            <button
              disabled={isProcessing}
              onClick={onAllowLateEntry}
              className="w-full py-4 px-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 mb-4"
              style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', color: '#FBBF24' }}
            >
              {t('allowLateEntry')}
            </button>
          )}
          <button onClick={onDismiss} className="text-white/90 text-base underline hover:text-white mt-2">
            {t('scanNext')}
          </button>
        </div>
      )}

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="mt-6">
          <svg className="animate-spin h-10 w-10 text-white mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      )}

      {(isPaid || isPending || isLateEntryGranted) && (
        <div className="flex flex-col items-center gap-4 mt-4">
          {isPaid && <p className="text-sm text-white/60">{t('attendanceRecorded')}</p>}
          <button
            onClick={onDismiss}
            className="px-8 py-3 rounded-xl font-semibold text-white border border-white/40 bg-white/10 hover:bg-white/20 transition-all"
          >
            {t('scanNext')}
          </button>
        </div>
      )}
    </div>
  );
}
