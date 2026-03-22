'use client';

import type { LucideIcon } from 'lucide-react';

interface KpiCardProps {
  title: string;
  value: React.ReactNode;
  subLabel?: string;
  icon: LucideIcon;
  iconBg?: string;
  iconColor?: string;
}

export default function KpiCard({ title, value, subLabel, icon: Icon, iconBg = 'bg-teal-100', iconColor = 'text-teal-600' }: KpiCardProps) {
  return (
    <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6 flex items-start justify-between">
      <div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-1">{title}</p>
        <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
        {subLabel && <p className="text-xs text-slate-400 mt-1">{subLabel}</p>}
      </div>
      <div className={`p-3 rounded-full ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
    </div>
  );
}
