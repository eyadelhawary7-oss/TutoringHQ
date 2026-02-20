'use client';

import { useTranslations } from 'next-intl';

interface Student {
  id: string;
  name: string;
  subject: string;
  fee: number;
}

interface UnpaidListProps {
  students: Student[];
}

export default function UnpaidList({ students }: UnpaidListProps) {
  const t = useTranslations('dashboard');

  if (students.length === 0) {
    return (
      <p className="text-center text-[var(--text-secondary)] py-4 text-sm">---</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-color)]">
            <th className="px-3 py-2 text-start text-sm font-medium italic text-[var(--text-secondary)]">
              {t('unpaidStudents')}
            </th>
            <th className="px-3 py-2 text-start text-sm font-medium italic text-[var(--text-secondary)]">
              {t('revenue')}
            </th>
            <th className="px-3 py-2 text-end text-sm font-medium italic text-[var(--text-secondary)]">
              {/* Actions */}
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="border-b border-[var(--border-color)]">
              <td className="px-3 py-3">
                <p className="font-medium text-[var(--text-primary)]">{student.name}</p>
                <p className="text-xs text-[var(--text-secondary)]">{student.subject}</p>
              </td>
              <td className="px-3 py-3 font-mono italic text-[var(--text-secondary)]">
                {student.fee} {t('currency')}
              </td>
              <td className="px-3 py-3 text-end">
                <button className="text-xs px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors">
                  {t('sendReminder')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
