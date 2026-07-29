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

/**
 * Icon tints, Merged-Center-Home §02 (`.i-ok` / `.i-warn` / `.i-accent` /
 * `.i-info` / `.i-danger`).
 *
 * The design collapses to three tints — mint on accent, sand on brass, and a
 * neutral — where this file had five unrelated Tailwind palettes. `order`
 * lands on the same mint/accent as `money` because the design's `.i-info`
 * and `.i-ok` are byte-identical; that is deliberate there, not an oversight
 * here.
 *
 * KIND_RULES below is untouched: which kind gets which tone is classification,
 * not styling. One consequence worth naming — the design tints "Identity
 * verified" as positive (`.i-ok`), while this file files anything matching
 * `verif`/`identity` under `system` and renders it neutral. Reconciling that
 * means editing the rules, so it stays for the feature pass.
 */
const TONE_CLASS: Record<Tone, string> = {
  money: 'bg-[var(--color-mint)] text-[var(--color-accent)]',
  warn: 'bg-[var(--color-sand)] text-[var(--color-brass)]',
  people: 'bg-[var(--color-mint)] text-[var(--color-accent-deep)]',
  order: 'bg-[var(--color-mint)] text-[var(--color-accent)]',
  system: 'bg-[var(--color-hairline)] text-[var(--color-mid)]',
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
    <div className="max-w-xl mx-auto px-4 py-8 space-y-2">
      {/* §02 topbar: 17px title over a 12px count, Mark-all-read as a mint
          pill rather than a bare teal link. */}
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[var(--color-ink)]">{t('pageTitle')}</h1>
          {unreadCount > 0 && (
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {t('unreadCount', { count: formatNumber(unreadCount, locale) })}
            </p>
          )}
        </div>
        <button
          type="button"
          className="min-h-[44px] shrink-0 rounded-pill border border-[var(--color-accent)]/20 bg-[var(--color-mint)] px-3 text-sm font-semibold text-[var(--color-accent-deep)] disabled:opacity-50 btn-press chq-focus"
          onClick={() => void markAll()}
          disabled={unreadCount === 0}
        >
          {t('markAllRead')}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-mid)]">…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--color-mid)]">{t('empty')}</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="space-y-2 pt-2">
            {/* Design's `.sec` is 13px sentence case, not an uppercase
                eyebrow — Arabic has no case, so the tracking-wide uppercase
                treatment only ever read as intended in English. */}
            <h2 className="text-base font-semibold text-[var(--color-muted)]">
              {g.label}
            </h2>
            <ul className="space-y-2">
              {g.rows.map((n) => {
                const { Icon, tone } = decorate(n.kind);
                return (
                  <li key={n.id}>
                    {/* §02 `.nrow`: unread is carried by an accent hairline and
                        a dot, not by a tinted fill. Both rows keep the same
                        panel background, so a screen of unread rows still reads
                        as a list rather than as one large coloured block. */}
                    <button
                      type="button"
                      className={`flex w-full min-h-[44px] items-start gap-2 rounded-md border bg-[var(--color-panel)] px-4 py-3 text-start ${
                        !n.read_at
                          ? 'border-[var(--color-accent)]/25'
                          : 'border-[var(--color-paper)]'
                      }`}
                      onClick={() => void openRow(n)}
                    >
                      <span
                        className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-md ${TONE_CLASS[tone]}`}
                        aria-hidden
                      >
                        <Icon size={19} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="text-base font-semibold leading-tight text-[var(--color-ink)]">
                            {n.title}
                          </span>
                          {/* Design puts the age on every row — "10m", "2h",
                              "Yesterday". How fresh a notification is decides
                              whether it still needs acting on. */}
                          <span className="shrink-0 text-xs text-[var(--color-faint)]">
                            {formatRelativeMinutesAgo(n.created_at, locale)}
                          </span>
                        </span>
                        {n.body ? (
                          <span className="mt-1 block text-sm text-[var(--color-muted)]">
                            {n.body}
                          </span>
                        ) : null}
                      </span>
                      {!n.read_at && (
                        <span
                          className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]"
                          aria-hidden
                        />
                      )}
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
