'use client';

import { useId } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

type Props = {
  data: { month: string; revenue: number }[];
  currencySuffix?: string;
};

const TEAL_500 = 'rgb(20 184 166)';
const TEAL_600 = '#0d9488';

export function RevenueSparkline({ data, currencySuffix = 'EGP' }: Props) {
  const gid = useId().replace(/:/g, '');
  const gradId = `spark-teal-${gid}`;

  if (!data || data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={TEAL_500} stopOpacity={0.2} />
            <stop offset="95%" stopColor={TEAL_500} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const v = Number(payload[0]?.value ?? 0);
            return (
              <div className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-lg px-3 py-2 text-xs font-medium text-slate-900 dark:text-white">
                {v.toLocaleString('en-US')} {currencySuffix}
              </div>
            );
          }}
          cursor={{ stroke: TEAL_600, strokeWidth: 1, strokeOpacity: 0.35 }}
        />
        <Area
          type="natural"
          dataKey="revenue"
          stroke={TEAL_600}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4, fill: TEAL_600, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
