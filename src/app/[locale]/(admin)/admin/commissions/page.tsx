'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { TrendingUp, Pause, Unlock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminSidebar } from '@/components/AdminSidebar'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { useSidebar } from '@/contexts/SidebarContext'
import { useLayout } from '@/contexts/LayoutContext'

/** Matches product rule T2 eligibility window (see commission schema). */
const T2_ACTIVE_DAYS = 180

type StaffEmbed = { id: string; name: string; role: string } | null
type CentersEmbed = {
  id: string
  name: string
  center_code: string
  plan: string
  billing_status: string
  next_payment_due: string | null
} | null

interface Commission {
  id: string
  center_id: string
  staff_id: string | null
  role_at_time: 'sm' | 'sr' | 'eyad'
  commission_type: string
  plan_at_signing: string
  total_commission: number
  t1_amount: number
  t2_amount: number
  t1_status: string
  t2_status: string
  t2_eligible_at: string | null
  loyalty_bonus_status: string
  loyalty_bonus_amount: number
  center_first_payment_date: string | null
  clock_pause_log: unknown
  active_days: number
  staff?: StaffEmbed | StaffEmbed[]
  centers?: CentersEmbed | CentersEmbed[]
}

const T1_COLORS: Record<string, string> = {
  pending: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  eligible:
    'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
  paid: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300',
  clawed_back: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300',
}

const T2_COLORS: Record<string, string> = {
  locked: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
  eligible:
    'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
  paid: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300',
  forfeited: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-400',
}

function relStaff(c: Commission): StaffEmbed {
  const s = c.staff
  if (Array.isArray(s)) return s[0] ?? null
  return s ?? null
}

function relCenters(c: Commission): CentersEmbed {
  const x = c.centers
  if (Array.isArray(x)) return x[0] ?? null
  return x ?? null
}

function normalizePauseLog(c: Commission): Array<{ paused_at: string; resumed_at: string | null }> {
  const raw = c.clock_pause_log
  if (Array.isArray(raw)) return raw as Array<{ paused_at: string; resumed_at: string | null }>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed)
        ? (parsed as Array<{ paused_at: string; resumed_at: string | null }>)
        : []
    } catch {
      return []
    }
  }
  return []
}

function commissionTypeKey(type: string): 'type_self_sourced' | 'type_override' | 'type_delta' | null {
  if (type === 'self_sourced') return 'type_self_sourced'
  if (type === 'override') return 'type_override'
  if (type === 'delta_upgrade') return 'type_delta'
  return null
}

type CommissionErrorKey =
  | 'commissions.errors.unauthorized'
  | 'commissions.errors.forbidden'
  | 'commissions.errors.listFailed'
  | 'commissions.errors.reasonTooShort'
  | 'commissions.errors.notFound'
  | 'commissions.errors.cannotUnlock'
  | 'commissions.errors.saveFailed'

function isCommissionErrorKey(k: string | undefined): k is CommissionErrorKey {
  return (
    k === 'commissions.errors.unauthorized' ||
    k === 'commissions.errors.forbidden' ||
    k === 'commissions.errors.listFailed' ||
    k === 'commissions.errors.reasonTooShort' ||
    k === 'commissions.errors.notFound' ||
    k === 'commissions.errors.cannotUnlock' ||
    k === 'commissions.errors.saveFailed'
  )
}

