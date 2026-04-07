'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { CardOrderModal } from '@/components/CardOrderModal';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Student {
  id: string;
  name: string;
  student_number?: string | null;
  qr_code?: string | null;
}

interface CenterInfoState {
  name?: string;
  logo_url?: string;
  phone?: string;
  governorate?: string;
  delivery_address?: Record<string, unknown>;
  card_color?: string;
}

interface CardOrderRow {
  id: string;
  center_id: string;
  students: unknown;
  quantity: number;
  price_per_card?: number | null;
  delivery_fee?: number | null;
  total_amount: number;
  status: string;
  delivery_address?: string | null;
  notes?: string | null;
  created_at: string;
}

function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseStudentLines(studentsJson: unknown): string[] {
  if (!Array.isArray(studentsJson) || studentsJson.length === 0) return [];
  const first = studentsJson[0];
  if (typeof first === 'string') {
    return (studentsJson as string[]).map((id) => `Student ${id}`);
  }
  if (typeof first === 'object' && first !== null && 'name' in first) {
    return (studentsJson as { name?: string }[]).map((s) => (s.name?.trim() ? s.name : '-'));
  }
  return [];
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200';
    case 'confirmed':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200';
    case 'printing':
    case 'processing':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200';
    case 'shipped':
      return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200';
    case 'delivered':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200';
    case 'cancelled':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }
}

type CardOrderStatusKey =
  | 'statusPending'
  | 'statusConfirmed'
  | 'statusProcessing'
  | 'statusShipped'
  | 'statusDelivered'
  | 'statusCancelled';

function statusLabelKey(status: string): CardOrderStatusKey {
  if (status === 'confirmed') return 'statusConfirmed';
  if (status === 'printing' || status === 'processing') return 'statusProcessing';
  if (status === 'shipped') return 'statusShipped';
  if (status === 'delivered') return 'statusDelivered';
  if (status === 'cancelled') return 'statusCancelled';
  return 'statusPending';
}

export default function OrdersPage() {
  const t = useTranslations('cardOrders');
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerInfo, setCenterInfo] = useState<CenterInfoState | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [orders, setOrders] = useState<CardOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        return;
      }

      const meRes = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!meRes.ok) {
        setLoadError(t('loadFailed'));
        return;
      }
      const meData = await meRes.json();
      if (!meData?.user?.center_id) {
        return;
      }

      const cid = meData.user.center_id as string;
      setCenterId(cid);
      setCenterInfo(
        meData.user.center
          ? {
              name: meData.user.center.name,
              logo_url: meData.user.center.logo_url,
              phone: meData.user.center.phone,
              governorate: meData.user.center.governorate,
              delivery_address: meData.user.center.delivery_address,
              card_color: meData.user.center.card_color,
            }
          : null
      );

      const [studentsRes, ordersRes] = await Promise.all([
        dbSelect({
          table: 'students',
          select: 'id, name, student_number, qr_code',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
          order: { column: 'name', ascending: true },
        }),
        dbSelect({
          table: 'card_orders',
          select: '*',
          filters: [{ column: 'center_id', op: 'eq', value: cid }],
          order: { column: 'created_at', ascending: false },
        }),
      ]);

      if (studentsRes.data && Array.isArray(studentsRes.data)) {
        setStudents(studentsRes.data as Student[]);
      }
      if (ordersRes.data && Array.isArray(ordersRes.data)) {
        setOrders(ordersRes.data as CardOrderRow[]);
      }
    } catch {
      setLoadError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!loading) return;
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setLoadError((prev) => prev ?? t('loadTimeout'));
    }, 10000);
    return () => window.clearTimeout(timeout);
  }, [loading, t]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="min-h-screen w-full bg-[#080D14] animate-fade-in pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
      <div className="px-4 pt-4 pb-6 max-w-3xl mx-auto w-full">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-white">{t('ordersTitle')}</h1>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">{t('ordersSubtitle')}</p>
          </div>
          {centerId && (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors shrink-0"
            >
              {t('newOrder')}
            </button>
          )}
        </div>

        {loadError && !loading ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => void loadData()}
              className="mt-2 text-xs font-semibold text-teal-400 underline"
            >
              {t('tryAgain')}
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] animate-pulse"
              />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="card p-8 text-center border border-[var(--color-border-subtle)]">
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('ordersEmpty')}</p>
            {centerId && (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {t('newOrder')}
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {orders.map((order) => {
              const shortId = order.id.replace(/-/g, '').slice(-8).toUpperCase();
              const expanded = expandedId === order.id;
              const lines = parseStudentLines(order.students);
              const pricePer = order.price_per_card ?? 55;
              const deliveryFee = Number(order.delivery_fee ?? 0);

              return (
                <li
                  key={order.id}
                  className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpand(order.id)}
                    className="w-full flex items-center gap-3 p-4 text-start hover:bg-[var(--color-surface-0)]/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-semibold text-[var(--color-text-primary)]">
                          #{shortId}
                        </span>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(order.status)}`}
                        >
                          {t(statusLabelKey(order.status))}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {t('orderDate')}: {formatOrderDate(order.created_at)}
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)] mt-1">
                        {order.quantity} {t('cards')} · {t('orderTotal')}:{' '}
                        {Number(order.total_amount).toLocaleString('en-US')} EGP
                      </p>
                    </div>
                    {expanded ? (
                      <ChevronUp className="w-5 h-5 text-[var(--color-text-tertiary)] shrink-0" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-[var(--color-text-tertiary)] shrink-0" />
                    )}
                  </button>
                  {expanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-[var(--color-border-subtle)] space-y-3 text-sm">
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                          {t('orderDetails')}
                        </p>
                        <ul className="list-disc list-inside text-[var(--color-text-primary)] space-y-0.5">
                          {lines.length > 0 ? (
                            lines.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))
                          ) : (
                            <li>-</li>
                          )}
                        </ul>
                      </div>
                      {order.delivery_address ? (
                        <div>
                          <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                            {t('deliveryAddress')}
                          </p>
                          <p className="text-[var(--color-text-primary)]">{order.delivery_address}</p>
                        </div>
                      ) : null}
                      <p className="text-[var(--color-text-secondary)]">
                        {t('pricePerCard')}: {pricePer} EGP
                      </p>
                      <p className="text-[var(--color-text-secondary)]">
                        {t('deliveryFee')}: {deliveryFee.toLocaleString('en-US')} EGP
                      </p>
                      {order.notes?.trim() ? (
                        <div>
                          <p className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">
                            {t('notesLabel')}
                          </p>
                          <p className="text-[var(--color-text-primary)]">{order.notes}</p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {centerId && (
        <CardOrderModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          students={students}
          centerId={centerId}
          centerInfo={centerInfo}
          onSuccess={() => void loadData()}
        />
      )}
    </div>
  );
}
