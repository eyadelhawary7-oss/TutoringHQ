'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { readRecentlyViewedStudents, type RecentStudentView } from '@/lib/recentlyViewedStudents';
import { formatCurrency } from '@/lib/formatNumber';
import { naturalCompare } from '@/lib/sort/naturalSort';

type RecPayload = {
  studentsWithoutCards: { id: string; name: string; student_number?: string | null }[];
  recentlyAddedStudents: { id: string; name: string; student_number?: string | null }[];
  lastDeliveredOrders: {
    id: string;
    quantity: number;
    total_amount: number;
    created_at: string;
    status: string;
  }[];
};

export function CartRecommendations({
  centerId,
  show,
}: {
  centerId: string | null;
  show: boolean;
}) {
  const t = useTranslations('recommendations');
  const locale = useLocale();
  const router = useRouter();
  const { addItemsBatch, createCart, cart, isStudentInCart } = useCardOrderCart();
  const [data, setData] = useState<RecPayload | null>(null);
  const [recentViews, setRecentViews] = useState<RecentStudentView[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!centerId || !show) return;
    setRecentViews(readRecentlyViewedStudents(centerId));
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const res = await fetch('/api/orders/recommendations', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return;
    setData((await res.json()) as RecPayload);
  }, [centerId, show]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const addAllWithoutCards = async () => {
    const list = data?.studentsWithoutCards ?? [];
    const ids = list.map((s) => s.id).filter((id) => !isStudentInCart(id));
    if (ids.length === 0) return;
    setBusy(true);
    try {
      if (!cart) await createCart();
      await addItemsBatch(ids.map((student_id) => ({ kind: 'student' as const, student_id })));
      router.push('/orders');
    } finally {
      setBusy(false);
    }
  };

  const addPickedWithoutCards = async () => {
    const ids = [...picked].filter((id) => !isStudentInCart(id));
    if (ids.length === 0) return;
    setBusy(true);
    try {
      if (!cart) await createCart();
      await addItemsBatch(ids.map((student_id) => ({ kind: 'student' as const, student_id })));
      setPicked(new Set());
      router.push('/orders');
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (orderId: string) => {
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/reorder`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) router.push('/orders');
    } finally {
      setBusy(false);
    }
  };

  if (!show || !centerId) return null;

  const without = [...(data?.studentsWithoutCards ?? [])].sort((a, b) =>
    naturalCompare(a.name || '', b.name || ''),
  );

  return (
    <div className="mt-6 space-y-6 text-start">
      {without.length > 0 ? (
        <section
          className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4"
          aria-labelledby="rec-no-cards-heading"
          data-testid="cart-rec-without-cards"
        >
          <h2 id="rec-no-cards-heading" className="text-sm font-bold text-[var(--color-text-primary)] mb-2">
            {t('withoutCardsTitle')}
          </h2>
          <ul className="space-y-2 max-h-56 overflow-y-auto mb-3">
            {without.map((s) => (
              <li key={s.id} className="flex items-center gap-2 min-h-[44px]">
                <input
                  type="checkbox"
                  checked={picked.has(s.id)}
                  onChange={() => togglePick(s.id)}
                  className="h-5 w-5 rounded border-[var(--color-border-subtle)]"
                  aria-label={s.name}
                />
                <span className="text-sm text-[var(--color-text-primary)] flex-1">{s.name}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            className="w-full min-h-[44px] rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50"
            onClick={() => void addAllWithoutCards()}
          >
            {t('addAll')}
          </button>
          {picked.size > 0 ? (
            <button
              type="button"
              disabled={busy}
              className="mt-2 w-full min-h-[44px] rounded-xl border border-[var(--color-border-subtle)] text-sm font-semibold"
              onClick={() => void addPickedWithoutCards()}
            >
              {t('addSelected', { count: picked.size })}
            </button>
          ) : null}
        </section>
      ) : null}

      {(data?.recentlyAddedStudents ?? []).length > 0 ? (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-1">{t('recentlyAddedTitle')}</h2>
          <p className="text-xs text-[var(--color-text-secondary)] mb-2">{t('recentlyAddedHint')}</p>
          <ul className="text-sm space-y-1">
            {data!.recentlyAddedStudents.slice(0, 8).map((s) => (
              <li key={s.id} className="text-[var(--color-text-primary)]">
                {s.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recentViews.length > 0 ? (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-2">{t('recentlyViewedTitle')}</h2>
          <ul className="space-y-2">
            {recentViews.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm flex-1 min-w-0 truncate">{s.name}</span>
                <button
                  type="button"
                  disabled={busy || isStudentInCart(s.id)}
                  className="min-h-[44px] px-3 rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 text-xs font-semibold disabled:opacity-40"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      if (!cart) await createCart();
                      await addItemsBatch([{ kind: 'student', student_id: s.id }]);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {isStudentInCart(s.id) ? t('inCart') : t('addToCart')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {(data?.lastDeliveredOrders ?? []).length > 0 ? (
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4">
          <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-3">{t('reorderSectionTitle')}</h2>
          <ul className="space-y-3">
            {data!.lastDeliveredOrders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <p className="text-xs font-mono text-[var(--color-text-secondary)]">
                    #{o.id.replace(/-/g, '').slice(-8).toUpperCase()}
                  </p>
                  <p className="text-sm text-[var(--color-text-primary)]">
                    {o.quantity} · {formatCurrency(o.total_amount, locale)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className="min-h-[44px] px-4 rounded-lg bg-[var(--color-surface-2)] text-sm font-semibold border border-[var(--color-border-subtle)]"
                  onClick={() => void reorder(o.id)}
                >
                  {t('reorder')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