export default function CommissionsPage() {
  const t = useTranslations('admin')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { closeMainSidebar } = useSidebar() ?? {}
  const { setHideShell } = useLayout()

  const isRTL = locale === 'ar'

  const [gateOk, setGateOk] = useState(false)
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [filterT1, setFilterT1] = useState('all')
  const [filterT2, setFilterT2] = useState('all')
  const [unlockModal, setUnlockModal] = useState<Commission | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [unlockError, setUnlockError] = useState<string | null>(null)

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }, [])

  const translateApiPayload = useCallback(
    (payload: { errorKey?: string; errorParams?: { status?: string } }) => {
      if (payload.errorKey === 'commissions.errors.cannotUnlock' && payload.errorParams?.status) {
        const statusLabel = t(`commissions.t2_${payload.errorParams.status}` as 'commissions.t2_locked')
        return t('commissions.errors.cannotUnlock', { status: statusLabel })
      }
      if (payload.errorKey && isCommissionErrorKey(payload.errorKey)) {
        return t(payload.errorKey)
      }
      return t('loadError')
    },
    [t],
  )

  const fetchCommissions = useCallback(async () => {
    setLoading(true)
    const session = await getSession()
    if (!session?.access_token) {
      setCommissions([])
      setLoading(false)
      return
    }
    const params = new URLSearchParams()
    if (filterT1 !== 'all') params.set('t1_status', filterT1)
    if (filterT2 !== 'all') params.set('t2_status', filterT2)
    const res = await fetch(`/api/admin/commissions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = (await res.json()) as {
      commissions?: Commission[]
      errorKey?: string
    }
    if (!res.ok) {
      setListError(translateApiPayload(data))
      setCommissions([])
      setLoading(false)
      return
    }
    setListError(null)
    setCommissions(data.commissions ?? [])
    setLoading(false)
  }, [filterT1, filterT2, getSession, translateApiPayload])

  useEffect(() => {
    setHideShell(true)
    return () => setHideShell(false)
  }, [setHideShell])

  useEffect(() => {
    closeMainSidebar?.()
  }, [closeMainSidebar])

  useEffect(() => {
    const gate = async () => {
      const session = await getSession()
      if (!session) {
        router.replace('/login')
        return
      }
      const res = await fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const j = (await res.json().catch(() => ({}))) as { isAdmin?: boolean; role?: string }
      if (!j?.isAdmin || j.role !== 'super_admin') {
        router.replace('/dashboard')
        return
      }
      setGateOk(true)
    }
    void gate()
  }, [getSession, router])

  useEffect(() => {
    if (!gateOk) return
    void fetchCommissions()
  }, [gateOk, fetchCommissions])

  async function handleUnlock() {
    if (!unlockModal) return
    setUnlocking(true)
    setUnlockError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setUnlocking(false)
      return
    }
    const res = await fetch(`/api/admin/commissions/${unlockModal.id}/unlock`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ reason: unlockReason }),
    })
    const data = (await res.json()) as {
      errorKey?: string
      errorParams?: { status?: string }
    }
    if (!res.ok) {
      setUnlockError(translateApiPayload(data))
      setUnlocking(false)
      return
    }
    setUnlocking(false)
    setUnlockModal(null)
    setUnlockReason('')
    void fetchCommissions()
  }

  const isPaused = (c: Commission) => {
    const log = normalizePauseLog(c)
    return (
      log.length > 0 && log[log.length - 1]?.resumed_at === null
    )
  }

  const daysUntilT2 = (c: Commission) =>
    Math.max(0, T2_ACTIVE_DAYS - (c.active_days ?? 0))

  const staffDisplayName = (c: Commission) => {
    const s = relStaff(c)
    if (s?.name) return s.name
    if (c.role_at_time === 'eyad' || !c.staff_id) return t('commissions.eyad_label')
    return t('staff.dash')
  }

  const typeLabel = (c: Commission) => {
    const k = commissionTypeKey(c.commission_type)
    return k ? t(`commissions.${k}`) : c.commission_type
  }

  if (!gateOk) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 dark:text-slate-400">
        {tCommon('loading')}
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="billing" activeRoute="/admin/commissions" />

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t('commissions.title')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('commissions.record_count', {
                count: commissions.length.toLocaleString('en-US'),
              })}
            </p>
          </div>
        </div>

        {listError && !loading ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {listError}
          </p>
        ) : null}

        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400 me-1">
              {t('commissions.filter_t1')}:
            </span>
            {(['all', 'pending', 'eligible', 'paid', 'clawed_back'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterT1(s)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  filterT1 === s
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {s === 'all' ? t('filterAll') : t(`commissions.t1_${s}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-slate-500 dark:text-slate-400 me-1">
              {t('commissions.filter_t2')}:
            </span>
            {(['all', 'locked', 'eligible', 'paid', 'forfeited'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterT2(s)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  filterT2 === s
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {s === 'all' ? t('filterAll') : t(`commissions.t2_${s}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              {tCommon('loading')}
            </div>
          ) : commissions.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              {t('commissions.no_commissions')}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[var(--color-surface-2)]">
                <tr
                  className={`text-slate-500 dark:text-slate-400 ${isRTL ? 'text-end' : 'text-start'}`}
                >
                  <th className="px-4 py-3 font-medium">{t('commissions.col_center')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_staff')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_plan')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_total')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_t1')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_t2')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_loyalty')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.active_days')}</th>
                  <th className="px-4 py-3 font-medium">{t('commissions.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {commissions.map((c) => {
                  const center = relCenters(c)
                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 dark:text-white">
                          {center?.name ?? t('staff.dash')}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {center?.center_code ?? ''}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-slate-900 dark:text-white">{staffDisplayName(c)}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{typeLabel(c)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 capitalize">
                        {c.plan_at_signing}
                      </td>
                      <td className="px-4 py-3 text-teal-600 dark:text-teal-400 font-medium">
                        {Number(c.total_commission).toLocaleString('en-US')}{' '}
                        {t('staff.currency_suffix')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-xs w-fit ${T1_COLORS[c.t1_status] ?? ''}`}
                          >
                            {t(`commissions.t1_${c.t1_status}` as 'commissions.t1_pending')}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {Number(c.t1_amount).toLocaleString('en-US')}{' '}
                            {t('staff.currency_suffix')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-xs w-fit ${T2_COLORS[c.t2_status] ?? ''}`}
                          >
                            {t(`commissions.t2_${c.t2_status}` as 'commissions.t2_locked')}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {Number(c.t2_amount).toLocaleString('en-US')}{' '}
                            {t('staff.currency_suffix')}
                          </span>
                          {c.t2_status === 'locked' && c.center_first_payment_date ? (
                            <span className="text-xs text-slate-500 dark:text-slate-500">
                              {t('commissions.days_until_t2', {
                                count: daysUntilT2(c).toLocaleString('en-US'),
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-md text-xs ${T2_COLORS[c.loyalty_bonus_status] ?? ''}`}
                        >
                          {t(
                            `commissions.loyalty_${c.loyalty_bonus_status}` as 'commissions.loyalty_locked',
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {isPaused(c) ? (
                            <Pause
                              className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0"
                              aria-label={t('commissions.clock_paused')}
                            />
                          ) : null}
                          <span
                            className={`text-sm font-medium ${
                              isPaused(c)
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {(c.active_days ?? 0).toLocaleString('en-US')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.t2_status === 'locked' && c.staff_id ? (
                          <button
                            type="button"
                            onClick={() => {
                              setUnlockModal(c)
                              setUnlockReason('')
                              setUnlockError(null)
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 dark:bg-amber-600/20 hover:bg-amber-200 dark:hover:bg-amber-600/40 border border-amber-300 dark:border-amber-600/30 text-amber-800 dark:text-amber-300 rounded-lg text-xs transition-colors"
                          >
                            <Unlock className="w-3 h-3 shrink-0" />
                            {t('commissions.unlock_t2')}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {unlockModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-amber-800/40 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('commissions.unlock_t2')}
              </h2>
              <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 text-sm text-slate-700 dark:text-slate-300">
                <div>{relCenters(unlockModal)?.name ?? t('staff.dash')}</div>
                <div className="text-slate-500 dark:text-slate-400">
                  {staffDisplayName(unlockModal)} -{' '}
                  {Number(unlockModal.t2_amount).toLocaleString('en-US')}{' '}
                  {t('staff.currency_suffix')}
                </div>
              </div>
              {unlockError ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {unlockError}
                </div>
              ) : null}
              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                  {t('commissions.unlock_reason')} *
                </label>
                <textarea
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  rows={3}
                  placeholder={t('commissions.unlock_reason_placeholder')}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-amber-500 outline-none resize-none"
                />
                <div className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  {t('commissions.unlock_reason_counter', {
                    current: unlockReason.length.toLocaleString('en-US'),
                    min: (10).toLocaleString('en-US'),
                  })}
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setUnlockModal(null)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm transition-colors"
                >
                  {t('commissions.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUnlock()}
                  disabled={unlocking || unlockReason.trim().length < 10}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {unlocking ? t('commissions.unlock_unlocking') : t('commissions.unlock_confirm')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
