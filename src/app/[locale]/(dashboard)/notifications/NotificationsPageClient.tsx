'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import {
  AlertTriangle,
  Bell,
  Banknote,
  CreditCard,
  Package,
  ShieldCheck,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cairoDateKey } from '@/lib/cairo/day';
import { formatNumber, formatRelativeMinutesAgo } from '@/lib/formatNumber';

type Row = {
  id: string;
  kind: string | null;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

type Tone = 'money' | 'warn' | 'people' | 'order' | 'system';

const TONE_CLASS: Record<Tone, string> = {
  money: 'bg-emerald-500/12 text-emerald-700',
  warn: 'bg-amber-500/15 text-amber-700',
  people: 'bg-teal-500/12 text-teal-700',
  order: 'bg-sky-500/12 text-sky-700',
  system: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
};

/**
 * Icon + tone for a notification row.
 *
 * `in_app_notifications.kind` is plain `text` — verified against the live
 * catalog: no Postgres enum, no CHECK constraint, and the table is empty. So
 * there is no vocabulary to conform to and nothing in the database will ever
 * reject a new kind. Two kinds are written today (`card_order_status_update`,
 * `privacy_request`) against the seven the design names.
 *
 * That makes exact-matching a fixed list the wrong shape: it would silently
 * render every future kind as a blank row. This matches on SUBSTRINGS in the
 * order below and falls back to a neutral bell, so a kind nobody has invented
 * yet still arrives with a sensible icon rather than none.
 */
const KIND_RULES: { match: string[]; icon: LucideIcon; tone: Tone }[] = [
  { match: ['overdue', 'unpaid', 'failed', 'declined', 'past_due'], icon: AlertTriangle, tone: 'warn' },
  { match: ['absent', 'absence'], icon: UserX, tone: 'warn' },
  { match: ['payout'], icon: Banknote, tone: 'money' },
  { match: ['payment', 'paid', 'fee', 'invoice', 'collect'], icon: CreditCard, tone: 'money' },
  { match: ['order', 'card_order', 'shipment', 'shipped'], icon: Package, tone: 'order' },
  { match: ['student', 'enrol', 'enroll', 'join', 'signup', 'sign_up'], icon: UserPlus, tone: 'people' },
  { match: ['verif', 'identity', 'privacy'], icon: ShieldCheck, tone: 'system' },
];

function decorate(kind: string | null): { Icon: LucideIcon; tone: Tone } {
  const k = (kind ?? '').toLowerCase();
  for (const rule of KIND_RULES) {
    if (rule.match.some((m) => k.includes(m))) return { Icon: rule.icon, tone: rule.tone };
  }
  return { Icon: Bell, tone: 'system' };
}

export default function NotificationsPageClient() {
  const t = useTranslations('notifications');
  const locale = useLocale();
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

  const unreadCount = useMemo(() => rows.filter((n) => !n.read_at).length, [rows]);

  /**
   * Today / Earlier, per the design's grouping.
   *
   * Split on the CAIRO calendar day, not the browser's. A center owner opening
   * this at 00:30 Cairo from a device set to UTC would otherwise still see the
   * previous day's rows under "Today".
   */
  const groups = useMemo(() => {
    const todayKey = cairoDateKey();
    const today: Row[] = [];
    const earlier: Row[] = [];
    for (const n of rows) {
      const d = new Date(n.created_at);
      const key = Number.isNaN(d.getTime()) ? '' : cairoDateKey(d);
      (key === todayKey ? today : earlier).push(n);
    }
    return [
      { key: 'today', label: t('groupToday'), rows: today },
      { key: 'earlier', label: t('groupEarlier'), rows: earlier },
    ].filter((g) => g.rows.length > 0);
  }, [rows, t]);

  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('pageTitle')}</h1>
          {unreadCount > 0 && (
            <span className="shrink-0 text-sm font-medium text-teal-600">
              {t('unreadCount', { count: formatNumber(unreadCount, locale) })}
            </span>
          )}
        </div>
        <button
          type="button"
          className="min-h-[44px] px-3 text-sm font-semibold text-teal-600 disabled:opacity-50"
          onClick={() => void markAll()}
          disabled={unreadCount === 0}
        >
          {t('markAllRead')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-secondary)]">{t('empty')}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {g.label}
            </h2>
            <ul className="space-y-2">
              {g.rows.map((n) => {
                const { Icon, tone } = decorate(n.kind);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`flex w-full items-start gap-3 rounded-xl border border-[var(--color-border-subtle)] p-4 text-start min-h-[44px] ${
                        !n.read_at ? 'bg-teal-500/5' : 'bg-[var(--color-surface-1)]'
                      }`}
                      onClick={() => void openRow(n)}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE_CLASS[tone]}`}
                        aria-hidden
                      >
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-[var(--color-text-primary)]">
                            {n.title}
                          </span>
                          {/* Design puts the age on every row — "10m", "2h",
                              "Yesterday". How fresh a notification is decides
                              whether it still needs acting on. */}
                          <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                            {formatRelativeMinutesAgo(n.created_at, locale)}
                          </span>
                        </span>
                        {n.body ? (
                          <span className="mt-1 block text-sm text-[var(--color-text-secondary)]">
                            {n.body}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
