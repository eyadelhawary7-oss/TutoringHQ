'use client';

import { useTranslations } from 'next-intl';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface RevenueStackedChartProps {
  data: { date: string; day: string; cash: number; instapay: number; vodafone: number; orange: number; fawry: number; bank: number; other: number }[];
}

const COLORS = {
  cash: '#16A34A',
  instapay: '#0D9488',
  vodafone: '#DC2626',
  orange: '#F59E0B',
  fawry: '#7C3AED',
  bank: '#1E293B',
  other: '#64748B',
};

export default function RevenueStackedChart({ data = [] }: RevenueStackedChartProps) {
  const t = useTranslations('dashboard');

  if (!data?.length) {
    return (
        <div className="flex items-center justify-center h-[200px] text-muted-foreground">
        <p className="text-sm">---</p>
      </div>
    );
  }

  const chartData = data.map(d => ({ ...d, day: d.day }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
        <Tooltip formatter={(v: number | undefined) => `${Math.round((v ?? 0)).toLocaleString('en-US')} ج.م`} />
        <Legend />
        <Bar dataKey="cash" fill={COLORS.cash} stackId="a" name={t('methodCash')} />
        <Bar dataKey="instapay" fill={COLORS.instapay} stackId="a" name={t('methodInstapay')} />
        <Bar dataKey="vodafone" fill={COLORS.vodafone} stackId="a" name={t('methodVodafone')} />
        <Bar dataKey="orange" fill={COLORS.orange} stackId="a" name="Orange Cash" />
        <Bar dataKey="fawry" fill={COLORS.fawry} stackId="a" name={t('methodFawry')} />
        <Bar dataKey="bank" fill={COLORS.bank} stackId="a" name="Bank" />
        <Bar dataKey="other" fill={COLORS.other} stackId="a" name="Other" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
