'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/routing'
import { Users, Plus, Edit2, AlertTriangle, CheckCircle, Flag } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminSidebar } from '@/components/AdminSidebar'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { useSidebar } from '@/contexts/SidebarContext'
import { useLayout } from '@/contexts/LayoutContext'
import { formatNumber } from '@/lib/formatNumber'

interface Assignment {
  id: string
  center_id: string
  staff_id: string | null
  sourced_by: 'eyad' | 'sm' | 'sr'
  is_primary: boolean
  assignment_status: string
  assignment_disputed: boolean
  dispute_notes: string | null
  territory_city: string | null
  territory_override_reason: string | null
  referred_by_center: boolean
  assigned_at: string
  centers?: {
    id: string
    name: string
    center_code: string
    plan: string
    city: string
  } | null
  staff?: { id: string; name: string; role: string; city: string } | null
}

interface Center {
  id: string
  name: string
  center_code: string
  plan: string
  city: string
}

interface StaffRow {
  id: string
  name: string
  role: string
  city: string
  status: string
}

interface FormData {
  center_id: string
  staff_id: string
  sourced_by: string
  territory_city: string
  territory_override_reason: string
}

const STATUS_COLORS: Record<string, string> = {
  approved: 'bg-emerald-500/20 text-emerald-300',
  pending_sm_approval: 'bg-amber-500/20 text-amber-300',
  disputed: 'bg-red-500/20 text-red-300',
}

const SOURCED_BY_COLORS: Record<string, string> = {
  eyad: 'bg-purple-500/20 text-purple-300',
  sm: 'bg-teal-500/20 text-teal-300',
  sr: 'bg-blue-500/20 text-blue-300',
}

const STATUS_I18N_KEYS: Record<string, string> = {
  approved: 'centerAssignments.status_approved',
  pending_sm_approval: 'centerAssignments.status_pending_sm_approval',
  disputed: 'centerAssignments.status_disputed',
}

function relCenters(a: Assignment) {
  const x = a.centers
  if (Array.isArray(x)) return x[0] ?? null
  return x ?? null
}

function relStaff(a: Assignment) {
  const s = a.staff
  if (Array.isArray(s)) return s[0] ?? null
  return s ?? null
}

function translateAssignmentError(
  t: ReturnType<typeof useTranslations<'admin'>>,
  payload: { errorKey?: string },
) {
  const k = payload.errorKey
  if (
    k === 'centerAssignments.errors.unauthorized' ||
    k === 'centerAssignments.errors.forbidden_super_admin' ||
    k === 'centerAssignments.errors.misconfigured' ||
    k === 'centerAssignments.errors.center_sourced_required' ||
    k === 'centerAssignments.errors.sourced_by_invalid' ||
    k === 'centerAssignments.errors.eyad_no_staff' ||
    k === 'centerAssignments.errors.sm_sr_requires_staff' ||
    k === 'centerAssignments.errors.duplicate_primary' ||
    k === 'centerAssignments.errors.list_failed' ||
    k === 'centerAssignments.errors.save_failed' ||
    k === 'centerAssignments.errors.invalid_json' ||
    k === 'centerAssignments.errors.not_found'
  ) {
    return t(k)
  }
  return t('loadError')
}

