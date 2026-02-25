'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import {
  Package, Clock, Printer, Truck, CheckCircle, X, MessageCircle, Eye, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CardTemplatePreview from '@/components/CardTemplatePreview';
import { AdminSidebar } from '@/components/AdminSidebar';

interface CardOrder {
  id: string;
  orderNumber: string;
  centerName: string;
  centerLogo: string | null;
  students: { name: string; number: string }[];
  total: number;
  deliveryFee: number;
  deliveryAddress: string;
  notes: string;
  status: 'pending' | 'confirmed' | 'printing' | 'shipped' | 'delivered';
  createdAt: string;
  phone: string;
  cardColor: string;
}

const MOCK_ORDERS: CardOrder[] = [
  {
    id: 'co1', orderNumber: 'ORD-001', centerName: 'سنتر النجاح', centerLogo: null,
    students: [
      { name: 'أحمد محمد', number: 'STU-00001' },
      { name: 'سارة أحمد', number: 'STU-00002' },
      { name: 'محمد علي', number: 'STU-00003' },
    ],
    total: 59, deliveryFee: 50, deliveryAddress: '15 شارع الأزهر، مدينة نصر، القاهرة',
    notes: 'Please include protective sleeves', status: 'pending', createdAt: '2026-02-24T10:30:00Z', phone: '01099999999', cardColor: '#0D9488',
  },
  {
    id: 'co2', orderNumber: 'ORD-002', centerName: 'سنتر النور', centerLogo: null,
    students: [
      { name: 'خالد أحمد', number: 'STU-00010' },
      { name: 'فاطمة محمود', number: 'STU-00011' },
    ],
    total: 56, deliveryFee: 50, deliveryAddress: '25 شارع العروبة، الهليوبوليس',
    notes: '', status: 'confirmed', createdAt: '2026-02-23T14:00:00Z', phone: '01212340001', cardColor: '#1E40AF',
  },
  {
    id: 'co3', orderNumber: 'ORD-003', centerName: 'سنتر المستقبل', centerLogo: null,
    students: Array.from({ length: 10 }, (_, i) => ({ name: `طالب ${i + 1}`, number: `STU-000${20 + i}` })),
    total: 80, deliveryFee: 50, deliveryAddress: '8 شارع التحرير، الدقي',
    notes: '', status: 'printing', createdAt: '2026-02-22T09:00:00Z', phone: '01512340001', cardColor: '#7C3AED',
  },
  {
    id: 'co4', orderNumber: 'ORD-004', centerName: 'سنتر التفوق', centerLogo: null,
    students: Array.from({ length: 5 }, (_, i) => ({ name: `طالب ${i + 1}`, number: `STU-000${30 + i}` })),
    total: 65, deliveryFee: 50, deliveryAddress: '12 شارع الملك فيصل، ٦ أكتوبر',
    notes: 'Urgent delivery please', status: 'shipped', createdAt: '2026-02-20T16:00:00Z', phone: '01023450001', cardColor: '#E11D48',
  },
  {
    id: 'co5', orderNumber: 'ORD-005', centerName: 'سنتر الريادة', centerLogo: null,
    students: Array.from({ length: 20 }, (_, i) => ({ name: `طالب ${i + 1}`, number: `STU-000${40 + i}` })),
    total: 110, deliveryFee: 50, deliveryAddress: '3 شارع جامعة الدول، المهندسين',
    notes: '', status: 'delivered', createdAt: '2026-02-18T11:00:00Z', phone: '01556780001', cardColor: '#059669',
  },
];

const STATUS_CONFIG: Record<CardOrder['status'], { color: string; bg: string; icon: React.ElementType; label: string }> = {
  pending: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', icon: Clock, label: 'statusPending' },
  confirmed: { color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', icon: CheckCircle, label: 'statusConfirmed' },
  printing: { color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-500/10', icon: Printer, label: 'statusPrinting' },
  shipped: { color: 'text-teal-600 dark:text-teal-400', bg: 'bg-teal-500/10', icon: Truck, label: 'statusShipped' },
  delivered: { color: 'text-green-600 dark:text-green-400', bg: 'bg-green-500/10', icon: CheckCircle, label: 'statusDelivered' },
};

const FILTERS: CardOrder['status'][] = ['pending', 'confirmed', 'printing', 'shipped', 'delivered'];

function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [523, 659, 784].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
      o.start(ctx.currentTime + i * 0.15);
      o.stop(ctx.currentTime + i * 0.15 + 0.3);
    });
  } catch { /* ignore */ }
}

