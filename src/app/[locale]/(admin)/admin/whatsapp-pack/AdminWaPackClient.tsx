'use client'

import { Fragment, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, MessageCircle, RefreshCw } from 'lucide-react'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { AdminSidebar } from '@/components/AdminSidebar'
import { useLayout } from '@/contexts/LayoutContext'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { getAnnouncementCap, PLAN_INVOICE_MINIMUMS } from '@/lib/parentPack'
import type { NotificationTypes, WaPackBillingSummary, WaPackCenter } from '@/types/whatsapp-pack'
import { useToast } from '@/hooks/useToast'
import { formatCurrency, formatDate, formatNumber, formatPhoneLeadPlus } from '@/lib/formatNumber'

interface AdminWaPackClientProps {
  initialCenters: WaPackCenter[]
  initialNotificationTypes: NotificationTypes
  initialStats: { totalEnabled: number; totalActiveParents: number; totalMRR: number }
  pendingRequestCount: number
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

function fmtInt(v: unknown, loc: string): string {
  return formatNumber(asNum(v), loc)
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
  const customMinRaw = raw.pack_custom_invoice_minimum
  const customMinNum =
    typeof customMinRaw === 'number'
      ? customMinRaw
      : typeof customMinRaw === 'string' && customMinRaw !== ''
        ? Number(customMinRaw)
        : NaN
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    plan: String(raw.plan ?? ''),
    phone: raw.phone ?? null,
    parent_pack_enabled: Boolean(raw.parent_pack_enabled),
    parent_pack_active_parents: asNum(raw.parent_pack_active_parents),
    announcement_balance: asNum(raw.announcement_balance),
    billing: {
      totalAmount: asNum(billingIn.totalAmount),
      parentCount: asNum(billingIn.parentCount),
      status,
    },
    pack_request_status: String(raw.pack_request_status ?? 'none'),
    pack_requested_at: raw.pack_requested_at ?? null,
    pack_rejection_reason: raw.pack_rejection_reason ?? null,
    pack_pending_balance: asNum(raw.pack_pending_balance),
    pack_months_without_invoice: asNum(raw.pack_months_without_invoice),
    pack_custom_invoice_minimum:
      Number.isFinite(customMinNum) && customMinNum > 0 ? customMinNum : null,
  }
}

const PLAN_NAME_KEYS = ['solo', 'nano', 'starter', 'pro', 'business', 'enterprise', 'top_centers'] as const
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
      return 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
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
        value ? 'bg-teal-600' : 'bg-[var(--color-surface-3)]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span
        className={cn(
          'h-6 w-6 rounded-full bg-[var(--color-surface-1)] shadow transition-[margin]',
          value ? 'ms-auto' : 'ms-0',
        )}
      />
    </button>
  )
}

