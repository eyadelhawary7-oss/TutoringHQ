'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, CalendarX2, CalendarClock, Clock, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatNumber';
import { getTeacherPlan } from '@/lib/teacherPlans';
import type { TeacherWaDelivery, TeacherWaTrigger } from '@/lib/teacherWhatsappTemplates';
import {
  fetchTeacherSubscription,
  type TeacherSubscriptionStatus,
} from '@/components/teacher/teacherSubscriptionClient';
import PrivateUpsellCard from '../../PrivateUpsellCard';
import { useTeacherContext } from '../../useTeacherContext';
import { useStartTrial } from '../../useStartTrial';

/**
 * /teacher/whatsapp — Merged-Teacher-WhatsApp §01.
 *
 * WHAT IS DRAWN, AND WHY THE DESIGN'S OTHER TWO STATES ARE NOT.
 *
 * §01 draws three states: balance, templates, pack. Two are built here from
 * live columns; the third and two sub-blocks of the first are held, each for a
 * verified data reason rather than for effort:
 *
 *   · "Where yours went" (per-template usage this month) and "Sent by us, at
 *     our cost" are NOT drawn. They need a WhatsApp send attributable to a
 *     teacher, and no send log has a teacher column: wa_message_queue is
 *     (id, center_id, to_phone, template_name, variables, body, status,
 *     waba_message_id, error_message, created_at, updated_at) with
 *     `center_id uuid NOT NULL` and no teacher_id — same for whatsapp_usage,
 *     wa_messages and whatsapp_messages, all center_id-keyed. Confirmed against
 *     information_schema: the missing column is `wa_message_queue.teacher_id`.
 *     A new column is a migration, which stops and goes to Eyad. Inventing a
 *     count from anything else would be a fabricated number on a money screen.
 *
 *   · The pack purchase state (fixed 200 / 1,000 / 5,000-message tiers, "Buy a
 *     pack") is NOT drawn. It rests on D5, still open: live billing is a
 *     per-parent MONTHLY pack, the design is a one-time never-expiring top-up,
 *     and those are different pricing models, not a restyle. Drawing tiers
 *     nobody has agreed to charge would put fabricated prices on screen; a
 *     "Buy a pack" button with nothing behind it would be a dead button. So the
 *     footer CTA is absent too, deliberately.
 *
 * The balance itself IS real (teacher_profiles.blast_credits_subscription /
 * blast_credits_purchased, both live numeric columns) and is stated with the
 * one fact that makes it honest: nothing deducts from it yet. The spend RPC
 * `deduct_blast_credits` exists in the database and has zero callers in the
 * application, so the number only ever goes up. Showing a balance beside a
 * template list without saying that would imply messages draw it down.
 */

type TemplateRow = {
  key: string;
  template_name: string;
  trigger: TeacherWaTrigger;
  status: string | null;
  delivery: TeacherWaDelivery;
};

type TemplatesResponse = {
  wa_sending_enabled: boolean;
  templates: TemplateRow[];
};

/** Icon per template — the design gives each row a soft-tile glyph. */
const TEMPLATE_ICON: Record<string, LucideIcon> = {
  feeReminder: Wallet,
  classReminder: Clock,
  scheduleChanged: CalendarDays,
  classCancelled: CalendarX2,
  classRescheduled: CalendarClock,
};

/** Only a live-delivering template gets the teal treatment. */
const DELIVERY_TONE: Record<TeacherWaDelivery, 'live' | 'held'> = {
  sending: 'live',
  sendingPaused: 'held',
  awaitingApproval: 'held',
  rejected: 'held',
  notSubmitted: 'held',
};

