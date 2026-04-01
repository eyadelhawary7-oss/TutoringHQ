'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, MessageCircle } from 'lucide-react'
import { AdminSidebar } from '@/components/AdminSidebar'
import { useLayout } from '@/contexts/LayoutContext'
import { cn } from '@/lib/utils'
import type { NotificationTypes, WaPackBillingSummary, WaPackCenter } from '@/types/whatsapp-pack'

interface AdminWaPackClientProps {
  initialCenters: WaPackCenter[]
  initialNotificationTypes: NotificationTypes
  initialStats: { totalEnabled: number; totalActiveParents: number; totalMRR: number }
}

const DEFAULT_NOTIFICATION_TYPES: NotificationTypes = {
  scan: true,
  absence: true,
  balance: true,
  announcement: true,
}

const DEFAULT_BILLING: WaPackBillingSummary = {
  totalAmount: 0,
  parentCount: 0,
  status: 'not_issued',
}

function asNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmtInt(v: unknown): string {
  return asNum(v).toLocaleString('en-US')
}

function billingStatusKey(s: string | undefined): WaPackBillingSummary['status'] {
  if (s === 'charged' || s === 'pending' || s === 'failed' || s === 'not_issued') {
    return s
  }
  return 'not_issued'
}

function normalizeCenter(raw: Partial<WaPackCenter> & { id?: string }): WaPackCenter {
  const billingIn = raw.billing && typeof raw.billing === 'object' ? raw.billing : DEFAULT_BILLING
  const status = billingStatusKey(billingIn.status)
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    plan: String(raw.plan ?? ''),
    phone: raw.phone ?? null,
    parent_pack_enabled: Boolean(raw.parent_pack_enabled),
    parent_pack_active_parents: asNum(raw.parent_pack_active_parents),
    billing: {
      totalAmount: asNum(billingIn.totalAmount),
      parentCount: asNum(billingIn.parentCount),
      status,
    },
  }
}

const PLAN_NAME_KEYS = ['nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const
type PlanNameKey = (typeof PLAN_NAME_KEYS)[number]

function isPlanNameKey(p: string): p is PlanNameKey {
  return (PLAN_NAME_KEYS as readonly string[]).includes(p)
}

function billingBadgeClass(status: WaPackBillingSummary['status']): string {
  switch (status) {
    case 'charged':
      return 'bg-emerald-100 text-emerald-800 border border-emerald-200'
    case 'pending':
      return 'bg-amber-100 text-amber-800 border border-amber-200'
    case 'failed':
      return 'bg-red-100 text-red-800 border border-red-200'
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200'
  }
}

function PackToggle({
  value,
  disabled,
  onToggle,
  ariaLabel,
}: {
  value: boolean
  disabled: boolean
  onToggle: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors',
        value ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-600',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'h-6 w-6 rounded-full bg-white shadow transition-[margin]',
          value ? 'ms-auto' : 'ms-0',
        )}
      />
    </button>
  )
}

