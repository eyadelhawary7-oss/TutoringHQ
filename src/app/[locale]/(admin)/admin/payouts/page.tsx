'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { CreditCard, Plus, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminSidebar } from '@/components/AdminSidebar'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { useSidebar } from '@/contexts/SidebarContext'
import { useLayout } from '@/contexts/LayoutContext'

type StaffEmbed = { id: string; name: string; role: string; base_salary: number } | null

interface Payout {
  id: string
  staff_id: string
  period: string
  total_amount: number
  base_salary: number
  t1_commissions: number
  t2_commissions: number
  loyalty_bonuses: number
  override_commissions: number
  commission_count: number
  breakdown: Record<string, unknown>
  status: 'draft' | 'confirmed' | 'paid'
  requires_review: boolean
  adjustment_amount: number
  adjustment_reason: string | null
  paid_at: string | null
  staff?: StaffEmbed | StaffEmbed[]
}

interface StaffOption {
  id: string
  name: string
  role: string
  status: string
}

function relStaff(p: Payout): StaffEmbed {
  const s = p.staff
  if (Array.isArray(s)) return s[0] ?? null
  return s ?? null
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  confirmed:
    'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30',
  paid: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300',
}

type PayoutErrorKey =
  | 'payouts.errors.unauthorized'
  | 'payouts.errors.forbidden'
  | 'payouts.errors.listFailed'
  | 'payouts.errors.invalidPeriod'
  | 'payouts.errors.staffRequired'
  | 'payouts.errors.exists'
  | 'payouts.errors.staffNotFound'
  | 'payouts.errors.saveFailed'
  | 'payouts.errors.notFound'
  | 'payouts.errors.paidLocked'
  | 'payouts.errors.confirmDraftOnly'
  | 'payouts.errors.reviewRequired'
  | 'payouts.errors.markPaidConfirmedOnly'
  | 'payouts.errors.adjustReason'
  | 'payouts.errors.badAction'

function isPayoutErrorKey(k: string | undefined): k is PayoutErrorKey {
  return (
    k === 'payouts.errors.unauthorized' ||
    k === 'payouts.errors.forbidden' ||
    k === 'payouts.errors.listFailed' ||
    k === 'payouts.errors.invalidPeriod' ||
    k === 'payouts.errors.staffRequired' ||
    k === 'payouts.errors.exists' ||
    k === 'payouts.errors.staffNotFound' ||
    k === 'payouts.errors.saveFailed' ||
    k === 'payouts.errors.notFound' ||
    k === 'payouts.errors.paidLocked' ||
    k === 'payouts.errors.confirmDraftOnly' ||
    k === 'payouts.errors.reviewRequired' ||
    k === 'payouts.errors.markPaidConfirmedOnly' ||
    k === 'payouts.errors.adjustReason' ||
    k === 'payouts.errors.badAction'
  )
}

