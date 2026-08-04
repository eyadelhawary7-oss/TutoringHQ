'use client';

import {
  CheckCircle2,
  Clock,
  Factory,
  Home,
  Package,
  PartyPopper,
  Truck,
  UserCheck,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/formatNumber';
import { useLocale } from 'next-intl';

export const TIMELINE_STAGES = [
  'pending_payment',
  'paid',
  'vendor_assigned',
  'in_production',
  'ready_for_pickup',
  'in_transit',
  'delivered',
  'issued',
] as const;

export type TimelineStage = (typeof TIMELINE_STAGES)[number];

const ICONS: Record<TimelineStage, React.ElementType> = {
  pending_payment: Clock,
  paid: CheckCircle2,
  vendor_assigned: UserCheck,
  in_production: Factory,
  ready_for_pickup: Package,
  in_transit: Truck,
  delivered: Home,
  issued: PartyPopper,
};

export type TransitionLite = {
  to_status?: string | null;
  transitioned_at?: string | null;
};

function norm(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

function latestTimeForStage(transitions: TransitionLite[], stage: TimelineStage): string | null {
  let best: string | null = null;
  for (const t of transitions) {
    if (norm(t.to_status) !== stage) continue;
    const c = t.transitioned_at;
    if (!c) continue;
    if (!best || new Date(c).getTime() > new Date(best).getTime()) best = c;
  }
  return best;
}

function stageIndex(status: string): number {
  const s = norm(status);
  const idx = TIMELINE_STAGES.findIndex((x) => x === s);
  if (idx >= 0) return idx;
  if (s === 'pending') return 0;
  if (s === 'printing' || s === 'processing') return 3;
  if (s === 'shipped') return 5;
  if (s === 'confirmed') return 7;
  return 0;
}

export function CardOrderStatusTimeline({
  status,
  transitions,
}: {
  status: string;
  transitions: TransitionLite[];
}) {
  const t = useTranslations('orderTimeline');
  const locale = useLocale();
  const terminal = ['cancelled', 'refunded', 'failed'].includes(norm(status));

  const activeIdx = useMemo(() => {
    if (terminal) return -1;
    return stageIndex(status);
  }, [status, terminal]);

  const labels = useMemo(() => {
    const m: Record<TimelineStage, string> = {
      pending_payment: t('stage.pending_payment'),
      paid: t('stage.paid'),
      vendor_assigned: t('stage.vendor_assigned'),
      in_production: t('stage.in_production'),
      ready_for_pickup: t('stage.ready_for_pickup'),
      in_transit: t('stage.in_transit'),
      delivered: t('stage.delivered'),
      issued: t('stage.issued'),
    };
    return m;
  }, [t]);

  if (terminal) return null;

  const ariaNow = Math.min(TIMELINE_STAGES.length - 1, Math.max(0, activeIdx));

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={TIMELINE_STAGES.length}
      aria-valuenow={ariaNow + 1}
      aria-label={t('aria.progress')}
      className="w-full"
    >
      <div className="hidden md:flex md:flex-row md:items-start md:justify-between gap-2">
        {TIMELINE_STAGES.map((stage, i) => {
          const Icon = ICONS[stage];
          const ts = latestTimeForStage(transitions, stage);
          const timeLabel = ts ? formatDateTime(ts, locale) : '';
          let state: 'completed' | 'active' | 'pending';
          if (i < activeIdx) state = 'completed';
          else if (i === activeIdx) state = 'active';
          else state = 'pending';

          const ring =
            state === 'active'
              ? 'ring-2 ring-teal-400 shadow-[0_0_18px_rgba(45,212,191,0.55)] animate-pulse'
              : state === 'completed'
                ? 'ring-2 ring-teal-600 bg-teal-600 text-white'
                : 'ring-1 ring-stone-300 bg-transparent text-stone-500';

          const aria = `${labels[stage]}, ${t(`state.${state}`)}${timeLabel ? `, ${timeLabel}` : ''}`;

          return (
            <div key={stage} className="flex-1 min-w-0 flex flex-col items-center text-center gap-1">
              <div className={`rounded-full p-2 ${ring}`} aria-label={aria}>
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="text-[10px] font-semibold text-[var(--color-text-primary)] leading-tight px-0.5">
                {labels[stage]}
              </div>
              {timeLabel ? (
                <div className="text-[9px] text-[var(--color-text-tertiary)] tabular-nums">{timeLabel}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="md:hidden flex flex-col gap-4">
        {TIMELINE_STAGES.map((stage, i) => {
          const Icon = ICONS[stage];
          const ts = latestTimeForStage(transitions, stage);
          const timeLabel = ts ? formatDateTime(ts, locale) : '';
          let state: 'completed' | 'active' | 'pending';
          if (i < activeIdx) state = 'completed';
          else if (i === activeIdx) state = 'active';
          else state = 'pending';

          const ring =
            state === 'active'
              ? 'ring-2 ring-teal-400 shadow-[0_0_18px_rgba(45,212,191,0.55)] animate-pulse'
              : state === 'completed'
                ? 'ring-2 ring-teal-600 bg-teal-600 text-white'
                : 'ring-1 ring-stone-300 bg-transparent text-stone-500';

          const aria = `${labels[stage]}, ${t(`state.${state}`)}${timeLabel ? `, ${timeLabel}` : ''}`;

          return (
            <div key={stage} className="flex items-start gap-3">
              <div className={`rounded-full p-2 shrink-0 ${ring}`} aria-label={aria}>
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{labels[stage]}</div>
                <div className="text-xs text-[var(--color-text-tertiary)]">{t(`state.${state}`)}</div>
                {timeLabel ? (
                  <div className="text-xs text-[var(--color-text-secondary)] tabular-nums mt-0.5">{timeLabel}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
