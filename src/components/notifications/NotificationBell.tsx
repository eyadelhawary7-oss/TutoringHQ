'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Bell } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

function formatRelative(iso: string, isAr: boolean): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return isAr ? 'الآن' : 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return isAr ? `منذ ${min} د` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return isAr ? `منذ ${hr} س` : `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return isAr ? `منذ ${d} يوم` : `${d}d ago`;
}

export function NotificationBell({ className }: { className?: string }) {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const isAr = locale === 'ar' || locale.startsWith('ar-');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/notifications?limit=10', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const j = (await res.json()) as { notifications?: NotificationRow[]; unreadCount?: number };
      setItems(j.notifications ?? []);
      setUnread(typeof j.unreadCount === 'number' ? j.unreadCount : 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const markRead = async (id: string) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch(`/api/notifications/${encodeURIComponent(id)}/mark-read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    void load();
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

  const openRow = (n: NotificationRow) => {
    const href = (n.href ?? '/notifications').trim() || '/notifications';
    void markRead(n.id);
    setOpen(false);
    router.push(href);
  };

  return (
    <div className={cn('relative', className)} ref={wrapRef}>
      <button
        type="button"
        className="relative flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] text-[var(--color-ink-body)] hover:bg-[var(--color-tile)]"
        aria-label={t('bellAria')}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          void load();
        }}
      >
        <Bell size={18} />
        {/* §02 signals unread with the accent dot, not a red badge. Red is
            `--color-danger` in §4 and it means money is wrong — an unread
            count is not an error. */}
        {unread > 0 ? (
          <span className="absolute top-1 end-1 min-w-[8px] h-2 w-2 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--color-panel)]" />
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute end-0 top-full z-[200] mt-2 w-[min(100vw-2rem,320px)] rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] shadow-xl"
          role="menu"
        >
          <div className="flex items-center justify-between border-b border-[var(--color-hairline)] px-3 py-2">
            <p className="text-xs font-semibold text-[var(--color-ink)]">{t('dropdownTitle')}</p>
            {loading ? <span className="text-xs text-[var(--color-faint)]">…</span> : null}
          </div>
          <ul className="max-h-[min(60vh,360px)] overflow-y-auto py-1">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs text-[var(--color-mid)]">{t('empty')}</li>
            ) : (
              items.map((n) => {
                const unreadRow = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="flex w-full min-h-[44px] items-start gap-2 px-3 py-2.5 text-start hover:bg-[var(--color-tile)]"
                      onClick={() => openRow(n)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[var(--color-ink)] line-clamp-2">{n.title}</span>
                        {n.body ? (
                          <span className="mt-0.5 block text-xs text-[var(--color-muted)] line-clamp-2">{n.body}</span>
                        ) : null}
                        <span className="mt-1 block text-xs text-[var(--color-faint)]">
                          {formatRelative(n.created_at, isAr)}
                        </span>
                      </span>
                      {/* Same unread signal as the full feed — a dot, not a
                          tinted row. Consistent between the two surfaces. */}
                      {unreadRow ? (
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]"
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="flex flex-col gap-1 border-t border-[var(--color-hairline)] p-2">
            <button
              type="button"
              className="min-h-[44px] w-full rounded-sm py-2 text-xs font-semibold text-[var(--color-accent-deep)] hover:bg-[var(--color-mint)]"
              onClick={() => void markAll()}
            >
              {t('markAllRead')}
            </button>
            <button
              type="button"
              className="min-h-[44px] w-full rounded-sm py-2 text-xs font-semibold text-[var(--color-mid)] hover:bg-[var(--color-tile)]"
              onClick={() => {
                setOpen(false);
                router.push('/notifications');
              }}
            >
              {t('viewAll')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