export default function CenterAssignmentsPage() {
  const t = useTranslations('admin')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { closeMainSidebar } = useSidebar() ?? {}
  const { setHideShell } = useLayout()

  const isRTL = locale === 'ar'

  const [gateOk, setGateOk] = useState(false)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [unassigned, setUnassigned] = useState<Center[]>([])
  const [allCenters, setAllCenters] = useState<Center[]>([])
  const [staffList, setStaffList] = useState<StaffRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [disputeModal, setDisputeModal] = useState<Assignment | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<FormData>({
    center_id: '',
    staff_id: '',
    sourced_by: 'eyad',
    territory_city: '',
    territory_override_reason: '',
  })
  const [disputeNotes, setDisputeNotes] = useState('')

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setListError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setAssignments([])
      setLoading(false)
      return
    }
    const res = await fetch('/api/admin/center-assignments', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = (await res.json()) as {
      assignments?: Assignment[]
      unassigned_centers?: Center[]
      all_active_centers?: Center[]
      staff?: StaffRow[]
      errorKey?: string
    }
    if (!res.ok) {
      setListError(translateAssignmentError(t, data))
      setAssignments([])
      setLoading(false)
      return
    }
    setAssignments(data.assignments ?? [])
    setUnassigned(data.unassigned_centers ?? [])
    setAllCenters(data.all_active_centers ?? [])
    setStaffList(data.staff ?? [])
    setLoading(false)
  }, [getSession, t])

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
    void fetchData()
  }, [gateOk, fetchData])

  function resetForm() {
    setForm({
      center_id: '',
      staff_id: '',
      sourced_by: 'eyad',
      territory_city: '',
      territory_override_reason: '',
    })
  }

  function openEdit(a: Assignment) {
    setEditingId(a.id)
    setForm({
      center_id: a.center_id,
      staff_id: a.staff_id ?? '',
      sourced_by: a.sourced_by,
      territory_city: a.territory_city ?? '',
      territory_override_reason: a.territory_override_reason ?? '',
    })
    setShowModal(true)
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }

    const payload = {
      center_id: form.center_id,
      staff_id: form.staff_id || null,
      sourced_by: form.sourced_by,
      territory_city: form.territory_city || null,
      territory_override_reason: form.territory_override_reason || null,
    }

    const url = editingId
      ? `/api/admin/center-assignments/${editingId}`
      : '/api/admin/center-assignments'
    const method = editingId ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateAssignmentError(t, data))
      setSaving(false)
      return
    }
    setSaving(false)
    setShowModal(false)
    setEditingId(null)
    resetForm()
    void fetchData()
  }

  async function handleDisputeFlag() {
    if (!disputeModal) return
    if (disputeNotes.trim().length < 5) {
      setError(t('centerAssignments.dispute_notes_min'))
      return
    }
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const res = await fetch(`/api/admin/center-assignments/${disputeModal.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        assignment_disputed: true,
        assignment_status: 'disputed',
        dispute_notes: disputeNotes,
      }),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateAssignmentError(t, data))
      setSaving(false)
      return
    }
    setSaving(false)
    setDisputeModal(null)
    setDisputeNotes('')
    void fetchData()
  }

  async function handleResolve(assignment: Assignment) {
    const session = await getSession()
    if (!session?.access_token) return
    const res = await fetch(`/api/admin/center-assignments/${assignment.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        assignment_disputed: false,
        assignment_status: 'approved',
        dispute_notes: null,
      }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { errorKey?: string }
      setListError(translateAssignmentError(t, data))
      return
    }
    void fetchData()
  }

  function assignmentStatusLabel(status: string) {
    const i18nKey = STATUS_I18N_KEYS[status]
    if (i18nKey) return t(i18nKey as 'centerAssignments.status_approved')
    return t('centerAssignments.status_unknown', { status })
  }

  function staffCellLabel(a: Assignment) {
    const st = relStaff(a)
    if (!st) return t('centerAssignments.staff_display_eyad')
    const roleKey =
      st.role === 'sm'
        ? ('centerAssignments.staff_role_sm' as const)
        : st.role === 'sr'
          ? ('centerAssignments.staff_role_sr' as const)
          : null
    const roleLabel = roleKey ? t(roleKey) : st.role
    return `${st.name} (${roleLabel})`
  }

  const staffOptionsSm = staffList.filter((s) => s.role === 'sm')
  const staffOptionsSr = staffList.filter((s) => s.role === 'sr')
  const canAddAssignment = staffList.length > 0

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
      <AdminSidebar activeTab="internalTeam" activeRoute="/admin/center-assignments" />

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1400px] w-full mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
                {t('centerAssignments.title')}
              </h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('centerAssignments.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!canAddAssignment}
              title={
                !canAddAssignment ? t('centerAssignments.add_disabled_tooltip') : undefined
              }
              onClick={() => {
                resetForm()
                setEditingId(null)
                setError(null)
                setShowModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:pointer-events-none text-white rounded-lg text-sm font-medium transition-colors"
              aria-label={t('centerAssignments.add')}
            >
              <Plus className="w-4 h-4" aria-hidden />
              {t('centerAssignments.add')}
            </button>
            {!canAddAssignment ? (
              <Link
                href="/admin/staff"
                className="text-sm font-medium text-teal-600 dark:text-teal-400 hover:underline"
              >
                {t('staff.title')} →
              </Link>
            ) : null}
          </div>
        </div>

        {listError && !loading ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {listError}
          </p>
        ) : null}

        {unassigned.length > 0 ? (
          <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-amber-800 dark:text-amber-300 text-sm">
              <span className="font-semibold">{formatNumber(unassigned.length, locale)}</span>{' '}
              {t('centerAssignments.unassigned_warning')}:{' '}
              {unassigned
                .slice(0, 5)
                .map((c) => c.name)
                .join(', ')}
              {unassigned.length > 5
                ? ` ${t('centerAssignments.unassigned_more', {
                    count: formatNumber(unassigned.length - 5, locale),
                  })}`
                : ''}
            </p>
          </div>
        ) : null}

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto shadow-sm dark:shadow-none">
          {loading ? (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {t('centerAssignments.loading')}
            </div>
          ) : assignments.length === 0 ? (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {t('centerAssignments.no_assignments')}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[800px]">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <tr className="text-[var(--color-text-muted)]">
                  <th className={`px-4 py-3 font-medium text-start`}>
                    {t('centerAssignments.col_center')}
                  </th>
                  <th className={`px-4 py-3 font-medium text-start`}>
                    {t('centerAssignments.col_sourced_by')}
                  </th>
                  <th className={`px-4 py-3 font-medium text-start`}>
                    {t('centerAssignments.col_staff')}
                  </th>
                  <th className={`px-4 py-3 font-medium text-start`}>
                    {t('centerAssignments.col_territory')}
                  </th>
                  <th className={`px-4 py-3 font-medium text-start`}>
                    {t('centerAssignments.col_status')}
                  </th>
                  <th className={`px-4 py-3 font-medium text-end`}>
                    {t('centerAssignments.col_actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {assignments.map((a, rowIdx) => {
                  const cen = relCenters(a)
                  return (
                    <tr
                      key={a.id}
                      className={`transition-colors hover:bg-[var(--color-surface-2)]/80 ${
                        a.assignment_disputed
                          ? 'bg-red-50/50 dark:bg-red-900/10'
                          : rowIdx % 2 === 0
                            ? 'bg-[var(--color-surface-0)]'
                            : 'bg-[var(--color-surface-1)]'
                      }`}
                    >
                      <td className={`px-4 py-3 text-start`}>
                        <div className="font-medium text-[var(--color-text-primary)]">{cen?.name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {cen?.center_code} · {cen?.plan} · {cen?.city}
                        </div>
                        {a.referred_by_center ? (
                          <span className="text-xs text-amber-600 dark:text-amber-400 block">
                            {t('centerAssignments.referred_badge')}
                          </span>
                        ) : null}
                      </td>
                      <td className={`px-4 py-3 text-start`}>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-xs font-medium ${
                            SOURCED_BY_COLORS[a.sourced_by] ?? ''
                          }`}
                        >
                          {t(`centerAssignments.sourced_${a.sourced_by}` as 'centerAssignments.sourced_eyad')}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-[var(--color-text-primary)] text-start`}>
                        {staffCellLabel(a)}
                      </td>
                      <td className={`px-4 py-3 text-[var(--color-text-muted)] text-xs text-start`}>
                        {a.territory_city ?? t('centerAssignments.value_empty')}
                        {a.territory_override_reason ? (
                          <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                            {t('centerAssignments.override_note_prefix')}{' '}
                            {a.territory_override_reason}
                          </div>
                        ) : null}
                      </td>
                      <td className={`px-4 py-3 text-start`}>
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-xs ${
                            STATUS_COLORS[a.assignment_status] ?? ''
                          }`}
                        >
                          {assignmentStatusLabel(a.assignment_status)}
                        </span>
                        {a.assignment_disputed && a.dispute_notes ? (
                          <div className="text-xs text-red-600 dark:text-red-400 mt-1">{a.dispute_notes}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => openEdit(a)}
                            className="p-1.5 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors"
                            title={t('centerAssignments.edit')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {!a.assignment_disputed ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDisputeModal(a)
                                setDisputeNotes('')
                                setError(null)
                              }}
                              className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-400 transition-colors"
                              title={t('centerAssignments.dispute_flag')}
                            >
                              <Flag className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleResolve(a)}
                              className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 transition-colors"
                              title={t('centerAssignments.resolve_dispute')}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {showModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {editingId ? t('centerAssignments.edit') : t('centerAssignments.add')}
              </h2>
              {error ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {error}
                </div>
              ) : null}
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                    {t('centerAssignments.center_label')}
                  </label>
                  <select
                    value={form.center_id}
                    onChange={(e) => setForm((p) => ({ ...p, center_id: e.target.value }))}
                    disabled={!!editingId}
                    className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none disabled:opacity-50"
                  >
                    <option value="">{t('centerAssignments.center_placeholder')}</option>
                    {allCenters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} - {c.center_code} ({c.plan})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                    {t('centerAssignments.sourced_by_label')}
                  </label>
                  <select
                    value={form.sourced_by}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        sourced_by: e.target.value,
                        staff_id: e.target.value === 'eyad' ? '' : p.staff_id,
                      }))
                    }
                    className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                  >
                    <option value="eyad">{t('centerAssignments.sourced_eyad')}</option>
                    <option value="sm">{t('centerAssignments.sourced_sm')}</option>
                    <option value="sr">{t('centerAssignments.sourced_sr')}</option>
                  </select>
                </div>

                {form.sourced_by !== 'eyad' ? (
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                      {t('centerAssignments.staff_label')}
                    </label>
                    <select
                      value={form.staff_id}
                      onChange={(e) => setForm((p) => ({ ...p, staff_id: e.target.value }))}
                      className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                    >
                      <option value="">{t('centerAssignments.staff_placeholder')}</option>
                      {(form.sourced_by === 'sm' ? staffOptionsSm : staffOptionsSr).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} - {s.city}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                    {t('centerAssignments.territory_city_label')}
                  </label>
                  <input
                    type="text"
                    value={form.territory_city}
                    onChange={(e) => setForm((p) => ({ ...p, territory_city: e.target.value }))}
                    placeholder={t('centerAssignments.territory_placeholder_example')}
                    className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none placeholder:text-[var(--color-text-muted)]"
                  />
                </div>

                {form.territory_city ? (
                  <div>
                    <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                      {t('centerAssignments.override_reason_label')}
                    </label>
                    <input
                      type="text"
                      value={form.territory_override_reason}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, territory_override_reason: e.target.value }))
                      }
                      className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingId(null)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                >
                  {t('centerAssignments.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={
                    saving ||
                    !form.center_id ||
                    !form.sourced_by ||
                    (form.sourced_by !== 'eyad' && !form.staff_id)
                  }
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('centerAssignments.saving') : t('centerAssignments.save')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {disputeModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-amber-800/40 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('centerAssignments.dispute_flag')} - {relCenters(disputeModal)?.name}
              </h2>
              {error ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {error}
                </div>
              ) : null}
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('centerAssignments.dispute_notes_label')} *
                </label>
                <textarea
                  value={disputeNotes}
                  onChange={(e) => setDisputeNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] text-sm focus:border-amber-500 outline-none resize-none"
                />
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDisputeModal(null)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                >
                  {t('centerAssignments.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisputeFlag()}
                  disabled={saving || disputeNotes.trim().length < 5}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('centerAssignments.saving') : t('centerAssignments.dispute_flag')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