export default function PayoutsPage() {
  const t = useTranslations('admin')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { closeMainSidebar } = useSidebar() ?? {}
  const { setHideShell } = useLayout()

  const isRTL = locale === 'ar'

  const [gateOk, setGateOk] = useState(false)
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [staffList, setStaffList] = useState<StaffOption[]>([])
  const [loading, setLoading] = useState(true)
  const [generateModal, setGenerateModal] = useState(false)
  const [adjustModal, setAdjustModal] = useState<Payout | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentPeriod = new Date().toISOString().slice(0, 7)
  const [genForm, setGenForm] = useState({ staff_id: '', period: currentPeriod })
  const [adjForm, setAdjForm] = useState({ adjustment_amount: '', adjustment_reason: '' })

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }, [])

  const translateError = useCallback(
    (payload: { errorKey?: string }) => {
      if (payload.errorKey && isPayoutErrorKey(payload.errorKey)) {
        return t(payload.errorKey)
      }
      return t('loadError')
    },
    [t],
  )

  const fetchPayouts = useCallback(async () => {
    setLoading(true)
    const session = await getSession()
    if (!session?.access_token) {
      setPayouts([])
      setLoading(false)
      return
    }
    const res = await fetch('/api/admin/payouts', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = (await res.json()) as { payouts?: Payout[]; errorKey?: string }
    if (!res.ok) {
      setError(translateError(data))
      setPayouts([])
      setLoading(false)
      return
    }
    setError(null)
    setPayouts(data.payouts ?? [])
    setLoading(false)
  }, [getSession, translateError])

  const fetchStaff = useCallback(async () => {
    const session = await getSession()
    if (!session?.access_token) return
    const res = await fetch('/api/admin/staff', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = (await res.json()) as { staff?: StaffOption[]; errorKey?: string }
    if (!res.ok) return
    setStaffList((data.staff ?? []).filter((s) => s.status === 'active'))
  }, [getSession])

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
    void fetchPayouts()
    void fetchStaff()
  }, [gateOk, fetchPayouts, fetchStaff])

  async function handleGenerate() {
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const res = await fetch('/api/admin/payouts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(genForm),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateError(data))
      setSaving(false)
      return
    }
    setSaving(false)
    setGenerateModal(false)
    void fetchPayouts()
  }

  async function handleAction(
    payout: Payout,
    action: string,
    extra?: Record<string, unknown>,
  ) {
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const body: Record<string, unknown> = { action, ...extra }
    if (action === 'confirm' && payout.requires_review) {
      body.review_override = true
    }
    const res = await fetch(`/api/admin/payouts/${payout.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateError(data))
      setSaving(false)
      return
    }
    setSaving(false)
    setAdjustModal(null)
    void fetchPayouts()
  }

  async function handleAdjust() {
    if (!adjustModal) return
    await handleAction(adjustModal, 'adjust', {
      adjustment_amount: Number(adjForm.adjustment_amount),
      adjustment_reason: adjForm.adjustment_reason,
    })
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
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-gray-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="billing" activeRoute="/admin/payouts" />

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1000px] w-full mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
              <CreditCard className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
                {t('payouts.title')}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('payouts.record_count', {
                  count: payouts.length.toLocaleString('en-US'),
                })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setGenerateModal(true)
              setError(null)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('payouts.generate')}
          </button>
        </div>

        {error ? (
          <div
            className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-lg p-3"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="space-y-3">
          {loading ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              {tCommon('loading')}
            </div>
          ) : payouts.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl">
              {t('payouts.no_payouts')}
            </div>
          ) : (
            payouts.map((payout) => (
              <div
                key={payout.id}
                className={`bg-white dark:bg-slate-800/50 border rounded-xl p-5 space-y-4 ${
                  payout.requires_review && payout.status === 'draft'
                    ? 'border-amber-400 dark:border-amber-600/50'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-900 dark:text-white font-semibold">
                      {relStaff(payout)?.name ?? t('staff.dash')}
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                      {payout.period}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-md ${STATUS_STYLES[payout.status] ?? ''}`}
                    >
                      {t(`payouts.status_${payout.status}`)}
                    </span>
                    {payout.requires_review && payout.status === 'draft' ? (
                      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden />
                        {t('payouts.requires_review')}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-2xl font-bold text-teal-600 dark:text-teal-400">
                    {Number(payout.total_amount).toLocaleString('en-US')}{' '}
                    {t('staff.currency_suffix')}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {(
                    [
                      { label: t('payouts.base_salary'), value: payout.base_salary },
                      { label: t('payouts.t1_total'), value: payout.t1_commissions },
                      { label: t('payouts.t2_total'), value: payout.t2_commissions },
                      { label: t('payouts.loyalty_total'), value: payout.loyalty_bonuses },
                      { label: t('payouts.override_total'), value: payout.override_commissions },
                    ] as const
                  ).map((item) => (
                    <div
                      key={item.label}
                      className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-3"
                    >
                      <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                        {item.label}
                      </div>
                      <div className="text-slate-900 dark:text-white font-medium text-sm">
                        {Number(item.value).toLocaleString('en-US')} {t('staff.currency_suffix')}
                      </div>
                    </div>
                  ))}
                </div>

                {Number(payout.adjustment_amount) !== 0 ? (
                  <div className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2">
                    {t('payouts.adjustment')}:{' '}
                    {Number(payout.adjustment_amount).toLocaleString('en-US')}{' '}
                    {t('staff.currency_suffix')}
                    {payout.adjustment_reason
                      ? ` — ${payout.adjustment_reason}`
                      : ''}
                  </div>
                ) : null}

                {payout.status !== 'paid' ? (
                  <div className="flex gap-2 justify-end flex-wrap">
                    {payout.status === 'draft' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setAdjustModal(payout)
                            setAdjForm({ adjustment_amount: '', adjustment_reason: '' })
                            setError(null)
                          }}
                          className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm transition-colors"
                        >
                          {t('payouts.adjustment')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAction(payout, 'confirm')}
                          disabled={saving}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                        >
                          {payout.requires_review
                            ? t('payouts.confirm_reviewed')
                            : t('payouts.mark_confirmed')}
                        </button>
                      </>
                    ) : null}
                    {payout.status === 'confirmed' ? (
                      <button
                        type="button"
                        onClick={() => void handleAction(payout, 'mark_paid')}
                        disabled={saving}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-sm transition-colors"
                      >
                        <CheckCircle className="w-4 h-4 shrink-0" />
                        {t('payouts.mark_paid')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {payout.status === 'paid' && payout.paid_at ? (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 justify-end">
                    <Clock className="w-3 h-3 shrink-0" aria-hidden />
                    {t('payouts.paid_at_label', {
                      date: new Date(payout.paid_at).toLocaleDateString('en-US'),
                    })}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {generateModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('payouts.generate')}
              </h2>
              {error ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {error}
                </div>
              ) : null}
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('payouts.staff_label')}
                  </label>
                  <select
                    value={genForm.staff_id}
                    onChange={(e) => setGenForm((p) => ({ ...p, staff_id: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  >
                    <option value="">{t('payouts.staff_placeholder')}</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — {s.role === 'sm' ? t('staff.role_sm') : t('staff.role_sr')}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('payouts.period')}
                  </label>
                  <input
                    type="month"
                    value={genForm.period}
                    onChange={(e) => setGenForm((p) => ({ ...p, period: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  />
                  <p className="text-xs text-slate-500 mt-1">{t('payouts.period_format_hint')}</p>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setGenerateModal(false)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm transition-colors"
                >
                  {t('payouts.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  disabled={saving || !genForm.staff_id || !genForm.period}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('payouts.creating') : t('payouts.create_action')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {adjustModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('payouts.adjustment')}
              </h2>
              {error ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {error}
                </div>
              ) : null}
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('payouts.adjustment_amount_label')}
                  </label>
                  <input
                    type="number"
                    value={adjForm.adjustment_amount}
                    onChange={(e) =>
                      setAdjForm((p) => ({ ...p, adjustment_amount: e.target.value }))
                    }
                    placeholder={t('payouts.adjustment_amount_hint')}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('payouts.adjustment_reason')} *
                  </label>
                  <textarea
                    value={adjForm.adjustment_reason}
                    onChange={(e) =>
                      setAdjForm((p) => ({ ...p, adjustment_reason: e.target.value }))
                    }
                    rows={2}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustModal(null)}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm transition-colors"
                >
                  {t('payouts.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleAdjust()}
                  disabled={
                    saving ||
                    adjForm.adjustment_amount === '' ||
                    adjForm.adjustment_reason.trim().length < 5
                  }
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('payouts.applying') : t('payouts.apply')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
