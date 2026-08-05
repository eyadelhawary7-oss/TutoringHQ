'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Banknote,
  CreditCard,
  Package,
  ShieldCheck,
  UserPlus,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { ListSkeleton } from '@/components/patterns';
import { EmptyState } from '@/components/shared';
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

type Tone = 'money' | 'warn' | 'danger' | 'people' | 'order' | 'system';

/**
 * Icon tints, Merged-Center-Home §02.
 *
 * §02 declares six tint classes but they resolve to only FOUR distinct pairs —
 * `.i-ok` and `.i-info` are byte-identical (#DFEEEB / #0E6B61), and so are
 * `.i-warn` and `.i-brass` (#F4EBD7 / #9A6B1F). The four real tints are:
 *
 *   mint    / accent       #DFEEEB / #0E6B61   .i-ok, .i-info   → money, order
 *   sand    / brass        #F4EBD7 / #9A6B1F   .i-warn,.i-brass → warn
 *   hairline/ danger       #F0ECE2 / #9C3322   .i-danger        → danger
 *   mint    / accent-deep  #DFEEEB / #0A514A   .i-accent        → people
 *
 * `danger` was MISSING here entirely until this pass: the design draws "Fee
 * overdue" in clay (`.i-danger`) and everything else attention-shaped in brass,
 * and this file collapsed both onto brass, so the one row the design singles
 * out as destructive rendered identically to a soft warning. All four token
 * values above are exact matches in `tokens.css` §4 — nothing new was minted.
 *
 * `system` is the fallback for a kind nobody has written yet. The design has no
 * neutral tint because the design draws no unknown kind; inventing a tinted
 * meaning for an unclassified row would assert something the row does not say,
 * so the neutral stays and is documented rather than force-fitted.
 */
/**
 * Does this body line carry a money figure, and therefore §02's `.num` tabular
 * treatment?
 *
 * Matches the two suffixes `formatCurrency` actually emits (`formatNumber.ts`
 * §`EGP_EN_SUFFIX` / `EGP_AR_SUFFIX`) rather than "has a digit in it". The
 * design is explicit that those are different tests: it draws "Physics G10"
 * and "#THQ-2607" — both digit-bearing — as plain `ns`.
 */
const CURRENCY_IN_BODY = /(?:EGP|ج\.م)/;

const TONE_CLASS: Record<Tone, string> = {
  money: 'bg-[var(--color-mint)] text-[var(--color-accent)]',
  warn: 'bg-[var(--color-sand)] text-[var(--color-brass)]',
  danger: 'bg-[var(--color-hairline)] text-[var(--color-danger)]',
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
  // Money already missed, in clay — §02's "Fee overdue" row is the only one it
  // draws as `.i-danger`. Split out from the brass rule below so the design's
  // one destructive row stops rendering as a soft warning.
  { match: ['overdue', 'past_due'], icon: AlertTriangle, tone: 'danger' },
  // Money at risk but not yet missed — §02 draws "Payment failed" and the
  // "8 unpaid links" row in brass (`.i-warn`), not clay.
  { match: ['unpaid', 'failed', 'declined'], icon: AlertTriangle, tone: 'warn' },
  { match: ['absent', 'absence'], icon: UserX, tone: 'warn' },
  { match: ['payout'], icon: Banknote, tone: 'money' },
  { match: ['payment', 'paid', 'fee', 'invoice', 'collect'], icon: CreditCard, tone: 'money' },
  { match: ['order', 'card_order', 'shipment', 'shipped'], icon: Package, tone: 'order' },
  // §02's "New student" row — person-plus glyph on `.i-accent` (mint on the
  // deep accent), the one place the design uses that tint.
  { match: ['student', 'enrol', 'enroll', 'join', 'signup', 'sign_up'], icon: UserPlus, tone: 'people' },
  // §02 tints "Identity verified" `.i-ok` — it is good news, not chrome. This
  // rendered neutral until this pass; the file's own note deferred it to "the
  // feature pass", and this is it. `privacy` splits off below: `privacy_request`
  // is written only against an `admin_users.id`, so it never reaches a centre's
  // own feed at all, and it is genuinely system chrome rather than good news.
  { match: ['verif', 'identity'], icon: ShieldCheck, tone: 'money' },
  { match: ['privacy'], icon: ShieldCheck, tone: 'system' },
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
  // From the API's dedicated count('exact') query, not derived from `rows` -
  // the list fetch is capped at 50, so a center with more than 50 unread
  // notifications would otherwise undercount here.
  const [unreadCount, setUnreadCount] = useState(0);

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
      const j = (await res.json()) as { notifications?: Row[]; unreadCount?: number };
      setRows(j.notifications ?? []);
      setUnreadCount(j.unreadCount ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open a row: always mark it read, navigate only when the row HAS somewhere
   * to go.
   *
   * `href` used to default to `/orders`. That was safe only while the single
   * live writer was the card-order one; `in_app_notifications.kind` is
   * unconstrained free text (no enum, no CHECK — verified live), so the moment
   * any other writer lands (D26), every href-less row of every kind would have
   * sent the owner to the card-orders page. Tapping "Fee overdue" and arriving
   * at a shipping list is a wrong answer, not a neutral default.
   *
   * Marking read still happens either way — that is what the tap means — and
   * the list is reloaded so the row and the unread count settle together.
   */
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
    const href = (n.href ?? '').trim();
    if (href) {
      router.push(href);
      return;
    }
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
        /* §02 · an ellipsis is not a loading state. This is a list, so it takes
           the list skeleton at the rows' own height. */
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        /* §01 quiet variant · notifications arrive on their own; there is no
           button that fills this screen, so no action and the muted tile. */
        <EmptyState icon={BellOff} title={t('empty')} quiet />
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
                        {/* §02 marks the body line `.num` selectively, and the
                            selector is MONEY, not digits. Read off the design:
                            "paid 350 EGP", "1,350 EGP outstanding" and
                            "13,509 EGP to CIB" get `ns num`; "Sara Ahmed was
                            marked absent in Physics G10" and "Card order
                            #THQ-2607 is on the way" carry digits and are drawn
                            as plain `ns` (the order code takes `.mono`
                            instead). An earlier version of this line applied
                            `num` to every body and defended it as "a no-op on
                            rows with no digits" — that defence is wrong, and it
                            was wrong on the only rows that render today: the
                            single live writer is the card-order one, i.e.
                            precisely the row the design leaves plain.
                            `kind` cannot decide this (the amount lives inside
                            free text and the column is unconstrained), so the
                            test is the rendered currency suffix. */}
                        {n.body ? (
                          <span
                            className={`mt-1 block text-sm text-[var(--color-muted)]${
                              CURRENCY_IN_BODY.test(n.body) ? ' num' : ''
                            }`}
                          >
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