export default function TeacherWhatsAppPage() {
  const t = useTranslations('teacherPortal.pages');
  const tw = useTranslations('teacherPortal.whatsapp');
  const locale = useLocale();
  const { ctx, loading: ctxLoading, reload } = useTeacherContext();

  const state = ctx?.state ?? 'center_only';
  const { startTrial, modal } = useStartTrial(state, reload);
  const hasPrivateAccess = ctx?.hasPrivateAccess ?? false;

  const [sub, setSub] = useState<TeacherSubscriptionStatus | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setLoadError(true);
        return;
      }
      const [subData, tplRes] = await Promise.all([
        fetchTeacherSubscription(),
        fetch('/api/teacher/whatsapp/templates', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
      ]);
      if (!tplRes.ok) {
        setLoadError(true);
        return;
      }
      const tplJson = (await tplRes.json()) as TemplatesResponse;
      setSub(subData);
      setTemplates(tplJson.templates);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasPrivateAccess) void load();
  }, [hasPrivateAccess, load]);

  // ── Free zone: same locked treatment every other private-engine page uses.
  if (!ctxLoading && ctx && !hasPrivateAccess) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('whatsapp')}</h1>
        <PrivateUpsellCard
          tone={state === 'lapsed' ? 'resume' : 'trial'}
          title={t('whatsapp')}
          body={tw('lockedBody')}
          ctaLabel={state === 'lapsed' ? t('resumeCta') : t('startTrialCta')}
          onCta={startTrial}
        />
        {modal}
      </div>
    );
  }

  const busy = ctxLoading || (hasPrivateAccess && loading);

  // Plan's included monthly credit, from the plan ladder (Standard 0, Pro and
  // Scale 100 EGP) — the same source the cron's reset RPC tops the bucket up to.
  const plan = getTeacherPlan(sub?.plan_key);
  const monthlyIncluded = plan.blastCreditsMonthly;
  const monthly = Number(sub?.blast_credits_subscription ?? 0);
  const purchased = Number(sub?.blast_credits_purchased ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('whatsapp')}</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">{tw('pageSubtitle')}</p>
      </div>

      {busy ? (
        <>
          <div className="h-44 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
          <div className="h-64 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
        </>
      ) : loadError ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6">
          <p className="text-sm text-[var(--color-text-secondary)]">{tw('loadError')}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-surface-2)]"
          >
            {tw('retry')}
          </button>
        </div>
      ) : (
        <>
          {/* ── Balance ──────────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-[var(--radius-card)] bg-[linear-gradient(150deg,var(--color-teal),var(--color-teal-deep))] p-5 text-[var(--color-text-inverse)]">
            <p className="text-xs opacity-90">{tw('balanceLabel')}</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">
              {formatCurrency(monthly + purchased, locale)}
            </p>
            <p className="mt-1 text-xs opacity-90">
              {tw('balanceIncluded', { amount: formatCurrency(monthlyIncluded, locale) })}
            </p>

            <dl className="mt-4 flex flex-col gap-2 border-t border-[color-mix(in_srgb,var(--color-text-inverse)_20%,transparent)] pt-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="opacity-90">{tw('bucketMonthly')}</dt>
                <dd className="font-semibold tabular-nums">{formatCurrency(monthly, locale)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="opacity-90">{tw('bucketPurchased')}</dt>
                <dd className="font-semibold tabular-nums">{formatCurrency(purchased, locale)}</dd>
              </div>
            </dl>

            <p className="mt-3 border-t border-[color-mix(in_srgb,var(--color-text-inverse)_20%,transparent)] pt-3 text-xs leading-relaxed opacity-90">
              {tw('balanceResetHint')}
            </p>
          </section>

          {/* The one fact that keeps the number above honest: nothing spends it
              yet. deduct_blast_credits exists in the database with zero callers
              in the application, so no message reduces this balance today. */}
          <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
            {tw('balanceNotSpentNote')}
          </p>

          {/* ── Templates ────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-bold text-[var(--color-text-primary)]">
              {tw('templatesHeading')}
            </h2>
            <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
              {tw('templatesSubtitle')}
            </p>

            <ul className="mt-1 flex flex-col gap-2">
              {(templates ?? []).map((tpl) => {
                const Icon = TEMPLATE_ICON[tpl.key] ?? Clock;
                const live = DELIVERY_TONE[tpl.delivery] === 'live';
                return (
                  <li
                    key={tpl.key}
                    className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-4"
                  >
                    <span
                      className={[
                        'flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]',
                        live
                          ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal)]'
                          : 'bg-[var(--color-brass-soft)] text-[var(--color-brass)]',
                      ].join(' ')}
                    >
                      <Icon size={17} aria-hidden />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {tw(`templates.${tpl.key}.name`)}
                        </span>
                        <span className="rounded-[var(--radius-pill)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] font-bold text-[var(--color-text-secondary)]">
                          {tw(`trigger.${tpl.trigger}`)}
                        </span>
                      </div>

                      <p className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                        {tw(`templates.${tpl.key}.when`)}
                      </p>

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={[
                            'rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-bold',
                            live
                              ? 'bg-[var(--color-teal-soft)] text-[var(--color-teal-deep)]'
                              : 'bg-[var(--color-brass-soft)] text-[var(--color-brass)]',
                          ].join(' ')}
                        >
                          {tw(`delivery.${tpl.delivery}`)}
                        </span>
                        <code className="rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                          {tpl.template_name}
                        </code>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
