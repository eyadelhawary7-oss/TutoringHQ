'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from '@/i18n/routing';
import {
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Users, Building2, AlertTriangle, CheckCircle, Clock, Search,
  Download, RefreshCw, CreditCard, ChevronDown, ChevronRight,
  Info, AlertCircle, ExternalLink,
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { cn } from '@/lib/utils';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { adminCenters } from '@/data/adminMockData';
import type { Plan } from '@/data/adminMockData';

// ─── CONSTANTS ───
const PLAN_PRICES: Record<Plan, number> = {
  starter: 2000, pro: 4500, business: 6500, enterprise: 9000, top_centers: 12000,
};
const PLAN_COLORS: Record<Plan, string> = {
  starter: 'bg-slate-100 text-slate-600 border-slate-200',
  pro: 'bg-blue-50 text-blue-700 border-blue-200',
  business: 'bg-teal-50 text-teal-700 border-teal-200',
  enterprise: 'bg-purple-50 text-purple-700 border-purple-200',
  top_centers: 'bg-amber-50 text-amber-700 border-amber-200',
};
const PLAN_LABELS: Record<Plan, string> = {
  starter: 'Starter', pro: 'Pro', business: 'Business', enterprise: 'Enterprise', top_centers: 'Top Centers',
};

// ─── MOCK DATA ───
const activeCenters = adminCenters.filter(c => c.subscription_status === 'active');
const MRR = activeCenters.reduce((sum, c) => sum + PLAN_PRICES[c.plan], 0);
const ARR = MRR * 12;
const LAST_MONTH_MRR = MRR * 0.92;
const MRR_CHANGE = ((MRR - LAST_MONTH_MRR) / LAST_MONTH_MRR) * 100;

const TOTAL_REVENUE = 161250;
const TOTAL_REV_PREV = 134375;
const REV_CHANGE = ((TOTAL_REVENUE - TOTAL_REV_PREV) / TOTAL_REV_PREV) * 100;

const NRR = 108;
const CHURN_RATE = 1.8;
const COLLECTION_RATE = 82;
const NEW_CENTERS_MONTH = 3;
const PENDING_PIPELINE = 5;

// Sparkline data for total revenue (30 days)
const REVENUE_SPARKLINE = Array.from({ length: 30 }, (_, i) => ({
  d: i + 1,
  v: 3500 + Math.round(Math.sin(i / 4) * 800 + i * 60 + Math.random() * 400),
}));

// MRR bar sparkline (12 months)
const MRR_BARS = [
  { m: 'Mar', v: 8000 }, { m: 'Apr', v: 14500 }, { m: 'May', v: 22000 },
  { m: 'Jun', v: 28000 }, { m: 'Jul', v: 30000 }, { m: 'Aug', v: 32000 },
  { m: 'Sep', v: 34500 }, { m: 'Oct', v: 36000 }, { m: 'Nov', v: 38500 },
  { m: 'Dec', v: 40000 }, { m: 'Jan', v: 42000 }, { m: 'Feb', v: MRR },
];

// Revenue over time (monthly)
const REVENUE_TIMELINE = [
  { period: 'Sep', total: 28000, subscriptions: 8000, cards: 0 },
  { period: 'Oct', total: 24500, subscriptions: 14500, cards: 0 },
  { period: 'Nov', total: 35200, subscriptions: 30000, cards: 200 },
  { period: 'Dec', total: 135800, subscriptions: 120000, cards: 800 },
  { period: 'Jan', total: 146100, subscriptions: 135000, cards: 1100 },
  { period: 'Feb', total: 162510, subscriptions: 146250, cards: 1260 },
];

// Revenue streams donut
const STREAMS = [
  { name: 'Subscriptions', value: 146250, color: '#0D9488' },
  { name: 'Setup Fees', value: 15000, color: '#F59E0B' },
  { name: 'Card Orders', value: 1260, color: '#7C3AED' },
];
const STREAMS_TOTAL = STREAMS.reduce((s, d) => s + d.value, 0);

// YoY
const YOY_DATA = [
  { month: 'Jan', current: 146100, previous: 0 },
  { month: 'Feb', current: 162510, previous: 0 },
  { month: 'Mar', current: 0, previous: 0 },
  { month: 'Apr', current: 0, previous: 0 },
  { month: 'May', current: 0, previous: 0 },
  { month: 'Jun', current: 0, previous: 0 },
  { month: 'Jul', current: 0, previous: 8000 },
  { month: 'Aug', current: 0, previous: 14500 },
  { month: 'Sep', current: 0, previous: 28000 },
  { month: 'Oct', current: 0, previous: 45500 },
  { month: 'Nov', current: 0, previous: 65000 },
  { month: 'Dec', current: 0, previous: 135800 },
];

const CENTER_PERFORMANCE = [
  { rank: 1, name: 'سنتر الأوائل', plan: 'top_centers' as Plan, mrr: 12000, setup: 10000, outstanding: 0, students: 500, lastPayment: '2026-02-20', status: 'active' },
  { rank: 2, name: 'سنتر الريادة', plan: 'enterprise' as Plan, mrr: 9000, setup: 8000, outstanding: 0, students: 400, lastPayment: '2026-01-20', status: 'active' },
  { rank: 3, name: 'سنتر التفوق', plan: 'enterprise' as Plan, mrr: 9000, setup: 8000, outstanding: 0, students: 350, lastPayment: '2026-02-10', status: 'active' },
  { rank: 4, name: 'سنتر المستقبل', plan: 'business' as Plan, mrr: 6500, setup: 5000, outstanding: 0, students: 200, lastPayment: '2026-02-08', status: 'active' },
  { rank: 5, name: 'سنتر النور', plan: 'pro' as Plan, mrr: 4500, setup: 3000, outstanding: 0, students: 120, lastPayment: '2026-02-01', status: 'active' },
  { rank: 6, name: 'سنتر الإبداع', plan: 'pro' as Plan, mrr: 4500, setup: 3000, outstanding: 13500, students: 95, lastPayment: '2026-01-28', status: 'active' },
  { rank: 7, name: 'سنتر الأمل', plan: 'starter' as Plan, mrr: 2000, setup: 1500, outstanding: 6000, students: 80, lastPayment: '2026-01-15', status: 'active' },
  { rank: 8, name: 'سنتر النجاح', plan: 'pro' as Plan, mrr: 4500, setup: 3000, outstanding: 0, students: 45, lastPayment: '2026-02-15', status: 'active' },
  { rank: 9, name: 'سنتر التميز', plan: 'starter' as Plan, mrr: 2000, setup: 1500, outstanding: 2150, students: 60, lastPayment: '2026-01-10', status: 'active' },
  { rank: 10, name: 'سنتر العلم', plan: 'starter' as Plan, mrr: 2000, setup: 1500, outstanding: 13500, students: 30, lastPayment: '2025-12-15', status: 'suspended' },
];

const UPCOMING_RENEWALS = [
  { center: 'سنتر العلم', amount: 2150, due: '2026-03-01', status: 'overdue' },
  { center: 'سنتر التميز', amount: 2150, due: '2026-03-05', status: 'pending' },
  { center: 'سنتر القمة', amount: 19500, due: '2026-03-15', status: 'pending' },
  { center: 'سنتر النجاح', amount: 13500, due: '2026-04-01', status: 'pending' },
  { center: 'سنتر الأمل', amount: 6000, due: '2026-04-15', status: 'pending' },
];

const ARPC = Math.round(MRR / activeCenters.length);
const CAC = 2200;
const AVG_LIFETIME_MONTHS = 18;
const LTV = ARPC * AVG_LIFETIME_MONTHS;
const LTV_CAC_RATIO = Math.round((LTV / CAC) * 10) / 10;

const cashInThisMonth = TOTAL_REVENUE;
const expectedNextMonth = activeCenters.reduce((s, c) => s + PLAN_PRICES[c.plan], 0);
const atRiskAmount = CENTER_PERFORMANCE.filter(c => c.outstanding > 0).reduce((s, c) => s + c.outstanding, 0);

// ─── HELPERS ───
function fmtEGP(n: number) {
  return 'EGP ' + n.toLocaleString('en-EG');
}

function TrendPill({ value, suffix = '%' }: { value: number; suffix?: string }) {
  const positive = value >= 0;
  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
      positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
    )}>
      {positive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {positive ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 mt-10 mb-4">{children}</h2>
  );
}

