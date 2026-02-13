'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Student {
  id: string;
  name: string;
  payment_status: string;
  fee: number;
  subject_name: string;
}

interface ScanResultScreenProps {
  student: Student;
  onPaymentSelect: (method: string) => void;
  onDismiss: () => void;
  isProcessing: boolean;
}

const paymentMethods = [
  { key: 'cash', value: 'cash' },
  { key: 'instapay', value: 'instapay' },
  { key: 'vodafone', value: 'vodafone_cash' },
  { key: 'orange', value: 'orange' },
  { key: 'fawry', value: 'fawry' },
  { key: 'bankTransfer', value: 'bank_transfer' },
];

export default function ScanResultScreen({ student, onPaymentSelect, onDismiss, isProcessing }: ScanResultScreenProps) {
  const t = useTranslations('scan');
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);

  const isPaid = student.payment_status === 'paid';

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-colors duration-300 ${
        isPaid ? 'bg-emerald-500' : 'bg-red-500'
      }`}
      onClick={isPaid ? onDismiss : undefined}
    >
      {/* Student Name */}
      <h1
        className="text-5xl sm:text-7xl md:text-8xl font-bold text-white text-center px-4 mb-4"
        style={{ textShadow: '0 4px 8px rgba(0,0,0,0.3)' }}
      >
        {student.name}
      </h1>

      {/* Subject */}
      <p
        className="text-2xl sm:text-3xl text-white/90 text-center mb-2"
        style={{ textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
      >
        {student.subject_name}
      </p>

      {/* Status */}
      <p
        className="text-xl sm:text-2xl text-white/80 text-center mb-8"
        style={{ textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
      >
        {isPaid ? `✓ ${t('studentPaid')}` : t('studentUnpaid')}
      </p>

      {/* Pay Now Section (unpaid only) */}
      {!isPaid && !showPaymentMethods && (
        <button
          onClick={() => setShowPaymentMethods(true)}
          className="px-12 py-5 bg-white text-red-600 text-2xl font-bold rounded-2xl shadow-2xl hover:shadow-3xl transform hover:scale-105 transition-all duration-200"
        >
          {t('payNow')}
        </button>
      )}

      {/* Payment Methods Dropdown */}
      {!isPaid && showPaymentMethods && (
        <div className="w-full max-w-sm px-4">
          <h3 className="text-xl text-white font-bold text-center mb-4">
            {t('selectMethod')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {paymentMethods.map((method) => (
              <button
                key={method.value}
                disabled={isProcessing}
                onClick={() => onPaymentSelect(method.value)}
                className="py-4 px-4 bg-white/20 backdrop-blur-sm text-white font-bold rounded-xl border-2 border-white/30 hover:bg-white/30 transition-all disabled:opacity-50 text-lg"
              >
                {t(method.key)}
              </button>
            ))}
          </div>
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

      {/* Dismiss hint for paid */}
      {isPaid && (
        <p className="text-white/60 text-sm mt-8">
          {t('attendanceRecorded')}
        </p>
      )}
    </div>
  );
}