export default function AdminOrders() {
  const tIdCards = useTranslations('idCards');
  const tCommon = useTranslations('common');
  const tAdmin = useTranslations('admin');
  const pathname = usePathname();
  const [orders, setOrders] = useState(MOCK_ORDERS);
  const [filter, setFilter] = useState<'all' | CardOrder['status']>('all');
  const [slideOverId, setSlideOverId] = useState<string | null>(null);
  const [showNewBanner, setShowNewBanner] = useState(true);

  // Play chime on mount for demo
  useEffect(() => {
    if (showNewBanner) {
      playChime();
      const timer = setTimeout(() => setShowNewBanner(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [showNewBanner]);

  const filteredOrders = filter === 'all' ? orders : orders.filter(o => o.status === filter);
  const slideOrder = orders.find(o => o.id === slideOverId);

  const kpis = [
    { label: tIdCards('totalOrders'), value: orders.length, icon: Package, color: '#3B82F6' },
    { label: tIdCards('statusPending'), value: orders.filter(o => o.status === 'pending').length, icon: Clock, color: '#F59E0B' },
    { label: tIdCards('statusPrinting'), value: orders.filter(o => o.status === 'printing').length, icon: Printer, color: '#7C3AED' },
    { label: tIdCards('statusDelivered'), value: orders.filter(o => o.status === 'delivered').length, icon: CheckCircle, color: '#16A34A' },
  ];

  const updateStatus = (orderId: string, newStatus: CardOrder['status']) => {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
  };

  return (
    <div className="flex min-h-[calc(100vh-56px)] md:min-h-screen">
      <AdminSidebar activeRoute={pathname} />
      <div className="flex-1 p-4 md:p-6 space-y-5 overflow-auto mt-12 md:mt-0 animate-fade-in">
      {/* New order notification banner */}
      {showNewBanner && (
        <div className="relative overflow-hidden rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 flex items-center gap-3 animate-fade-in">
          <span className="text-lg">🪪</span>
          <div className="flex-1">
            <span className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {tIdCards('newOrderBanner')} سنتر النجاح!
            </span>
            <button
              onClick={() => { setShowNewBanner(false); setSlideOverId('co1'); }}
              className="text-sm text-amber-700 dark:text-amber-400 ms-2 hover:underline"
            >
              — {tIdCards('viewOrder')}
            </button>
          </div>
          <button onClick={() => setShowNewBanner(false)} className="p-1 rounded hover:bg-amber-500/20">
            <X size={14} className="text-amber-600 dark:text-amber-400" />
          </button>
        </div>
      )}

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">{tIdCards('adminTitle')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{tIdCards('adminSubtitle')}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="ch-card p-4">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: `${color}18`, color }}>
              <Icon size={16} />
            </div>
            <div className="text-xl font-black font-mono text-foreground">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', filter === 'all' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}
        >
          {tCommon('all')}
        </button>
        {FILTERS.map(f => {
          const cfg = STATUS_CONFIG[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', filter === f ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted')}
            >
              {tIdCards(cfg.label)}
            </button>
          );
        })}
      </div>

      {/* Orders table */}
      <div className="ch-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead style={{ background: 'hsl(var(--muted))' }}>
              <tr>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tIdCards('orderNumber')}</th>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tAdmin('center')}</th>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tIdCards('cards')}</th>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tIdCards('total')}</th>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('status')}</th>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('date')}</th>
                <th className="text-start px-4 py-3 font-medium text-muted-foreground">{tCommon('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => {
                const cfg = STATUS_CONFIG[order.status];
                const StatusIcon = cfg.icon;
                return (
                  <tr key={order.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{order.orderNumber}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{order.centerName}</td>
                    <td className="px-4 py-3 font-mono text-muted-foreground">{order.students.length}</td>
                    <td className="px-4 py-3 font-mono font-bold text-foreground">{order.total} {tCommon('egp')}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', cfg.bg, cfg.color)}>
                        <StatusIcon size={10} /> {tIdCards(cfg.label)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSlideOverId(order.id)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Eye size={12} /> {tCommon('view')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {filteredOrders.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            {/* CSS art placeholder */}
            <div className="mx-auto mb-4 w-20 h-20 relative">
              <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-muted-foreground/20" />
              <div className="absolute top-3 left-3 right-3 h-3 rounded bg-muted-foreground/10" />
              <div className="absolute top-8 left-3 right-6 h-2 rounded bg-muted-foreground/8" />
              <div className="absolute top-12 left-3 right-8 h-2 rounded bg-muted-foreground/6" />
            </div>
            <p className="font-medium">{tIdCards('noOrders')}</p>
            <p className="text-sm mt-1">{tIdCards('noOrdersDesc')}</p>
          </div>
        )}
      </div>

      {/* Slide-over detail panel */}
      {slideOrder && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSlideOverId(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-card border-s border-border h-full overflow-y-auto animate-fade-in"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'slideInRight 0.3s ease' }}
          >
            {/* Header */}
            <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-foreground">{slideOrder.orderNumber}</span>
                {(() => {
                  const cfg = STATUS_CONFIG[slideOrder.status];
                  const Icon = cfg.icon;
                  return (
                    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', cfg.bg, cfg.color)}>
                      <Icon size={10} /> {tIdCards(cfg.label)}
                    </span>
                  );
                })()}
              </div>
              <button onClick={() => setSlideOverId(null)} className="p-1.5 rounded-lg hover:bg-muted">
                <X size={18} className="text-muted-foreground" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Card preview */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-3">{tIdCards('cardPreview')}</h4>
                <div className="flex justify-center">
                  <CardTemplatePreview
                    centerName={slideOrder.centerName}
                    centerLogo={slideOrder.centerLogo}
                    studentName={slideOrder.students[0]?.name || '—'}
                    studentNumber={slideOrder.students[0]?.number || 'STU-XXXXX'}
                    color={slideOrder.cardColor}
                    className="scale-[0.85] origin-top"
                  />
                </div>
              </div>

              {/* Students */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">{tCommon('students')} ({slideOrder.students.length})</h4>
                <div className="ch-card p-3 max-h-[200px] overflow-y-auto space-y-1">
                  {slideOrder.students.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 py-1">
                      <span className="text-sm text-foreground">{s.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground ms-auto">{s.number}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Delivery info */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{tIdCards('deliveryAddress')}</h4>
                <p className="text-sm text-foreground">{slideOrder.deliveryAddress}</p>
              </div>
              {slideOrder.notes && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{tIdCards('notes')}</h4>
                  <p className="text-sm text-foreground">{slideOrder.notes}</p>
                </div>
              )}

              {/* Price breakdown */}
              <div className="ch-card p-4">
                <div className="flex justify-between text-sm text-foreground mb-2">
                  <span>{slideOrder.students.length} {tIdCards('cards')} × 3 {tCommon('egp')}</span>
                  <span className="font-mono font-bold">{slideOrder.students.length * 3} {tCommon('egp')}</span>
                </div>
                <div className="flex justify-between text-sm text-foreground mb-3">
                  <span>{tIdCards('delivery')}</span>
                  <span className="font-mono font-bold">{slideOrder.deliveryFee} {tCommon('egp')}</span>
                </div>
                <div className="border-t border-border pt-3 flex justify-between">
                  <span className="font-bold text-foreground">{tIdCards('total')}</span>
                  <span className="font-mono font-black text-lg" style={{ color: slideOrder.cardColor }}>{slideOrder.total} {tCommon('egp')}</span>
                </div>
              </div>

              {/* Status update */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">{tIdCards('updateStatus')}</h4>
                <select
                  value={slideOrder.status}
                  onChange={e => updateStatus(slideOrder.id, e.target.value as CardOrder['status'])}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm"
                >
                  {FILTERS.map(s => (
                    <option key={s} value={s}>{tIdCards(STATUS_CONFIG[s].label)}</option>
                  ))}
                </select>
              </div>

              {/* WhatsApp button */}
              <a
                href={`https://wa.me/${slideOrder.phone}?text=${encodeURIComponent(`مرحبا، طلب البطاقات رقم ${slideOrder.orderNumber} جاهز`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
                style={{ background: '#25D366' }}
              >
                <MessageCircle size={14} /> WhatsApp Center
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      </div>
    </div>
  );
}