export default function AdminWaPackClient(props: AdminWaPackClientProps) {
  const t = useTranslations('adminWaPack')
  const tRoot = useTranslations()
  const tNotif = useTranslations('whatsappPack')
  const tPlans = useTranslations('billing.planNames')
  const locale = useLocale()
  const toast = useToast()

  const [activeTab, setActiveTab] = useState<'centers' | 'requests'>('centers')
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [customMinimum, setCustomMinimum] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [approveInlineError, setApproveInlineError] = useState<string | null>(null)
  const [rejectInlineError, setRejectInlineError] = useState<string | null>(null)

  const [localCenters, setLocalCenters] = useState<WaPackCenter[]>(() =>
    (Array.isArray(props.initialCenters) ? props.initialCenters : []).map((c) => normalizeCenter(c)),
  )
  const [localPendingCount, setLocalPendingCount] = useState(asNum(props.pendingRequestCount))

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
  const currencySuffix = locale === 'ar' ? 'ج.م' : 'EGP'

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

  function packRequestStatusBadge(status: string) {
    if (status === 'approved') {
      return (
        <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
          {tRoot('admin.statusApproved')}
        </span>
      )
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          {tRoot('admin.statusPending')}
        </span>
      )
    }
    if (status === 'rejected') {
      return (
        <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
          {tRoot('admin.statusRejected')}
        </span>
      )
    }
    return <span className="text-[var(--color-text-tertiary)]">-</span>
  }

  function billingStatusDisplay(c: WaPackCenter, billStatus: WaPackBillingSummary['status']) {
    const approvedPack = c.pack_request_status === 'approved'
    if (approvedPack && billStatus === 'not_issued') {
      return (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800 dark:bg-teal-900/35 dark:text-teal-200 border border-teal-200 dark:border-teal-700">
            {tRoot('admin.statusApproved')}
          </span>
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
              billingBadgeClass('not_issued'),
            )}
          >
            {billingLabels.not_issued}
          </span>
        </div>
      )
    }
    return (
      <span
        className={cn(
          'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
          billingBadgeClass(billStatus),
        )}
      >
        {billingLabels[billStatus]}
      </span>
    )
  }

  async function toggleCenter(centerId: string, newValue: boolean) {
    setTogglingId(centerId)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const res = await fetch(`/api/admin/whatsapp-pack/${centerId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parent_pack_enabled: newValue }),
      })
      if (!res.ok) return

      setLocalCenters((prev) =>
        prev.map((c) => (c.id === centerId ? { ...c, parent_pack_enabled: newValue } : c)),
      )
      setStats((prev) => ({
        ...prev,
        totalEnabled: asNum(prev.totalEnabled) + (newValue ? 1 : -1),
      }))
    } catch {
      // no-op - UI reverts on next refresh
    } finally {
      setTogglingId(null)
    }
  }

  async function toggleConfig(key: keyof NotificationTypes, newValue: boolean) {
    setSavingConfig(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const res = await fetch('/api/admin/whatsapp-pack/config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ [key]: newValue }),
      })
      if (!res.ok) return

      let data: { notificationTypes?: Partial<NotificationTypes> } = {}
      try {
        const parsed: unknown = await res.json()
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as { notificationTypes?: Partial<NotificationTypes> }
        }
      } catch {
        return
      }

      if (data.notificationTypes && typeof data.notificationTypes === 'object') {
        setNotifTypes((prev) => ({ ...prev, ...data.notificationTypes }))
      }
    } catch {
      // no-op
    } finally {
      setSavingConfig(false)
    }
  }

  const pendingCenters = localCenters.filter((c) => c.pack_request_status === 'pending')
  const [syncingTemplates, setSyncingTemplates] = useState(false)

  async function syncMetaTemplates() {
    if (syncingTemplates) return
    setSyncingTemplates(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) {
        toast.error(t('notSignedIn'))
        return
      }
      const res = await fetch('/api/admin/whatsapp/sync-templates', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        upserted?: number
        fetched?: number
        error?: string
      }
      if (!res.ok) {
        toast.error(body.error || t('syncTemplatesFailed'))
        return
      }
      toast.success(t('syncTemplatesSuccess', { upserted: body.upserted ?? 0, fetched: body.fetched ?? 0 }))
    } catch {
      toast.error(t('syncRequestFailed'))
    } finally {
      setSyncingTemplates(false)
    }
  }

  return (
    <>
      <AdminHeader />
      <div className="flex flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <AdminSidebar activeRoute="/admin/whatsapp-pack" />
        <main className="flex-1 overflow-auto p-4 md:p-6 lg:ms-56">
        <div className="mx-auto max-w-6xl space-y-8">
          <div className="flex flex-wrap items-center gap-2">
            <MessageCircle className="h-8 w-8 text-teal-600" aria-hidden />
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
            {savingConfig ? <Loader2 className="h-5 w-5 animate-spin text-teal-600" aria-hidden /> : null}
            <button
              type="button"
              onClick={() => void syncMetaTemplates()}
              disabled={syncingTemplates}
              aria-label={t('syncTemplates')}
              className="ms-auto inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              {syncingTemplates ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              {t('syncTemplates')}
            </button>
          </div>

          <section className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('totalEnabled')}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {fmtInt(stats.totalEnabled, locale)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('totalParents')}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {fmtInt(stats.totalActiveParents, locale)}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm">
              <p className="text-sm text-[var(--color-text-secondary)]">{t('totalMrr')}</p>
              <p className="mt-1 text-2xl font-bold text-[var(--color-text-primary)] tabular-nums">
                {fmtInt(stats.totalMRR, locale)} {currencySuffix}
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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('centers')}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-medium transition-shadow',
                activeTab === 'centers'
                  ? 'ring-2 ring-teal-500 bg-teal-600 text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
              )}
            >
              {tRoot('admin.centersTab')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={cn(
                'inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-shadow',
                activeTab === 'requests'
                  ? 'ring-2 ring-teal-500 bg-teal-600 text-white'
                  : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
              )}
            >
              {tRoot('admin.packRequestsTab')}
              {localPendingCount > 0 ? (
                <span className="ms-1.5 bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">
                  {formatNumber(localPendingCount, locale)}
                </span>
              ) : null}
            </button>
          </div>

          {activeTab === 'centers' ? (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {t('centerName')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {t('phoneColumn')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">{t('plan')}</th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {t('activeParents')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {t('monthlyAmount')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {tRoot('admin.announcementBalance')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {tRoot('admin.packRequestStatus')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {tRoot('admin.pendingBalance')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {t('billingStatus')}
                      </th>
                      <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                        {t('packEnabled')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(localCenters ?? []).map((c) => {
                      const billStatus = billingStatusKey(c.billing?.status)
                      const parents = asNum(c.parent_pack_active_parents)
                      const balance = asNum(c.announcement_balance ?? 0)
                      const cap = getAnnouncementCap(c.plan)
                      const pct = cap > 0 ? Math.min((balance / cap) * 100, 100) : 0
                      const pend = asNum(c.pack_pending_balance)
                      return (
                        <tr key={c.id} className="border-b border-[var(--color-border-subtle)]">
                          <td className="px-4 py-3">
                            <p className="font-medium text-[var(--color-text-primary)]">{c.name}</p>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-[var(--color-text-primary)]" dir="ltr">
                            {c.phone ? formatPhoneLeadPlus(String(c.phone)) : (
                              <span className="text-[var(--color-text-tertiary)]">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                              {planLabel(c.plan)}
                            </span>
                          </td>
                          <td className="px-4 py-3 tabular-nums text-[var(--color-text-primary)]">
                            {fmtInt(parents, locale)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-[var(--color-text-primary)]">
                            {fmtInt(parents * 10, locale)} {currencySuffix}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs tabular-nums text-[var(--color-text-primary)]">
                              {formatNumber(balance, locale)} / {formatCurrency(cap, locale)}
                            </p>
                            <div className="mt-1 h-[3px] w-full rounded bg-[var(--color-surface-3)]">
                              <div
                                className={cn('h-[3px] rounded', pct < 90 ? 'bg-teal-600' : 'bg-amber-500')}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-4 py-3">{packRequestStatusBadge(c.pack_request_status)}</td>
                          <td className="px-4 py-3">
                            {pend > 0 ? (
                              <>
                                <p className="text-xs tabular-nums text-[var(--color-text-primary)]">
                                  {formatCurrency(pend, locale)}
                                </p>
                                <p className="text-[10px] text-[var(--color-text-tertiary)]">
                                  {formatNumber(asNum(c.pack_months_without_invoice), locale)}mo
                                </p>
                              </>
                            ) : (
                              <span className="text-[var(--color-text-tertiary)]">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {billingStatusDisplay(c, billStatus)}
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
                {(localCenters ?? []).map((c) => {
                  const billStatus = billingStatusKey(c.billing?.status)
                  const parents = asNum(c.parent_pack_active_parents)
                  const balance = asNum(c.announcement_balance ?? 0)
                  const cap = getAnnouncementCap(c.plan)
                  const pct = cap > 0 ? Math.min((balance / cap) * 100, 100) : 0
                  const pend = asNum(c.pack_pending_balance)
                  return (
                    <div key={c.id} className="space-y-3 p-4">
                      <div>
                        <p className="font-medium text-[var(--color-text-primary)]">{c.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t('phoneColumn')}</p>
                        <p className="text-xs tabular-nums text-[var(--color-text-primary)]" dir="ltr">
                          {c.phone ? formatPhoneLeadPlus(String(c.phone)) : (
                            <span className="text-[var(--color-text-tertiary)]">-</span>
                          )}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                          {planLabel(c.plan)}
                        </span>
                        {billingStatusDisplay(c, billStatus)}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-[var(--color-text-tertiary)]">{t('activeParents')}: </span>
                          <span className="tabular-nums font-medium">
                            {fmtInt(parents, locale)}
                          </span>
                        </div>
                        <div>
                          <span className="text-[var(--color-text-tertiary)]">{t('monthlyAmount')}: </span>
                          <span className="tabular-nums font-medium">
                            {fmtInt(parents * 10, locale)} {currencySuffix}
                          </span>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                          {tRoot('admin.announcementBalance')}
                        </p>
                        <p className="mt-0.5 text-xs tabular-nums text-[var(--color-text-primary)]">
                          {formatNumber(balance, locale)} / {formatCurrency(cap, locale)}
                        </p>
                        <div className="mt-1 h-[3px] w-full rounded bg-[var(--color-surface-3)]">
                          <div
                            className={cn('h-[3px] rounded', pct < 90 ? 'bg-teal-600' : 'bg-amber-500')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-[var(--color-text-secondary)]">
                          {tRoot('admin.packRequestStatus')}:
                        </span>
                        {packRequestStatusBadge(c.pack_request_status)}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                          {tRoot('admin.pendingBalance')}
                        </p>
                        {pend > 0 ? (
                          <>
                            <p className="text-xs tabular-nums text-[var(--color-text-primary)]">
                              {formatCurrency(pend, locale)}
                            </p>
                            <p className="text-[10px] text-[var(--color-text-tertiary)]">
                              {formatNumber(asNum(c.pack_months_without_invoice), locale)}mo
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-[var(--color-text-tertiary)]">-</p>
                        )}
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
          ) : (
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-4 sm:p-6">
              {pendingCenters.length === 0 ? (
                <p className="text-center text-sm text-[var(--color-text-tertiary)] py-12">
                  {tRoot('admin.noPendingRequests')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-start text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                        <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                          {t('centerName')}
                        </th>
                        <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">{t('plan')}</th>
                        <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                          {tRoot('admin.phone')}
                        </th>
                        <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                          {tRoot('admin.packRequestedAtColumn')}
                        </th>
                        <th className="px-4 py-3 font-semibold text-[var(--color-text-muted)]">
                          {tRoot('admin.actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingCenters.map((c) => (
                        <Fragment key={c.id}>
                          <tr className="border-b border-[var(--color-border-subtle)] align-top">
                            <td className="px-4 py-3">
                              <p className="font-bold text-[var(--color-text-primary)]">{c.name}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-800">
                                {planLabel(c.plan)}
                              </span>
                            </td>
                            <td className="px-4 py-3 tabular-nums text-[var(--color-text-primary)]" dir="ltr">
                              {c.phone ? formatPhoneLeadPlus(String(c.phone)) : '-'}
                            </td>
                            <td className="px-4 py-3 text-[var(--color-text-primary)]">
                              {c.pack_requested_at
                                ? formatDate(c.pack_requested_at, locale)
                                : '-'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setApprovingId(c.id)
                                    setRejectingId(null)
                                    setCustomMinimum('')
                                    setApproveInlineError(null)
                                  }}
                                  className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                                >
                                  {tRoot('admin.approve')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectingId(c.id)
                                    setApprovingId(null)
                                    setRejectReason('')
                                    setRejectInlineError(null)
                                  }}
                                  className="rounded-lg border border-red-500 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                                >
                                  {tRoot('admin.reject')}
                                </button>
                              </div>
                            </td>
                          </tr>
                          {approvingId === c.id ? (
                            <tr key={`${c.id}-approve`} className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                              <td colSpan={5} className="px-4 py-4">
                                <div className="max-w-lg space-y-3 rounded-lg border border-[var(--color-border-subtle)] p-4">
                                  <h3 className="font-semibold text-[var(--color-text-primary)]">
                                    {tRoot('admin.approvePackTitle')} - {c.name}
                                  </h3>
                                  {c.plan === 'top_centers' ? (
                                    <div className="space-y-1">
                                      <label className="text-sm font-medium text-[var(--color-text-primary)]">
                                        {tRoot('admin.customMinimum')}
                                      </label>
                                      <input
                                        type="number"
                                        min={1000}
                                        step={100}
                                        value={customMinimum}
                                        onChange={(e) => {
                                          setCustomMinimum(e.target.value)
                                          setApproveInlineError(null)
                                        }}
                                        className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
                                        placeholder="e.g. 15000"
                                      />
                                      <p className="text-xs text-[var(--color-text-tertiary)]">
                                        {tRoot('admin.customMinimumNote')}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-sm text-[var(--color-text-secondary)]">
                                      {tRoot('admin.invoiceMinimumWillBe')}{' '}
                                      {formatCurrency(
                                        PLAN_INVOICE_MINIMUMS[c.plan] ?? PLAN_INVOICE_MINIMUMS.starter,
                                        locale,
                                      )}
                                    </p>
                                  )}
                                  {approveInlineError ? (
                                    <p className="text-sm text-red-600">{approveInlineError}</p>
                                  ) : null}
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={async () => {
                                        if (c.plan === 'top_centers' && !customMinimum.trim()) {
                                          setApproveInlineError(tRoot('admin.customMinimumRequired'))
                                          return
                                        }
                                        setActionLoading(true)
                                        setApproveInlineError(null)
                                        try {
                                          const {
                                            data: { session },
                                          } = await supabase.auth.getSession()
                                          if (!session?.access_token) {
                                            toast.error(tRoot('common.errorGeneric'))
                                            return
                                          }
                                          const body: { customInvoiceMinimum?: number } = {}
                                          if (customMinimum.trim()) {
                                            body.customInvoiceMinimum = Number(customMinimum)
                                          }
                                          const res = await fetch(`/api/admin/pack-requests/${c.id}/approve`, {
                                            method: 'POST',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              Authorization: `Bearer ${session.access_token}`,
                                            },
                                            body: JSON.stringify(body),
                                          })
                                          if (res.ok) {
                                            setLocalCenters((prev) =>
                                              prev.map((row) =>
                                                row.id === c.id
                                                  ? {
                                                      ...row,
                                                      pack_request_status: 'approved',
                                                      parent_pack_enabled: true,
                                                    }
                                                  : row,
                                              ),
                                            )
                                            setLocalPendingCount((prev) => Math.max(0, prev - 1))
                                            setApprovingId(null)
                                            setCustomMinimum('')
                                            toast.success(tRoot('admin.packApproved'))
                                          } else {
                                            toast.error(tRoot('common.errorGeneric'))
                                          }
                                        } finally {
                                          setActionLoading(false)
                                        }
                                      }}
                                      className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                                    >
                                      {actionLoading ? (
                                        <Loader2 className="inline h-4 w-4 animate-spin me-1" />
                                      ) : null}
                                      {tRoot('admin.approve')}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => {
                                        setApprovingId(null)
                                        setCustomMinimum('')
                                        setApproveInlineError(null)
                                      }}
                                      className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
                                    >
                                      {tRoot('common.cancel')}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                          {rejectingId === c.id ? (
                            <tr key={`${c.id}-reject`} className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                              <td colSpan={5} className="px-4 py-4">
                                <div className="max-w-lg space-y-3 rounded-lg border border-[var(--color-border-subtle)] p-4">
                                  <h3 className="font-semibold text-[var(--color-text-primary)]">
                                    {tRoot('admin.rejectPackTitle')} - {c.name}
                                  </h3>
                                  <textarea
                                    dir="rtl"
                                    placeholder={tRoot('admin.rejectReasonPlaceholder')}
                                    value={rejectReason}
                                    onChange={(e) => {
                                      setRejectReason(e.target.value)
                                      setRejectInlineError(null)
                                    }}
                                    maxLength={500}
                                    rows={3}
                                    className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 py-2 text-sm"
                                  />
                                  {rejectInlineError ? (
                                    <p className="text-sm text-red-600">{rejectInlineError}</p>
                                  ) : null}
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      disabled={actionLoading || !rejectReason.trim()}
                                      onClick={async () => {
                                        if (!rejectReason.trim()) {
                                          setRejectInlineError(tRoot('admin.rejectReasonRequired'))
                                          return
                                        }
                                        setActionLoading(true)
                                        setRejectInlineError(null)
                                        try {
                                          const {
                                            data: { session },
                                          } = await supabase.auth.getSession()
                                          if (!session?.access_token) {
                                            toast.error(tRoot('common.errorGeneric'))
                                            return
                                          }
                                          const res = await fetch(`/api/admin/pack-requests/${c.id}/reject`, {
                                            method: 'POST',
                                            headers: {
                                              'Content-Type': 'application/json',
                                              Authorization: `Bearer ${session.access_token}`,
                                            },
                                            body: JSON.stringify({ reason: rejectReason.trim() }),
                                          })
                                          if (res.ok) {
                                            setLocalCenters((prev) =>
                                              prev.map((row) =>
                                                row.id === c.id
                                                  ? { ...row, pack_request_status: 'rejected' }
                                                  : row,
                                              ),
                                            )
                                            setLocalPendingCount((prev) => Math.max(0, prev - 1))
                                            setRejectingId(null)
                                            setRejectReason('')
                                            toast.success(tRoot('admin.packRejected'))
                                          } else {
                                            toast.error(tRoot('common.errorGeneric'))
                                          }
                                        } finally {
                                          setActionLoading(false)
                                        }
                                      }}
                                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                                    >
                                      {actionLoading ? (
                                        <Loader2 className="inline h-4 w-4 animate-spin me-1" />
                                      ) : null}
                                      {tRoot('admin.reject')}
                                    </button>
                                    <button
                                      type="button"
                                      disabled={actionLoading}
                                      onClick={() => {
                                        setRejectingId(null)
                                        setRejectReason('')
                                        setRejectInlineError(null)
                                      }}
                                      className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
                                    >
                                      {tRoot('common.cancel')}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
        </main>
      </div>
    </>
  )
}
