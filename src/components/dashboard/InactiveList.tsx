'use client';

import { useTranslations } from 'next-intl';

export type InactivePeriod = '7d' | '14d' | '30d' | '3mo' | '6mo' | '1yr';

export interface InactiveStudent {
  id: string;
  name: string;
  student_number: string;
  last_scanned_at: string | null;
  days_absent: number;
}

interface InactiveListProps {
  students: InactiveStudent[];
  period: InactivePeriod;
  onPeriodChange: (period: InactivePeriod) => void;
}

const PERIODS: InactivePeriod[] = ['7d', '14d', '30d', '3mo', '6mo', '1yr'];

export default function InactiveList({ students, period, onPeriodChange }: InactiveListProps) {
  const t = useTranslations('dashboard');

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodChange(p)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors border-2 ${
              period === p
                ? 'bg-slate-600/50 text-slate-100 border-indigo-500'
                : 'bg-slate-800/50 text-slate-400 border-transparent hover:bg-slate-700/50 hover:text-slate-300'
            }`}
          >
            {t(`filter${p}` as 'filter7d')}
          </button>
        ))}
      </div>
      {students.length === 0 ? (
        <p className="text-center text-slate-400 py-8 text-sm">
          {t('noInactiveStudents')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-600">
                <th className="px-3 py-2 text-start text-sm font-medium italic text-slate-400">{t('studentName')}</th>
                <th className="px-3 py-2 text-start text-sm font-medium italic text-slate-400">{t('studentId')}</th>
                <th className="px-3 py-2 text-start text-sm font-medium italic text-slate-400">{t('lastAttendance')}</th>
                <th className="px-3 py-2 text-end text-sm font-medium italic text-slate-400">{t('daysAbsent')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-b border-slate-700/50">
                  <td className="px-3 py-3 font-medium text-slate-100">{s.name}</td>
                  <td className="px-3 py-3 font-mono italic text-slate-400" dir="ltr">{s.student_number}</td>
                  <td className="px-3 py-3 text-slate-400">
                    {s.last_scanned_at
                      ? new Date(s.last_scanned_at).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="px-3 py-3 text-end font-mono italic font-medium text-slate-100">{s.days_absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
