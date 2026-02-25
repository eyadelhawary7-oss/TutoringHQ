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
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-start justify-between">
      <div>
        <p className="text-sm text-slate-500 mb-1">{title}</p>
        <p className="text-2xl font-bold text-slate-900 font-mono">{value}</p>
        {subLabel && <p className="text-xs text-slate-400 mt-1">{subLabel}</p>}
      </div>
      <div className={`p-3 rounded-full ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
    </div>
  );
}