type DateRange = '7d' | '30d' | '90d' | 'year' | 'custom';

// Custom tooltip for charts
function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-slate-500 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-600">{entry.name}:</span>
          <span className="font-mono font-semibold text-slate-900">{fmtEGP(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function CeoDashboard() {
  const pathname = usePathname();
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [centerSearch, setCenterSearch] = useState('');
  const [sortCol, setSortCol] = useState<string>('rank');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [chartTab, setChartTab] = useState<'monthly' | 'weekly' | 'daily'>('monthly');
  const [unitEconOpen, setUnitEconOpen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setLastUpdated(new Date()), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const minutesAgo = Math.round((Date.now() - lastUpdated.getTime()) / 60000);

  const dateRangeLabels: Record<DateRange, string> = {
    '7d': 'Last 7 Days', '30d': 'Last 30 Days', '90d': 'Last 90 Days',
    'year': 'This Year', 'custom': 'Custom Range',
  };

  // Table sorting
  const filteredPerf = CENTER_PERFORMANCE.filter(c =>
    c.name.includes(centerSearch) || PLAN_LABELS[c.plan].toLowerCase().includes(centerSearch.toLowerCase())
  );
  const sortedPerf = [...filteredPerf].sort((a, b) => {
    const key = sortCol as keyof typeof a;
    const av = a[key] ?? 0;
    const bv = b[key] ?? 0;
    if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const rankMedal = (r: number) => r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : String(r);

  return (
    <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen">
      <AdminSidebar activeRoute={pathname} />

      <div className="flex-1 overflow-auto mt-12 md:mt-0 bg-[#F8FAFC]">
        {/* ─── TOP BAR ─── */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">CEO Dashboard</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <RefreshCw size={11} className="text-slate-400" />
                <span className="text-[11px] text-slate-400">
                  Updated {minutesAgo === 0 ? 'just now' : `${minutesAgo}m ago`}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Date Range */}
              <div className="relative">
                <button
                  onClick={() => setShowDateDropdown(!showDateDropdown)}
                  className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:shadow transition-shadow"
                >
                  {dateRangeLabels[dateRange]}
                  <ChevronDown size={14} className="text-slate-400" />
                </button>
                {showDateDropdown && (
                  <div className="absolute right-0 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg z-50">
                    {(Object.entries(dateRangeLabels) as [DateRange, string][]).map(([k, label]) => (
                      <button key={k} onClick={() => { setDateRange(k); setShowDateDropdown(false); }}
                        className={cn('w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors',
                          dateRange === k ? 'text-teal-700 bg-teal-50 font-medium' : 'text-slate-600'
                        )}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
              {/* Compare */}
              <button className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-500 shadow-sm hover:shadow transition-shadow">
                Compare to: Previous period
                <ChevronDown size={14} className="text-slate-400" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 max-w-[1400px] mx-auto space-y-0">

          {/* ═══════════════════════════════════════════════
              ROW 1 — 3 Large KPI Cards
          ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
            {/* Total Revenue */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-semibold text-slate-500">Total Revenue</span>
                <TrendPill value={REV_CHANGE} />
              </div>
              <div className="font-mono text-[32px] font-bold text-slate-900 leading-tight">{fmtEGP(TOTAL_REVENUE)}</div>
              <div className="h-16 mt-3 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={REVENUE_SPARKLINE}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0D9488" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#0D9488" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="v" stroke="#0D9488" strokeWidth={1.5} fill="url(#revFill)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Subscriptions + Setup Fees + Card Orders</p>
            </div>

            {/* MRR */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-semibold text-slate-500">MRR</span>
                <TrendPill value={MRR_CHANGE} />
              </div>
              <div className="font-mono text-[32px] font-bold text-slate-900 leading-tight">{fmtEGP(MRR)}</div>
              <div className="h-16 mt-3 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={MRR_BARS} barSize={8}>
                    <Bar dataKey="v" fill="#0D9488" radius={[2, 2, 0, 0]} opacity={0.7} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Monthly Recurring Revenue · ARR: <span className="font-mono font-semibold">{fmtEGP(ARR)}</span></p>
            </div>

            {/* NRR */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-semibold text-slate-500">Net Revenue Retention</span>
                <span className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  NRR > 100 ? 'bg-emerald-50 text-emerald-700' : NRR >= 90 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
                )}>{NRR > 100 ? 'Expanding' : 'Contracting'}</span>
              </div>
              <div className={cn(
                'font-mono text-[32px] font-bold leading-tight',
                NRR > 100 ? 'text-emerald-700' : NRR >= 90 ? 'text-amber-600' : 'text-red-600'
              )}>{NRR}%</div>
              <div className="flex items-center justify-center mt-3 h-16">
                <div className="w-20 h-20 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[{ v: NRR }, { v: Math.max(0, 120 - NRR) }]} dataKey="v" cx="50%" cy="50%" innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} strokeWidth={0}>
                        <Cell fill="#0D9488" />
                        <Cell fill="#E2E8F0" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-mono text-[11px] font-bold text-slate-700">{NRR}%</span>
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mt-1 text-center">Expansion revenue included</p>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
              ROW 2 — 4 Smaller Metric Cards
          ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            {/* Active Centers */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Building2 size={16} className="text-blue-600" />
                </div>
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900">{activeCenters.length}</div>
              <span className="text-[13px] font-medium text-slate-500">Active Centers</span>
              <p className="text-[11px] text-slate-400 mt-1">+{NEW_CENTERS_MONTH} new, -1 churned vs last month</p>
            </div>

            {/* New This Month */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                  <Users size={16} className="text-teal-600" />
                </div>
              </div>
              <div className="font-mono text-2xl font-bold text-slate-900">{NEW_CENTERS_MONTH}</div>
              <span className="text-[13px] font-medium text-slate-500">New This Month</span>
              <p className="text-[11px] text-slate-400 mt-1">{PENDING_PIPELINE} in pipeline</p>
            </div>

            {/* Churn Rate */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center',
                  CHURN_RATE < 2 ? 'bg-emerald-50' : CHURN_RATE < 5 ? 'bg-amber-50' : 'bg-red-50'
                )}>
                  <TrendingDown size={16} className={CHURN_RATE < 2 ? 'text-emerald-600' : CHURN_RATE < 5 ? 'text-amber-600' : 'text-red-600'} />
                </div>
              </div>
              <div className={cn('font-mono text-2xl font-bold',
                CHURN_RATE < 2 ? 'text-emerald-700' : CHURN_RATE < 5 ? 'text-amber-600' : 'text-red-600'
              )}>{CHURN_RATE}%</div>
              <span className="text-[13px] font-medium text-slate-500">Churn Rate</span>
              <p className="text-[11px] text-slate-400 mt-1">&lt;2% target</p>
            </div>

            {/* Collection Rate */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-2">
                <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center',
                  COLLECTION_RATE > 90 ? 'bg-emerald-50' : COLLECTION_RATE > 75 ? 'bg-amber-50' : 'bg-red-50'
                )}>
                  <CreditCard size={16} className={COLLECTION_RATE > 90 ? 'text-emerald-600' : COLLECTION_RATE > 75 ? 'text-amber-600' : 'text-red-600'} />
                </div>
              </div>
              <div className={cn('font-mono text-2xl font-bold',
                COLLECTION_RATE > 90 ? 'text-emerald-700' : COLLECTION_RATE > 75 ? 'text-amber-600' : 'text-red-600'
              )}>{COLLECTION_RATE}%</div>
              <span className="text-[13px] font-medium text-slate-500">Collection Rate</span>
              <p className="text-[11px] text-slate-400 mt-1">{COLLECTION_RATE > 90 ? 'On track' : COLLECTION_RATE > 75 ? 'Needs attention' : 'Critical'}</p>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
              ROW 3 — Revenue Over Time + Revenue Streams
          ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mt-4">
            {/* Revenue Over Time (60%) */}
            <div className="lg:col-span-3 bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[13px] font-semibold text-slate-600">Revenue Over Time</h3>
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  {(['monthly', 'weekly', 'daily'] as const).map(t => (
                    <button key={t} onClick={() => setChartTab(t)} className={cn(
                      'px-3 py-1 text-[11px] font-medium transition-colors capitalize',
                      chartTab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
                    )}>{t}</button>
                  ))}
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={REVENUE_TIMELINE}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="total" name="Total Revenue" stroke="#0D9488" strokeWidth={2} dot={{ r: 3, fill: '#0D9488' }} />
                  <Line type="monotone" dataKey="subscriptions" name="Subscriptions" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                  <Line type="monotone" dataKey="cards" name="Card Orders" stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-5 mt-2 px-2">
                {[
                  { label: 'Total Revenue', color: '#0D9488', dash: false },
                  { label: 'Subscriptions', color: '#3B82F6', dash: true },
                  { label: 'Card Orders', color: '#7C3AED', dash: true },
                ].map(l => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className="w-4 h-0.5 rounded" style={{ backgroundColor: l.color, ...(l.dash ? { backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, white 2px, white 4px)' } : {}) }} />
                    <span className="text-[10px] text-slate-400">{l.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue Streams Donut (40%) */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-[13px] font-semibold text-slate-600 mb-4">Revenue Streams</h3>
              <div className="flex justify-center">
                <div className="w-44 h-44 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={STREAMS} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={70} strokeWidth={2} stroke="#fff">
                        {STREAMS.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[10px] text-slate-400">Total</span>
                    <span className="font-mono text-sm font-bold text-slate-900">{fmtEGP(STREAMS_TOTAL)}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {STREAMS.map(s => (
                  <div key={s.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                      <span className="text-xs text-slate-600">{s.name}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-xs font-semibold text-slate-900">{fmtEGP(s.value)}</span>
                      <span className="text-[10px] text-slate-400 ml-2">{((s.value / STREAMS_TOTAL) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
              ROW 4 — YoY + Cash Flow
          ═══════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            {/* YoY Comparison */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-[13px] font-semibold text-slate-600 mb-4">Year on Year Comparison</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={YOY_DATA}>
                  <defs>
                    <linearGradient id="yoyCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0D9488" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="#0D9488" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Area type="monotone" dataKey="current" name="2026" stroke="#0D9488" strokeWidth={2} fill="url(#yoyCurrent)" dot={{ r: 3, fill: '#0D9488' }} />
                  <Line type="monotone" dataKey="previous" name="2025" stroke="#CBD5E1" strokeWidth={1.5} strokeDasharray="6 3" dot={{ r: 2, fill: '#CBD5E1' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Cash Flow */}
            <div className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-[13px] font-semibold text-slate-600 mb-4">Cash Flow</h3>
              <div className="space-y-3 mb-5">
                {[
                  { label: 'Cash In', value: cashInThisMonth, color: 'text-emerald-700', bg: 'bg-emerald-50', icon: '↑' },
                  { label: 'Expected Next 30 Days', value: expectedNextMonth, color: 'text-blue-700', bg: 'bg-blue-50', icon: '→' },
                  { label: 'At Risk (>30 days overdue)', value: atRiskAmount, color: 'text-red-700', bg: 'bg-red-50', icon: '!' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-2.5 px-3 rounded-lg bg-slate-50/80">
                    <div className="flex items-center gap-2.5">
                      <span className={cn('w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold', row.bg, row.color)}>{row.icon}</span>
                      <span className="text-sm text-slate-600">{row.label}</span>
                    </div>
                    <span className={cn('font-mono text-sm font-bold', row.color)}>{fmtEGP(row.value)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Next Renewals</p>
              <div className="space-y-0">
                {UPCOMING_RENEWALS.slice(0, 5).map((r, i) => (
                  <div key={i} className={cn('flex items-center justify-between py-2 text-xs', i > 0 && 'border-t border-slate-100')}>
                    <span className="text-slate-700 font-medium" dir="rtl">{r.center}</span>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-slate-600">{fmtEGP(r.amount)}</span>
                      <span className="text-slate-400">{new Date(r.due).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                      <span className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        r.status === 'overdue' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                      )}>{r.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
              ROW 5 — Center Performance Table
          ═══════════════════════════════════════════════ */}
          <SectionLabel>Top Centers by Revenue</SectionLabel>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            <div className="p-4 flex flex-wrap gap-3 items-center border-b border-slate-100">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
                <input
                  value={centerSearch} onChange={e => setCenterSearch(e.target.value)}
                  placeholder="Search centers..."
                  className="w-full ps-9 pe-4 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-400 transition-all"
                />
              </div>
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-500 hover:bg-slate-50 transition-colors">
                <Download size={13} /> Export Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 sticky top-0 z-[1]">
                  <tr>
                    {[
                      { key: 'rank', label: 'Rank', w: 'w-16' },
                      { key: 'name', label: 'Center' },
                      { key: 'plan', label: 'Plan' },
                      { key: 'mrr', label: 'Monthly Revenue' },
                      { key: 'setup', label: 'Setup Fee' },
                      { key: 'outstanding', label: 'Outstanding' },
                      { key: 'students', label: 'Students' },
                      { key: 'lastPayment', label: 'Last Payment' },
                      { key: 'status', label: 'Status' },
                      { key: 'action', label: '' },
                    ].map(col => (
                      <th key={col.key} onClick={() => col.key !== 'action' && handleSort(col.key)}
                        className={cn(
                          'text-start px-4 py-3 text-[11px] font-semibold text-slate-400 uppercase tracking-wider select-none',
                          col.key !== 'action' && 'cursor-pointer hover:text-slate-600',
                          col.w
                        )}>
                        {col.label} {sortCol === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPerf.map((c, idx) => (
                    <tr key={c.rank} className={cn(
                      'border-t border-slate-100 hover:bg-slate-50/80 transition-colors',
                      idx % 2 === 1 && 'bg-slate-50/40'
                    )}>
                      <td className="px-4 py-3 font-mono text-sm font-bold text-slate-500">{rankMedal(c.rank)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800" dir="rtl">{c.name}</td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold border', PLAN_COLORS[c.plan])}>
                          {PLAN_LABELS[c.plan]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-700">{fmtEGP(c.mrr)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{fmtEGP(c.setup)}</td>
                      <td className={cn("px-4 py-3 font-mono text-xs font-semibold", c.outstanding > 0 ? 'text-red-600' : 'text-slate-300')}>
                        {c.outstanding > 0 ? fmtEGP(c.outstanding) : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{c.students}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{new Date(c.lastPayment).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold',
                          c.status === 'active' ? 'bg-emerald-50 text-emerald-700' :
                          c.status === 'suspended' ? 'bg-red-50 text-red-600' :
                          'bg-amber-50 text-amber-600'
                        )}>{c.status}</span>
                      </td>
                      <td className="px-4 py-3">
                        <button className="text-xs text-teal-600 hover:text-teal-800 font-medium flex items-center gap-0.5">
                          View <ExternalLink size={10} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
              ROW 6 — Alerts
          ═══════════════════════════════════════════════ */}
          <SectionLabel>Alerts & Actions</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Needs Attention */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden border-l-4 border-l-red-500">
              <div className="p-4">
                <h3 className="text-xs font-bold text-red-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Needs Attention
                </h3>
                <div className="space-y-2.5">
                  {[
                    { text: '2 overdue payments (>30 days)', action: 'Resolve' },
                    { text: '1 suspended center', action: 'Resolve' },
                    { text: '3 pending approvals', action: 'Review' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{item.text}</span>
                      <button className="text-[11px] text-red-600 hover:text-red-800 font-semibold flex items-center gap-0.5">
                        {item.action} <ChevronRight size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Watch List */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden border-l-4 border-l-amber-400">
              <div className="p-4">
                <h3 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Clock size={13} /> Watch List
                </h3>
                <div className="space-y-2.5">
                  {[
                    { text: '3 outstanding >50% of fee' },
                    { text: '2 no login in >14 days' },
                    { text: '1 downgrade request' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Wins */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden border-l-4 border-l-emerald-500">
              <div className="p-4">
                <h3 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <CheckCircle size={13} /> Wins
                </h3>
                <div className="space-y-2.5">
                  {[
                    { text: '3 new signups today' },
                    { text: '4 payments received today' },
                    { text: '2 plan upgrades this week' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      {item.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════
              UNIT ECONOMICS (Collapsible)
          ═══════════════════════════════════════════════ */}
          <div className="mt-8">
            <button
              type="button"
              onClick={() => setUnitEconOpen(!unitEconOpen)}
              className="flex items-center gap-2 w-full text-left group"
            >
              <ChevronRight size={14} className={cn('text-slate-400 transition-transform', unitEconOpen && 'rotate-90')} />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 group-hover:text-slate-600 transition-colors">Unit Economics</span>
            </button>
            {unitEconOpen && (
              <div className="mt-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'ARPC', value: fmtEGP(ARPC), tip: 'Average Revenue Per Center = Total MRR ÷ Active Centers', color: 'text-teal-700' },
                    { label: 'CAC', value: fmtEGP(CAC), tip: 'Customer Acquisition Cost — average spend to acquire one center', color: 'text-amber-600' },
                    { label: 'LTV', value: fmtEGP(LTV), tip: `Lifetime Value = ARPC × ${AVG_LIFETIME_MONTHS} months avg lifetime`, color: 'text-blue-700' },
                    { label: 'LTV:CAC', value: `${LTV_CAC_RATIO}x`, tip: 'Ratio of customer lifetime value to acquisition cost. >10x is excellent.', color: LTV_CAC_RATIO > 10 ? 'text-emerald-700' : LTV_CAC_RATIO > 5 ? 'text-amber-600' : 'text-red-600' },
                  ].map(metric => (
                    <div key={metric.label} className="bg-white rounded-xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[13px] font-semibold text-slate-500">{metric.label}</span>
                        <span title={metric.tip} className="cursor-help"><Info size={12} className="text-slate-300" /></span>
                      </div>
                      <div className={cn('font-mono text-2xl font-bold', metric.color)}>{metric.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="h-10" />
        </div>
      </div>
    </div>
  );
}
