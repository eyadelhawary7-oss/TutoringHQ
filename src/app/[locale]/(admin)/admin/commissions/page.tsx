'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { TrendingUp, Pause, Unlock, Wallet } from 'lucide-react'
import { EmptyState } from '@/components/shared'
import { supabase } from '@/lib/supabase'
import { AdminSidebar } from '@/components/AdminSidebar'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { useSidebar } from '@/contexts/SidebarContext'
import { useLayout } from '@/contexts/LayoutContext'
import { formatNumber } from '@/lib/formatNumber'

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
  center_id: string | null
  teacher_id?: string | null
  owner_type?: 'center' | 'teacher' | null
  teacher?: { id: string; name: string | null } | null
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
  pending:
    'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]',
  eligible:
    'bg-amber-100 text-amber-800 border border-amber-300',
  paid: 'bg-emerald-100 text-emerald-800',
  clawed_back: 'bg-red-100 text-red-800',
  reassigned: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)] line-through',
}

const T2_COLORS: Record<string, string> = {
  locked:
    'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)]',
  eligible:
    'bg-amber-100 text-amber-800 border border-amber-300',
  paid: 'bg-emerald-100 text-emerald-800',
  forfeited: 'bg-red-100 text-red-800',
  reassigned: 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] border border-[var(--color-border)] line-through',
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
  const [canWrite, setCanWrite] = useState(false)
  const [viewerRole, setViewerRole] = useState<string | null>(null)
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
      // Phase 4a: CEO sees everything; sales_manager / sales_rep render the page and
      // get their scoped rows from the API. Write actions stay CEO-only (canWrite).
      const allowed =
        j.role === 'super_admin' || j.role === 'sales_manager' || j.role === 'sales_rep'
      if (!j?.isAdmin || !allowed) {
        router.replace('/dashboard')
        return
      }
      setViewerRole(j.role ?? null)
      setCanWrite(j.role === 'super_admin')
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
      <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">
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

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1400px] w-full mx-auto min-w-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
              {t('commissions.title')}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('commissions.record_count', {
                count: formatNumber(commissions.length, locale),
              })}
            </p>
            {!canWrite && viewerRole ? (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {viewerRole === 'sales_manager'
                  ? t('commissions.scoped_note_manager')
                  : t('commissions.scoped_note_rep')}
              </p>
            ) : null}
          </div>
          {/* Phase 6: scoped CSV export — the API returns only the viewer's rows
              (CEO=all, manager=team+override, rep=own), so the link is safe for all three. */}
          <a
            href="/api/admin/export/commissions"
            className="ms-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
          >
            {t('commissions.export_csv')}
          </a>
        </div>

        {listError && !loading ? (
          <p className="text-sm text-red-600" role="alert">
            {listError}
          </p>
        ) : null}

        <div className="flex gap-4 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-[var(--color-text-muted)] me-1">
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
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                {s === 'all' ? t('filterAll') : t(`commissions.t1_${s}`)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-[var(--color-text-muted)] me-1">
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
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'
                }`}
              >
                {s === 'all' ? t('filterAll') : t(`commissions.t2_${s}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {tCommon('loading')}
            </div>
          ) : commissions.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title={t('commissions.no_commissions')}
              description={t('commissions.no_commissions_description')}
            />
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <tr
                  className={`text-[var(--color-text-muted)] ${isRTL ? 'text-end' : 'text-start'}`}
                >
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_center')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_staff')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_plan')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_total')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_t1')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_t2')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_loyalty')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.active_days')}</th>
                  <th className="px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)]">{t('commissions.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {commissions.map((c, rowIdx) => {
                  const center = relCenters(c)
                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors hover:bg-[var(--color-surface-2)]/80 ${
                        rowIdx % 2 === 0 ? 'bg-[var(--color-surface-0)]' : 'bg-[var(--color-surface-1)]'
                      }`}
                    >
                      <td className="px-4 py-3">
                        {c.owner_type === 'teacher' ? (
                          <>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              {c.teacher?.name || t('staff.dash')}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {t('commissions.owner_teacher')}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium text-[var(--color-text-primary)]">
                              {center?.name ?? t('staff.dash')}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {center?.center_code ?? ''}
                            </div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[var(--color-text-primary)]">{staffDisplayName(c)}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{typeLabel(c)}</div>
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-primary)] capitalize">
                        {c.plan_at_signing}
                      </td>
                      <td className="px-4 py-3 text-teal-600 font-medium">
                        {formatNumber(Number(c.total_commission), locale)}{' '}
                        {t('staff.currency_suffix')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-xs w-fit ${T1_COLORS[c.t1_status] ?? ''}`}
                          >
                            {t(`commissions.t1_${c.t1_status}` as 'commissions.t1_pending')}
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {formatNumber(Number(c.t1_amount), locale)}{' '}
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
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {formatNumber(Number(c.t2_amount), locale)}{' '}
                            {t('staff.currency_suffix')}
                          </span>
                          {c.t2_status === 'locked' && c.center_first_payment_date ? (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {t('commissions.days_until_t2', {
                                count: formatNumber(daysUntilT2(c), locale),
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-xs w-fit ${T2_COLORS[c.loyalty_bonus_status] ?? ''}`}
                          >
                            {t(
                              `commissions.loyalty_${c.loyalty_bonus_status}` as 'commissions.loyalty_locked',
                            )}
                          </span>
                          {/* v2: the loyalty amount (1% of first-12-months revenue) is computed
                              at unlock — show it once it exists; a locked 0 is just "not yet". */}
                          {Number(c.loyalty_bonus_amount) > 0 ? (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {formatNumber(Number(c.loyalty_bonus_amount), locale)}{' '}
                              {t('staff.currency_suffix')}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {isPaused(c) ? (
                            <Pause
                              className="w-3.5 h-3.5 text-amber-500 shrink-0"
                              aria-label={t('commissions.clock_paused')}
                            />
                          ) : null}
                          <span
                            className={`text-sm font-medium ${
                              isPaused(c)
                                ? 'text-amber-600'
                                : 'text-[var(--color-text-primary)]'
                            }`}
                          >
                            {formatNumber(c.active_days ?? 0, locale)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {canWrite && c.t2_status === 'locked' && c.staff_id ? (
                          <button
                            type="button"
                            onClick={() => {
                              setUnlockModal(c)
                              setUnlockReason('')
                              setUnlockError(null)
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-800 rounded-lg text-xs transition-colors"
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
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('commissions.unlock_t2')}
              </h2>
              <div className="bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg p-3 text-sm text-[var(--color-text-primary)]">
                <div>{relCenters(unlockModal)?.name ?? t('staff.dash')}</div>
                <div className="text-[var(--color-text-muted)]">
                  {staffDisplayName(unlockModal)} -{' '}
                  {formatNumber(Number(unlockModal.t2_amount), locale)}{' '}
                  {t('staff.currency_suffix')}
                </div>
              </div>
              {unlockError ? (
                <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">
                  {unlockError}
                </div>
              ) : null}
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('commissions.unlock_reason')} *
                </label>
                <textarea
                  value={unlockReason}
                  onChange={(e) => setUnlockReason(e.target.value)}
                  rows={3}
                  placeholder={t('commissions.unlock_reason_placeholder')}
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] text-sm focus:border-amber-500 outline-none resize-none"
                />
                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('commissions.unlock_reason_counter', {
                    current: formatNumber(unlockReason.length, locale),
                    min: formatNumber(10, locale),
                  })}
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => setUnlockModal(null)}
                  className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                >
                  {t('commissions.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUnlock()}
                  disabled={unlocking || unlockReason.trim().length < 10}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
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
