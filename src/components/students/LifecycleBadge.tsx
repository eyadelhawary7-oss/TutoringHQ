type LifecycleStatus =
  | 'enrolled'
  | 'active'
  | 'at_risk'
  | 'inactive'
  | 'churned'
  | null
  | undefined;

type Props = {
  status: LifecycleStatus;
  label: string;
};

const STATUS_CLASS: Record<string, string> = {
  enrolled:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700',
  active:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700',
  at_risk:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700',
  inactive:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700',
  churned:
    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500',
};

export function LifecycleBadge({ status, label }: Props) {
  const key = status ?? 'enrolled';
  const cls = STATUS_CLASS[key] ?? STATUS_CLASS.enrolled;
  return <span className={cls}>{label}</span>;
}
