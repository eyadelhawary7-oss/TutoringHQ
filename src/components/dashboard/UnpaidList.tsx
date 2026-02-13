'use client';

import { useTranslations } from 'next-intl';

interface Student {
  id: string;
  name: string;
  subject_name: string;
  fee: number;
}

interface UnpaidListProps {
  students: Student[];
}

export default function UnpaidList({ students }: UnpaidListProps) {
  const t = useTranslations('dashboard');

  if (students.length === 0) {
    return (
      <p className="text-center text-gray-400 dark:text-gray-500 py-4 text-sm">---</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="px-3 py-2 text-start font-medium text-gray-600 dark:text-gray-400">
              {t('unpaidStudents')}
            </th>
            <th className="px-3 py-2 text-start font-medium text-gray-600 dark:text-gray-400">
              {t('revenue')}
            </th>
            <th className="px-3 py-2 text-end font-medium text-gray-600 dark:text-gray-400">
              {/* Actions */}
            </th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.id} className="border-b border-gray-100 dark:border-gray-700/50">
              <td className="px-3 py-3">
                <p className="font-medium text-gray-900 dark:text-white">{student.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{student.subject_name}</p>
              </td>
              <td className="px-3 py-3 text-gray-600 dark:text-gray-400">
                {student.fee} {t('currency')}
              </td>
              <td className="px-3 py-3 text-end">
                <button className="text-xs px-3 py-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors">
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
