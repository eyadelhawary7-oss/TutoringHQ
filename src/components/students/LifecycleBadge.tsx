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
  enrolled: 'badge badge-neutral',
  active: 'badge badge-success',
  at_risk: 'badge badge-danger',
  inactive: 'badge badge-gold',
  churned: 'badge badge-neutral',
};

export function LifecycleBadge({ status, label }: Props) {
  const key = status ?? 'enrolled';
  const cls = STATUS_CLASS[key] ?? 'badge badge-neutral';
  return <span className={cls}>{label}</span>;
}
