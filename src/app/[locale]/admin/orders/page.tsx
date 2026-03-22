'use client';

import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import {
  Package, Clock, Printer, Truck, CheckCircle, X, MessageCircle, Eye, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CardTemplatePreview from '@/components/CardTemplatePreview';
import { AdminSidebar } from '@/components/AdminSidebar';
import { useSidebar } from '@/contexts/SidebarContext';

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
  const { closeMainSidebar } = useSidebar() ?? {};
  const [orders, setOrders] = useState(MOCK_ORDERS);
  const [filter, setFilter] = useState<'all' | CardOrder['status']>('all');
  const [slideOverId, setSlideOverId] = useState<string | null>(null);
  const [showNewBanner, setShowNewBanner] = useState(true);

  // Close main sidebar when admin/orders mounts (prevents two sidebars on mobile)
  useEffect(() => {
    if (typeof closeMainSidebar === 'function') closeMainSidebar();
  }, [closeMainSidebar]);

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
      <div className="w-full flex-1 p-6 space-y-5 overflow-auto mt-12 md:mt-0 animate-fade-in min-w-0">
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
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{tIdCards('adminTitle')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{tIdCards('adminSubtitle')}</p>
      </div>

      {/* KPIs — grid + card shell match admin overview (REVENUE stat row) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {kpis.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm p-6"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-[var(--color-text-secondary)] mb-1">{label}</p>
                <p className="text-2xl font-bold text-[var(--color-text-primary)] font-mono">{value}</p>
              </div>
              <div
                className="p-3 rounded-full shrink-0 flex items-center justify-center"
                style={{ background: `${color}22` }}
              >
                <Icon className="w-5 h-5" style={{ color }} aria-hidden />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', filter === 'all' ? 'bg-primary/10 text-primary' : 'text-[var(--color-text-secondary)] hover:bg-muted')}
        >
          {tCommon('all')}
        </button>
        {FILTERS.map(f => {
          const cfg = STATUS_CONFIG[f];
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', filter === f ? 'bg-primary/10 text-primary' : 'text-[var(--color-text-secondary)] hover:bg-muted')}
            >
              {tIdCards(cfg.label)}
            </button>
          );
        })}
      </div>

      {/* Orders table */}
      <div className="rounded-xl border border-[var(--color-border-subtle)] overflow-hidden bg-[var(--color-surface-1)]">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[var(--color-surface-2)]">
              <tr>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tIdCards('orderNumber')}</th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tAdmin('center')}</th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tIdCards('cards')}</th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tIdCards('total')}</th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('status')}</th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('date')}</th>
                <th className="px-4 py-3 text-start text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wider">{tCommon('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map(order => {
                const cfg = STATUS_CONFIG[order.status];
                const StatusIcon = cfg.icon;
                return (
                  <tr key={order.id} className="border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-0)] transition-colors">
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono">{order.orderNumber}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-medium">{order.centerName}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono">{order.students.length}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)] font-mono font-bold">{order.total} {tCommon('egp')}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                      <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', cfg.bg, cfg.color)}>
                        <StatusIcon size={10} /> {tIdCards(cfg.label)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                      {new Date(order.createdAt).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">
                      <button
                        type="button"
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
        {filteredOrders.length === 0 && (
          <div className="text-center py-16 text-[var(--color-text-secondary)] border-t border-[var(--color-border-subtle)]">
            <div className="mx-auto mb-4 w-20 h-20 relative">
              <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-[var(--color-border-default)]/40" />
              <div className="absolute top-3 start-3 end-3 h-3 rounded bg-[var(--color-text-tertiary)]/10" />
              <div className="absolute top-8 start-3 end-6 h-2 rounded bg-[var(--color-text-tertiary)]/8" />
              <div className="absolute top-12 start-3 end-8 h-2 rounded bg-[var(--color-text-tertiary)]/6" />
            </div>
            <p className="font-medium text-[var(--color-text-primary)]">{tIdCards('noOrders')}</p>
            <p className="text-sm mt-1">{tIdCards('noOrdersDesc')}</p>
          </div>
        )}
      </div>

      {/* Slide-over detail panel */}
      {slideOrder && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSlideOverId(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md bg-[var(--color-surface-1)] border-s border-border h-full overflow-y-auto animate-fade-in"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'slideInRight 0.3s ease' }}
          >
            {/* Header */}
            <div className="sticky top-0 bg-[var(--color-surface-1)] border-b border-border px-5 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-[var(--color-text-primary)]">{slideOrder.orderNumber}</span>
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
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Card preview */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-3">{tIdCards('cardPreview')}</h4>
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
                <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-2">{tCommon('students')} ({slideOrder.students.length})</h4>
                <div className="ch-card p-3 max-h-[200px] overflow-y-auto space-y-1">
                  {slideOrder.students.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 py-1">
                      <span className="text-sm text-[var(--color-text-primary)]">{s.name}</span>
                      <span className="font-mono text-[10px] text-[var(--color-text-secondary)] ms-auto">{s.number}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Delivery info */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1">{tIdCards('deliveryAddress')}</h4>
                <p className="text-sm text-[var(--color-text-primary)]">{slideOrder.deliveryAddress}</p>
              </div>
              {slideOrder.notes && (
                <div>
                  <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1">{tIdCards('notes')}</h4>
                  <p className="text-sm text-[var(--color-text-primary)]">{slideOrder.notes}</p>
                </div>
              )}

              {/* Price breakdown */}
              <div className="ch-card p-4">
                <div className="flex justify-between text-sm text-[var(--color-text-primary)] mb-2">
                  <span>{slideOrder.students.length} {tIdCards('cards')} × 3 {tCommon('egp')}</span>
                  <span className="font-mono font-bold">{slideOrder.students.length * 3} {tCommon('egp')}</span>
                </div>
                <div className="flex justify-between text-sm text-[var(--color-text-primary)] mb-3">
                  <span>{tIdCards('delivery')}</span>
                  <span className="font-mono font-bold">{slideOrder.deliveryFee} {tCommon('egp')}</span>
                </div>
                <div className="border-t border-border pt-3 flex justify-between">
                  <span className="font-bold text-[var(--color-text-primary)]">{tIdCards('total')}</span>
                  <span className="font-mono font-black text-lg" style={{ color: slideOrder.cardColor }}>{slideOrder.total} {tCommon('egp')}</span>
                </div>
              </div>

              {/* Status update */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase mb-1.5">{tIdCards('updateStatus')}</h4>
                <select
                  value={slideOrder.status}
                  onChange={e => updateStatus(slideOrder.id, e.target.value as CardOrder['status'])}
                  className="w-full px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
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
