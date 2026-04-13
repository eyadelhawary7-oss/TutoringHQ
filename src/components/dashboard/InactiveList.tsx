'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatDate, formatNumber } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

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
  const locale = useLocale();

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPeriodChange(p)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors border-2 ${period === p ? 'bg-indigo-500/20 text-[var(--text-primary)] border-indigo-500' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--color-surface-1)]/5 hover:text-[var(--text-primary)]'}`}
          >
            {t(`filter${p}` as 'filter7d')}
          </button>
        ))}
      </div>
      {students.length === 0 ? (
        <p className="text-center text-[var(--text-secondary)] py-8 text-sm">
          {t('noInactiveStudents')}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="px-3 py-2 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('studentName')}</th>
                <th className="px-3 py-2 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('studentId')}</th>
                <th className="px-3 py-2 text-start text-sm font-medium italic text-[var(--text-secondary)]">{t('lastAttendance')}</th>
                <th className="px-3 py-2 text-end text-sm font-medium italic text-[var(--text-secondary)]">{t('daysAbsent')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-b border-[var(--border-color)]">
                  <td className="px-3 py-3 font-medium text-[var(--text-primary)]">{s.name}</td>
                  <td className="px-3 py-3 font-mono italic text-[var(--text-secondary)]" dir="ltr">
                    {formatStudentNumberForDisplay(s.student_number)}
                  </td>
                  <td className="px-3 py-3 text-[var(--text-secondary)]">
                    {s.last_scanned_at
                      ? formatDate(s.last_scanned_at, locale, {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })
                      : '-'}
                  </td>
                  <td className="px-3 py-3 text-end font-mono italic font-medium text-[var(--text-primary)]">
                    {formatNumber(s.days_absent, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
