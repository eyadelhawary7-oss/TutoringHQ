'use client';

import { useTranslations } from 'next-intl';

export type LifecycleStatus = 'enrolled' | 'active' | 'at_risk' | 'inactive' | 'churned';

interface LifecycleBadgeProps {
  status?: LifecycleStatus | string | null;
  fallbackActive?: boolean;
}

const STATUS_STYLES: Record<LifecycleStatus, string> = {
  enrolled: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  at_risk: 'bg-amber-100 text-amber-700',
  inactive: 'bg-red-100 text-red-700',
  churned: 'bg-red-100 text-red-700',
};

const STATUS_KEYS: Record<LifecycleStatus, string> = {
  enrolled: 'lifecycleEnrolled',
  active: 'lifecycleActive',
  at_risk: 'lifecycleAtRisk',
  inactive: 'lifecycleInactive',
  churned: 'lifecycleChurned',
};

export function LifecycleBadge({ status, fallbackActive = true }: LifecycleBadgeProps) {
  const t = useTranslations('students');
  const validStatus = status && STATUS_STYLES[status as LifecycleStatus]
    ? (status as LifecycleStatus)
    : fallbackActive
      ? 'active'
      : 'inactive';
  const style = STATUS_STYLES[validStatus];
  const labelKey = STATUS_KEYS[validStatus];
  const label = t(labelKey, {
    defaultValue: validStatus === 'enrolled' ? 'مسجل' : validStatus === 'active' ? 'نشط' : validStatus === 'at_risk' ? 'معرض للخطر' : validStatus === 'inactive' ? 'غير نشط' : 'منسحب',
  });

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}
