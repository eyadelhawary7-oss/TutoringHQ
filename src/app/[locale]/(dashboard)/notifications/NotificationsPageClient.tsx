'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';

type Row = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

export default function NotificationsPageClient() {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=50', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const j = (await res.json()) as { notifications?: Row[] };
      setRows(j.notifications ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRow = async (n: Row) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      await fetch(`/api/notifications/${encodeURIComponent(n.id)}/mark-read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    }
    const href = (n.href ?? '/orders').trim() || '/orders';
    router.push(href);
  };

  const markAll = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch('/api/notifications/mark-all-read', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    void load();
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('pageTitle')}</h1>
        <button
          type="button"
          className="min-h-[44px] px-3 text-sm font-semibold text-teal-600"
          onClick={() => void markAll()}
        >
          {t('markAllRead')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`w-full rounded-xl border border-[var(--color-border-subtle)] p-4 text-start min-h-[44px] ${
                  !n.read_at ? 'bg-teal-500/5' : 'bg-[var(--color-surface-1)]'
                }`}
                onClick={() => void openRow(n)}
              >
                <p className="font-semibold text-[var(--color-text-primary)]">{n.title}</p>
                {n.body ? <p className="text-sm text-[var(--color-text-secondary)] mt-1">{n.body}</p> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
