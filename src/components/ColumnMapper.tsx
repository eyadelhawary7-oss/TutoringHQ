'use client';

import { useTranslations } from 'next-intl';
import { ColumnMapping } from '@/lib/excel-parser';

interface ColumnMapperProps {
  headers: string[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

const mappingFields: (keyof ColumnMapping)[] = [
  'studentName',
  'phone',
  'parentPhone',
  'subject',
  'monthlyFee',
];

export default function ColumnMapper({ headers, mapping, onMappingChange }: ColumnMapperProps) {
  const t = useTranslations('import');

  const fieldLabels: Record<keyof ColumnMapping, string> = {
    studentName: t('studentName'),
    phone: t('phone'),
    parentPhone: t('parentPhone'),
    subject: t('subject'),
    monthlyFee: t('monthlyFee'),
  };

  const requiredFields: (keyof ColumnMapping)[] = ['studentName', 'phone'];

  const handleChange = (field: keyof ColumnMapping, value: string) => {
    onMappingChange({
      ...mapping,
      [field]: value === '' ? null : value,
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
        {t('mapColumns')}
      </h3>

      <div className="space-y-3">
        {mappingFields.map((field) => (
          <div key={field} className="flex items-center gap-3">
            <label className="w-1/3 text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
              {fieldLabels[field]}
              {requiredFields.includes(field) && (
                <span className="text-red-500">*</span>
              )}
            </label>
            <select
              value={mapping[field] || ''}
              onChange={(e) => handleChange(field, e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white text-sm"
            >
              <option value="">{t('skipColumn')}</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}