export default function AdminWaPackClient(props: AdminWaPackClientProps) {
  const t = useTranslations('adminWaPack')
  const tNotif = useTranslations('whatsappPack')
  const tPlans = useTranslations('billing.planNames')
  const locale = useLocale()
  const [centers, setCenters] = useState<WaPackCenter[]>(() =>
    (Array.isArray(props.initialCenters) ? props.initialCenters : []).map((c) => normalizeCenter(c)),
  )
  const [notifTypes, setNotifTypes] = useState<NotificationTypes>(() => ({
    ...DEFAULT_NOTIFICATION_TYPES,
    ...(props.initialNotificationTypes ?? {}),
  }))
  const [stats, setStats] = useState(() => ({
    totalEnabled: asNum(props.initialStats?.totalEnabled),
    totalActiveParents: asNum(props.initialStats?.totalActiveParents),
    totalMRR: asNum(props.initialStats?.totalMRR),
  }))
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const { setHideShell } = useLayout()

  const billingLabels: Record<WaPackBillingSummary['status'], string> = {
    charged: t('statusCharged'),
    pending: t('statusPending'),
    failed: t('statusFailed'),
    not_issued: t('statusNotIssued'),
  }

  const isRTL = locale === 'ar'

  useEffect(() => {
    setHideShell(true)
    return () => setHideShell(false)
  }, [setHideShell])

  function planLabel(plan: string): string {
    if (isPlanNameKey(plan)) {
      return tPlans(plan)
    }
    return plan
  }

  async function toggleCenter(centerId: string, newValue: boolean) {
    setTogglingId(centerId)
    try {
      const res = await fetch(`/api/admin/whatsapp-pack/${centerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_pack_enabled: newValue }),
      })
      if (!res.ok) throw new Error('failed')
      setCenters((prev) =>
        prev.map((c) => (c.id === centerId ? { ...c, parent_pack_enabled: newValue } : c)),
      )
      setStats((prev) => ({
        ...prev,
        totalEnabled: asNum(prev.totalEnabled) + (newValue ? 1 : -1),
      }))
    } catch {
      // no-op — UI reverts on next refresh
    } finally {
      setTogglingId(null)
    }
  }

  async function toggleConfig(key: keyof NotificationTypes, newValue: boolean) {
    setSavingConfig(true)
    try {
      const res = await fetch('/api/admin/whatsapp-pack/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue }),
      })
      if (!res.ok) throw new Error('failed')
      const data = (await res.json()) as { notificationTypes?: Partial<NotificationTypes> }
      if (data?.notificationTypes && typeof data.notificationTypes === 'object') {
        setNotifTypes((prev) => ({ ...prev, ...data.notificationTypes }))
      }
    } catch {
      // no-op
    } finally {
      setSavingConfig(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
      <AdminSidebar activeRoute="/admin/whatsapp-pack" />
      <main className="flex-1 overflow-auto p-4 pt-20 md:p-6 md:pt-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-8 w-8 text-teal-600" aria-hidden />
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
            {savingConfig ? <Loader2 className="h-5 w-5 animate-spin text-teal-600" aria-hidden /> : null}
          </div>

          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('totalEnabled')}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {fmtInt(stats.totalEnabled)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('totalParents')}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {fmtInt(stats.totalActiveParents)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('totalMrr')}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {fmtInt(stats.totalMRR)} ج.م
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('globalControls')}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('globalControlsDesc')}</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {(
                [
                  ['scan', notifTypes.scan, tNotif('notifScan')],
                  ['absence', notifTypes.absence, tNotif('notifAbsence')],
                  ['balance', notifTypes.balance, tNotif('notifBalance')],
                  ['announcement', notifTypes.announcement, tNotif('notifAnnouncement')],
                ] as const
              ).map(([key, on, label]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 py-3"
                >
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{label}</span>
                  <PackToggle
                    value={Boolean(on)}
                    disabled={savingConfig}
                    ariaLabel={label}
                    onToggle={() => void toggleConfig(key, !on)}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                    <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                      {t('centerName')}
                    </th>
                    <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{t('plan')}</th>
                    <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                      {t('activeParents')}
                    </th>
                    <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                      {t('monthlyAmount')}
                    </th>
                    <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                      {t('billingStatus')}
                    </th>
                    <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                      {t('packEnabled')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(centers ?? []).map((c) => {
                    const billStatus = billingStatusKey(c.billing?.status)
                    const parents = asNum(c.parent_pack_active_parents)
                    return (
                    <tr key={c.id} className="border-b border-[var(--color-border-subtle)]">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--color-text-primary)]">{c.name}</p>
                        {c.phone ? (
                          <p className="text-xs text-[var(--color-text-tertiary)]">{c.phone}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                          {planLabel(c.plan)}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[var(--color-text-primary)]">
                        {fmtInt(parents)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[var(--color-text-primary)]">
                        {fmtInt(parents * 10)} ج.م
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                            billingBadgeClass(billStatus),
                          )}
                        >
                          {billingLabels[billStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <PackToggle
                          value={Boolean(c.parent_pack_enabled)}
                          disabled={togglingId === c.id}
                          ariaLabel={t('packEnabled')}
                          onToggle={() => void toggleCenter(c.id, !c.parent_pack_enabled)}
                        />
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--color-border-subtle)] md:hidden">
              {(centers ?? []).map((c) => {
                const billStatus = billingStatusKey(c.billing?.status)
                const parents = asNum(c.parent_pack_active_parents)
                return (
                <div key={c.id} className="space-y-3 p-4">
                  <div>
                    <p className="font-medium text-[var(--color-text-primary)]">{c.name}</p>
                    {c.phone ? (
                      <p className="text-xs text-[var(--color-text-tertiary)]">{c.phone}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                      {planLabel(c.plan)}
                    </span>
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                        billingBadgeClass(billStatus),
                      )}
                    >
                      {billingLabels[billStatus]}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-[var(--color-text-tertiary)]">{t('activeParents')}: </span>
                      <span className="tabular-nums font-medium">
                        {fmtInt(parents)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--color-text-tertiary)]">{t('monthlyAmount')}: </span>
                      <span className="tabular-nums font-medium">
                        {fmtInt(parents * 10)} ج.م
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t('packEnabled')}
                    </span>
                    <PackToggle
                      value={Boolean(c.parent_pack_enabled)}
                      disabled={togglingId === c.id}
                      ariaLabel={t('packEnabled')}
                      onToggle={() => void toggleCenter(c.id, !c.parent_pack_enabled)}
                    />
                  </div>
                </div>
                )
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
