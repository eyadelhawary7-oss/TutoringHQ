'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { naturalCompare } from '@/lib/sort/naturalSort';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { cn } from '@/lib/utils';

export type StudentPickerRow = {
  id: string;
  name: string;
  student_number?: string | null;
};

type FilterKey = 'all' | 'without_card' | 'in_cart' | 'saved' | 'has_card';

export function StudentPickerDrawer({
  open,
  onClose,
  students,
}: {
  open: boolean;
  onClose: () => void;
  students: StudentPickerRow[];
}) {
  const t = useTranslations('cart.picker');
  const tc = useTranslations('cart.studentRow');
  const { items, addItemsBatch } = useCardOrderCart();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statusMap, setStatusMap] = useState<Record<string, 'none' | 'pending' | 'delivered'>>({});
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const savedIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      if (i.kind === 'student' && i.student_id && i.saved_for_later) s.add(i.student_id);
    }
    return s;
  }, [items]);

  const inCartActiveIds = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      if (i.kind === 'student' && i.student_id && !i.saved_for_later) s.add(i.student_id);
    }
    return s;
  }, [items]);

  const alreadyInCartCount = inCartActiveIds.size;

  useEffect(() => {
    if (!open || students.length === 0) return;
    let cancelled = false;
    void (async () => {
      setLoadingStatus(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const ids = students.map((s) => s.id);
        const res = await fetch('/api/card-order-cart/student-card-status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { statusByStudentId?: Record<string, 'none' | 'pending' | 'delivered'> };
        if (!cancelled) setStatusMap(j.statusByStudentId ?? {});
      } finally {
        if (!cancelled) setLoadingStatus(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, students]);

  useEffect(() => {
    if (!open) return;
    const tid = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(tid);
  }, [search, open]);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch('');
      setDebouncedSearch('');
      setFilter('all');
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    let list = students.slice();

    list.sort((a, b) => {
      const c = naturalCompare(a.name || '', b.name || '');
      if (c !== 0) return c;
      return naturalCompare(String(a.student_number ?? ''), String(b.student_number ?? ''));
    });

    if (q) {
      list = list.filter((s) => {
        const num = formatStudentNumberForDisplay(String(s.student_number ?? '')).toLowerCase();
        return (s.name || '').toLowerCase().includes(q) || num.includes(q.replace(/\s/g, ''));
      });
    }

    list = list.filter((s) => {
      const st = statusMap[s.id] ?? 'none';
      const inCart = inCartActiveIds.has(s.id);
      const saved = savedIds.has(s.id);

      if (filter === 'in_cart') return inCart;
      if (filter === 'saved') return saved;
      if (filter === 'without_card') return st === 'none';
      if (filter === 'has_card') return st === 'delivered' || st === 'pending';
      return true;
    });

    return list;
  }, [students, debouncedSearch, filter, statusMap, inCartActiveIds, savedIds]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    const eligible = filtered.filter((s) => {
      const st = statusMap[s.id] ?? 'none';
      if (st === 'delivered') return false;
      if (inCartActiveIds.has(s.id)) return false;
      return true;
    });
    setSelected(new Set(eligible.map((s) => s.id)));
  }, [filtered, statusMap, inCartActiveIds]);

  const addSelected = useCallback(async () => {
    const ids = [...selected].filter((id) => {
      const st = statusMap[id] ?? 'none';
      return st !== 'delivered' && !inCartActiveIds.has(id);
    });
    if (ids.length === 0) return;
    setSubmitting(true);
    try {
      await addItemsBatch(ids.map((student_id) => ({ kind: 'student' as const, student_id })));
      onClose();
    } finally {
      setSubmitting(false);
    }
  }, [selected, statusMap, inCartActiveIds, addItemsBatch, onClose]);

  if (!open) return null;

  const pill = (key: FilterKey, label: string) => (
    <button
      type="button"
      key={key}
      onClick={() => setFilter(key)}
      className={cn(
        'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors',
        filter === key
          ? 'bg-teal-600 text-white border-teal-600'
          : 'border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-black/40" role="presentation" onClick={onClose}>
      <div
        data-testid="student-picker-drawer"
        className="w-full max-w-md h-full bg-[var(--color-surface-1)] shadow-xl flex flex-col border-s border-[var(--color-border-subtle)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-labelledby="student-picker-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] shrink-0">
          <h2 id="student-picker-title" className="text-lg font-bold text-[var(--color-text-primary)]">
            {t('title')}
          </h2>
          <button type="button" className="p-2 rounded-lg hover:bg-[var(--color-surface-2)]" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 border-b border-[var(--color-border-subtle)] shrink-0">
          <p className="text-xs text-[var(--color-text-secondary)]">
            {t('studentsAlreadyInCart', { count: alreadyInCartCount })}
          </p>
          <input
            type="search"
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-input bg-[var(--color-surface-0)] px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-1.5">
            {pill('all', t('filterAll'))}
            {pill('without_card', t('filterWithoutCard'))}
            {pill('in_cart', t('filterInCart'))}
            {pill('saved', t('filterSaved'))}
            {pill('has_card', t('filterHasCard'))}
          </div>
          <button type="button" className="text-[11px] font-semibold text-teal-600 underline" onClick={selectAllFiltered}>
            {t('selectAllFiltered')}
          </button>
          {loadingStatus ? <p className="text-[10px] text-[var(--color-text-tertiary)]">…</p> : null}
        </div>

        <ul className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {filtered.map((s) => {
            const st = statusMap[s.id] ?? 'none';
            const inCart = inCartActiveIds.has(s.id);
            const saved = savedIds.has(s.id);
            const disabledSelect = st === 'delivered' || inCart;

            return (
              <li key={s.id} className="flex items-start gap-2 rounded-lg px-2 py-2 hover:bg-[var(--color-surface-2)]">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.has(s.id)}
                  disabled={disabledSelect}
                  onChange={() => toggle(s.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{s.name}</p>
                  <p className="text-xs font-mono text-[var(--color-text-tertiary)]" dir="ltr">
                    <bdi>#{formatStudentNumberForDisplay(String(s.student_number ?? ''))}</bdi>
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {inCart ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-700">
                        {t('badgeInCart')}
                      </span>
                    ) : null}
                    {saved ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-700">
                        {t('badgeSaved')}
                      </span>
                    ) : null}
                    {st === 'delivered' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/15 text-green-800">
                        {tc('alreadyHasCard')}
                      </span>
                    ) : null}
                    {st === 'pending' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-800">
                        {tc('cardPending')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-[var(--color-border-subtle)] p-4 shrink-0 bg-[var(--color-surface-1)] pb-[calc(16px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            data-testid="student-picker-add-selected"
            disabled={submitting || selected.size === 0}
            className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold"
            onClick={() => void addSelected()}
          >
            {t('addSelected', { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
