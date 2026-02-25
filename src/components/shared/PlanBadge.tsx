'use client';

const styles: Record<string, string> = {
  starter: 'bg-slate-100 text-slate-700 border border-slate-300',
  pro: 'bg-blue-100 text-blue-700 border border-blue-300',
  business: 'bg-teal-100 text-teal-700 border border-teal-300',
  enterprise: 'bg-purple-100 text-purple-700 border border-purple-300',
  top_centers: 'bg-amber-100 text-amber-700 border border-amber-300',
  payg: 'bg-indigo-100 text-indigo-700 border border-indigo-300',
};

const labels: Record<string, string> = {
  starter: 'Starter',
  pro: 'Pro',
  business: 'Business',
  enterprise: 'Enterprise',
  top_centers: 'Top Centers',
  payg: 'PAYG',
};

export default function PlanBadge({ plan }: { plan?: string }) {
  const key = plan?.toLowerCase() ?? 'starter';
  return (
    <span
      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${styles[key] ?? styles.starter}`}
    >
      {labels[key] ?? plan ?? 'Starter'}
    </span>
  );
}
