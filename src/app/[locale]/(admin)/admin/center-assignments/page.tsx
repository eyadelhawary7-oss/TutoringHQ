'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { Users, Plus, Edit2, AlertTriangle, CheckCircle, Flag, UserPlus, Layers } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminSidebar } from '@/components/AdminSidebar'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { useSidebar } from '@/contexts/SidebarContext'
import { useLayout } from '@/contexts/LayoutContext'
import { formatNumber } from '@/lib/formatNumber'

type ViewerRole = 'super_admin' | 'sales_manager'
type Tab = 'centers' | 'teachers'

interface StaffLite {
  id: string
  name: string
  role: string
  city: string
}

interface CenterAssignment {
  id: string
  center_id: string
  staff_id: string | null
  manager_staff_id: string | null
  sourced_by: 'eyad' | 'sm' | 'sr'
  is_primary: boolean
  assignment_status: string
  assignment_disputed: boolean
  dispute_notes: string | null
  territory_city: string | null
  territory_override_reason: string | null
  referred_by_center: boolean
  assigned_at: string
  centers?: { id: string; name: string; center_code: string; plan: string; city: string } | null
  staff?: StaffLite | null
  manager?: StaffLite | null
}

interface TeacherAssignment {
  id: string
  teacher_id: string
  staff_id: string | null
  manager_staff_id: string | null
  sourced_by: 'eyad' | 'sm' | 'sr' | null
  is_primary: boolean
  assignment_status: string
  created_at: string
  teacher?: { teacher_id: string | null; name: string | null; subject: string | null } | null
  staff?: StaffLite | null
  manager?: StaffLite | null
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

interface TeacherLite {
  user_id: string
  name: string
  subject: string | null
}

interface CenterForm {
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

const STATUS_I18N_KEYS: Record<string, string> = {
  approved: 'centerAssignments.status_approved',
  pending_sm_approval: 'centerAssignments.status_pending_sm_approval',
  disputed: 'centerAssignments.status_disputed',
}

function rel<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null
  return x ?? null
}

function translateAssignmentError(
  t: ReturnType<typeof useTranslations<'admin'>>,
  payload: { errorKey?: string },
) {
  const k = payload.errorKey
  if (
    k === 'centerAssignments.errors.unauthorized' ||
    k === 'centerAssignments.errors.forbidden_super_admin' ||
    k === 'centerAssignments.errors.forbidden_not_your_assignment' ||
    k === 'centerAssignments.errors.misconfigured' ||
    k === 'centerAssignments.errors.center_sourced_required' ||
    k === 'centerAssignments.errors.sourced_by_invalid' ||
    k === 'centerAssignments.errors.eyad_no_staff' ||
    k === 'centerAssignments.errors.sm_sr_requires_staff' ||
    k === 'centerAssignments.errors.duplicate_primary' ||
    k === 'centerAssignments.errors.list_failed' ||
    k === 'centerAssignments.errors.save_failed' ||
    k === 'centerAssignments.errors.invalid_json' ||
    k === 'centerAssignments.errors.not_found' ||
    k === 'centerAssignments.errors.batch_requires_manager_and_centers' ||
    k === 'centerAssignments.errors.manager_not_sm' ||
    k === 'centerAssignments.errors.rep_required' ||
    k === 'centerAssignments.errors.rep_not_your_report'
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
  const [tab, setTab] = useState<Tab>('centers')
  const [viewerRole, setViewerRole] = useState<ViewerRole>('super_admin')

  // Center-tab data
  const [assignments, setAssignments] = useState<CenterAssignment[]>([])
  const [unassigned, setUnassigned] = useState<Center[]>([])
  const [allCenters, setAllCenters] = useState<Center[]>([])
  const [staffList, setStaffList] = useState<StaffRow[]>([])
  const [reps, setReps] = useState<StaffRow[]>([])

  // Teacher-tab data
  const [teacherAssignments, setTeacherAssignments] = useState<TeacherAssignment[]>([])
  const [allTeachers, setAllTeachers] = useState<TeacherLite[]>([])
  const [teacherStaffList, setTeacherStaffList] = useState<StaffRow[]>([])
  const [teacherReps, setTeacherReps] = useState<StaffRow[]>([])

  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // Modals / shared editing state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [disputeModal, setDisputeModal] = useState<CenterAssignment | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [subAssign, setSubAssign] = useState<
    | { kind: Tab; id: string; label: string; managerStaffId: string | null }
    | null
  >(null)
  const [overrideRow, setOverrideRow] = useState<
    | { kind: Tab; id: string; label: string; staffId: string | null; managerStaffId: string | null }
    | null
  >(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<CenterForm>({
    center_id: '',
    staff_id: '',
    sourced_by: 'eyad',
    territory_city: '',
    territory_override_reason: '',
  })
  const [disputeNotes, setDisputeNotes] = useState('')

  // Batch-assign state
  const [batchManager, setBatchManager] = useState('')
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())

  // Sub-assign / override selections
  const [pickRep, setPickRep] = useState('')
  const [overrideManager, setOverrideManager] = useState('')
  const [overrideRep, setOverrideRep] = useState('')

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }, [])

  const fetchCenters = useCallback(async () => {
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
      assignments?: CenterAssignment[]
      unassigned_centers?: Center[]
      all_active_centers?: Center[]
      staff?: StaffRow[]
      reps?: StaffRow[]
      viewer?: { role?: ViewerRole }
      errorKey?: string
    }
    if (!res.ok) {
      setListError(translateAssignmentError(t, data))
      setAssignments([])
      setLoading(false)
      return
    }
    if (data.viewer?.role) setViewerRole(data.viewer.role)
    setAssignments(data.assignments ?? [])
    setUnassigned(data.unassigned_centers ?? [])
    setAllCenters(data.all_active_centers ?? [])
    setStaffList(data.staff ?? [])
    setReps(data.reps ?? [])
    setLoading(false)
  }, [getSession, t])

  const fetchTeachers = useCallback(async () => {
    setLoading(true)
    setListError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setTeacherAssignments([])
      setLoading(false)
      return
    }
    const res = await fetch('/api/admin/teacher-assignments', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = (await res.json()) as {
      assignments?: TeacherAssignment[]
      all_teachers?: TeacherLite[]
      staff?: StaffRow[]
      reps?: StaffRow[]
      viewer?: { role?: ViewerRole }
      errorKey?: string
    }
    if (!res.ok) {
      setListError(translateAssignmentError(t, data))
      setTeacherAssignments([])
      setLoading(false)
      return
    }
    if (data.viewer?.role) setViewerRole(data.viewer.role)
    setTeacherAssignments(data.assignments ?? [])
    setAllTeachers(data.all_teachers ?? [])
    setTeacherStaffList(data.staff ?? [])
    setTeacherReps(data.reps ?? [])
    setLoading(false)
  }, [getSession, t])

  const refresh = useCallback(() => {
    if (tab === 'centers') void fetchCenters()
    else void fetchTeachers()
  }, [tab, fetchCenters, fetchTeachers])

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
      const allowed = !!j?.isAdmin && (j.role === 'super_admin' || j.role === 'sales_manager')
      if (!allowed) {
        router.replace('/dashboard')
        return
      }
      if (j.role === 'sales_manager') setViewerRole('sales_manager')
      setGateOk(true)
    }
    void gate()
  }, [getSession, router])

  useEffect(() => {
    if (!gateOk) return
    refresh()
  }, [gateOk, refresh])

  const isCeo = viewerRole === 'super_admin'
  const currentReps = tab === 'centers' ? reps : teacherReps
  const currentStaff = tab === 'centers' ? staffList : teacherStaffList
  const managerOptions = currentStaff.filter((s) => s.role === 'sm')
  const repOptions = currentStaff.filter((s) => s.role === 'sr')

  function resetForm() {
    setForm({
      center_id: '',
      staff_id: '',
      sourced_by: 'eyad',
      territory_city: '',
      territory_override_reason: '',
    })
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
    refresh()
  }

  async function handleBatchAssign() {
    if (!batchManager || batchSelected.size === 0) {
      setError(t('centerAssignments.errors.batch_requires_manager_and_centers'))
      return
    }
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const url =
      tab === 'centers' ? '/api/admin/center-assignments' : '/api/admin/teacher-assignments'
    const body =
      tab === 'centers'
        ? { center_ids: [...batchSelected], manager_staff_id: batchManager }
        : { teacher_ids: [...batchSelected], manager_staff_id: batchManager }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateAssignmentError(t, data))
      setSaving(false)
      return
    }
    setSaving(false)
    setBatchOpen(false)
    setBatchManager('')
    setBatchSelected(new Set())
    refresh()
  }

  async function handleSubAssign() {
    if (!subAssign || !pickRep) {
      setError(t('centerAssignments.errors.rep_required'))
      return
    }
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const base =
      subAssign.kind === 'centers'
        ? '/api/admin/center-assignments'
        : '/api/admin/teacher-assignments'
    const res = await fetch(`${base}/${subAssign.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ staff_id: pickRep }),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateAssignmentError(t, data))
      setSaving(false)
      return
    }
    setSaving(false)
    setSubAssign(null)
    setPickRep('')
    refresh()
  }

  async function handleOverride() {
    if (!overrideRow) return
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const base =
      overrideRow.kind === 'centers'
        ? '/api/admin/center-assignments'
        : '/api/admin/teacher-assignments'
    const res = await fetch(`${base}/${overrideRow.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        manager_staff_id: overrideManager || null,
        staff_id: overrideRep || null,
      }),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateAssignmentError(t, data))
      setSaving(false)
      return
    }
    setSaving(false)
    setOverrideRow(null)
    refresh()
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
    refresh()
  }

  async function handleResolve(a: CenterAssignment) {
    const session = await getSession()
    if (!session?.access_token) return
    const res = await fetch(`/api/admin/center-assignments/${a.id}`, {
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
    refresh()
  }

  function assignmentStatusLabel(status: string) {
    const i18nKey = STATUS_I18N_KEYS[status]
    if (i18nKey) return t(i18nKey as 'centerAssignments.status_approved')
    return t('centerAssignments.status_unknown', { status })
  }

  function staffRoleLabel(role: string | undefined | null) {
    if (role === 'sm') return t('centerAssignments.staff_role_sm')
    if (role === 'sr') return t('centerAssignments.staff_role_sr')
    return role ?? ''
  }

  const th = `px-4 py-3 text-xs font-semibold tracking-widest uppercase text-[var(--color-text-secondary)] text-start`

  if (!gateOk) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[var(--color-text-muted)]">
        {tCommon('loading')}
      </div>
    )
  }

  const batchPool: { id: string; label: string }[] =
    tab === 'centers'
      ? allCenters.map((c) => ({ id: c.id, label: `${c.name} · ${c.center_code}` }))
      : allTeachers.map((tch) => ({
          id: tch.user_id,
          label: tch.subject ? `${tch.name} · ${tch.subject}` : tch.name,
        }))

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="internalTeam" activeRoute="/admin/center-assignments" />

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1400px] w-full mx-auto min-w-0">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
                {t('centerAssignments.title')}
              </h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                {isCeo
                  ? t('centerAssignments.subtitle')
                  : t('centerAssignments.viewer_manager_subtitle')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCeo ? (
              <button
                type="button"
                onClick={() => {
                  setBatchManager('')
                  setBatchSelected(new Set())
                  setError(null)
                  setBatchOpen(true)
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-4 h-4 shrink-0" aria-hidden />
                {t('centerAssignments.batch_assign')}
              </button>
            ) : null}
            {isCeo && tab === 'centers' ? (
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setEditingId(null)
                  setError(null)
                  setShowModal(true)
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden />
                {t('centerAssignments.add')}
              </button>
            ) : null}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)]">
          <button
            type="button"
            onClick={() => setTab('centers')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'centers'
                ? 'border-teal-500 text-teal-600'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t('centerAssignments.tab_centers')}
          </button>
          <button
            type="button"
            onClick={() => setTab('teachers')}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === 'teachers'
                ? 'border-teal-500 text-teal-600'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {t('centerAssignments.tab_teachers')}
          </button>
        </div>

        {listError && !loading ? (
          <p className="text-sm text-red-600" role="alert">
            {listError}
          </p>
        ) : null}

        {isCeo && tab === 'centers' && unassigned.length > 0 ? (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-amber-800 text-sm">
              <span className="font-semibold">{formatNumber(unassigned.length, locale)}</span>{' '}
              {t('centerAssignments.unassigned_warning')}
            </p>
          </div>
        ) : null}

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto shadow-sm">
          {loading ? (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {t('centerAssignments.loading')}
            </div>
          ) : tab === 'centers' ? (
            assignments.length === 0 ? (
              <div className="p-12 text-center text-[var(--color-text-muted)]">
                {t('centerAssignments.no_assignments')}
              </div>
            ) : (
              <table className="w-full text-sm min-w-[900px]">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                  <tr className="text-[var(--color-text-muted)]">
                    <th className={th}>{t('centerAssignments.col_center')}</th>
                    <th className={th}>{t('centerAssignments.col_manager')}</th>
                    <th className={th}>{t('centerAssignments.col_rep')}</th>
                    <th className={th}>{t('centerAssignments.col_status')}</th>
                    <th className={`${th} text-end`}>{t('centerAssignments.col_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {assignments.map((a) => {
                    const cen = rel(a.centers)
                    const mgr = rel(a.manager)
                    const st = rel(a.staff)
                    return (
                      <tr key={a.id} className="hover:bg-[var(--color-surface-2)]/80 transition-colors">
                        <td className="px-4 py-3 text-start">
                          <div className="font-medium text-[var(--color-text-primary)]">{cen?.name}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {cen?.center_code} · {cen?.plan} · {cen?.city}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-start text-[var(--color-text-primary)]">
                          {mgr ? mgr.name : t('centerAssignments.manager_none')}
                        </td>
                        <td className="px-4 py-3 text-start">
                          {st ? (
                            <span className="text-[var(--color-text-primary)]">
                              {st.name} ({staffRoleLabel(st.role)})
                            </span>
                          ) : (
                            <span className="text-amber-600 text-xs">
                              {t('centerAssignments.rep_unassigned')}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-start">
                          <span
                            className={`inline-block px-2 py-0.5 rounded-md text-xs ${
                              STATUS_COLORS[a.assignment_status] ?? ''
                            }`}
                          >
                            {assignmentStatusLabel(a.assignment_status)}
                          </span>
                          {a.assignment_disputed && a.dispute_notes ? (
                            <div className="text-xs text-red-600 mt-1">{a.dispute_notes}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-end">
                          <div className="flex items-center gap-2 justify-end">
                            {!isCeo && a.manager_staff_id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSubAssign({
                                    kind: 'centers',
                                    id: a.id,
                                    label: cen?.name ?? '',
                                    managerStaffId: a.manager_staff_id,
                                  })
                                  setPickRep(a.staff_id ?? '')
                                  setError(null)
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs transition-colors"
                              >
                                <UserPlus className="w-3.5 h-3.5" />
                                {t('centerAssignments.subassign')}
                              </button>
                            ) : null}
                            {isCeo ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOverrideRow({
                                      kind: 'centers',
                                      id: a.id,
                                      label: cen?.name ?? '',
                                      staffId: a.staff_id,
                                      managerStaffId: a.manager_staff_id,
                                    })
                                    setOverrideManager(a.manager_staff_id ?? '')
                                    setOverrideRep(a.staff_id ?? '')
                                    setError(null)
                                  }}
                                  className="p-1.5 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors"
                                  title={t('centerAssignments.override_title')}
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
                                    className="p-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors"
                                    title={t('centerAssignments.dispute_flag')}
                                  >
                                    <Flag className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handleResolve(a)}
                                    className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-700 transition-colors"
                                    title={t('centerAssignments.resolve_dispute')}
                                  >
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          ) : teacherAssignments.length === 0 ? (
            <div className="p-12 text-center text-[var(--color-text-muted)]">
              {t('centerAssignments.no_teacher_assignments')}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[900px]">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
                <tr className="text-[var(--color-text-muted)]">
                  <th className={th}>{t('centerAssignments.col_teacher')}</th>
                  <th className={th}>{t('centerAssignments.col_manager')}</th>
                  <th className={th}>{t('centerAssignments.col_rep')}</th>
                  <th className={th}>{t('centerAssignments.col_status')}</th>
                  <th className={`${th} text-end`}>{t('centerAssignments.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {teacherAssignments.map((a) => {
                  const tch = rel(a.teacher)
                  const mgr = rel(a.manager)
                  const st = rel(a.staff)
                  return (
                    <tr key={a.id} className="hover:bg-[var(--color-surface-2)]/80 transition-colors">
                      <td className="px-4 py-3 text-start">
                        <div className="font-medium text-[var(--color-text-primary)]">
                          {tch?.name ?? t('centerAssignments.value_empty')}
                        </div>
                        {tch?.subject ? (
                          <div className="text-xs text-[var(--color-text-muted)]">{tch.subject}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-start text-[var(--color-text-primary)]">
                        {mgr ? mgr.name : t('centerAssignments.manager_none')}
                      </td>
                      <td className="px-4 py-3 text-start">
                        {st ? (
                          <span className="text-[var(--color-text-primary)]">
                            {st.name} ({staffRoleLabel(st.role)})
                          </span>
                        ) : (
                          <span className="text-amber-600 text-xs">
                            {t('centerAssignments.rep_unassigned')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-start">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-xs ${
                            STATUS_COLORS[a.assignment_status] ?? ''
                          }`}
                        >
                          {assignmentStatusLabel(a.assignment_status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex items-center gap-2 justify-end">
                          {!isCeo && a.manager_staff_id ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSubAssign({
                                  kind: 'teachers',
                                  id: a.id,
                                  label: tch?.name ?? '',
                                  managerStaffId: a.manager_staff_id,
                                })
                                setPickRep(a.staff_id ?? '')
                                setError(null)
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              {t('centerAssignments.subassign')}
                            </button>
                          ) : null}
                          {isCeo ? (
                            <button
                              type="button"
                              onClick={() => {
                                setOverrideRow({
                                  kind: 'teachers',
                                  id: a.id,
                                  label: tch?.name ?? '',
                                  staffId: a.staff_id,
                                  managerStaffId: a.manager_staff_id,
                                })
                                setOverrideManager(a.manager_staff_id ?? '')
                                setOverrideRep(a.staff_id ?? '')
                                setError(null)
                              }}
                              className="p-1.5 rounded-lg bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-secondary)] transition-colors"
                              title={t('centerAssignments.override_title')}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Batch-assign modal (CEO) */}
        {batchOpen ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {tab === 'centers'
                  ? t('centerAssignments.batch_assign_centers_title')
                  : t('centerAssignments.batch_assign_teachers_title')}
              </h2>
              {error ? (
                <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">{error}</div>
              ) : null}
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('centerAssignments.batch_manager_label')}
                </label>
                <select
                  value={batchManager}
                  onChange={(e) => setBatchManager(e.target.value)}
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                >
                  <option value="">{t('centerAssignments.batch_manager_placeholder')}</option>
                  {managerOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {s.city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('centerAssignments.batch_items_label')} ({formatNumber(batchSelected.size, locale)})
                </label>
                <div className="max-h-64 overflow-y-auto border border-[var(--color-border)] rounded-lg divide-y divide-[var(--color-border)]">
                  {batchPool.length === 0 ? (
                    <div className="p-4 text-sm text-[var(--color-text-muted)] text-center">
                      {t('centerAssignments.batch_no_items')}
                    </div>
                  ) : (
                    batchPool.map((item) => (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-surface-2)] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={batchSelected.has(item.id)}
                          onChange={(e) => {
                            setBatchSelected((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(item.id)
                              else next.delete(item.id)
                              return next
                            })
                          }}
                          className="accent-teal-600"
                        />
                        <span className="text-sm text-[var(--color-text-primary)]">{item.label}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setBatchOpen(false)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                >
                  {t('centerAssignments.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleBatchAssign()}
                  disabled={saving || !batchManager || batchSelected.size === 0}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('centerAssignments.saving') : t('centerAssignments.batch_submit')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Sub-assign modal (Manager) */}
        {subAssign ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('centerAssignments.subassign_title')} - {subAssign.label}
              </h2>
              {error ? (
                <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">{error}</div>
              ) : null}
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('centerAssignments.subassign_rep_label')}
                </label>
                {currentReps.length === 0 ? (
                  <p className="text-sm text-amber-600">
                    {t('centerAssignments.subassign_no_reps')}
                  </p>
                ) : (
                  <select
                    value={pickRep}
                    onChange={(e) => setPickRep(e.target.value)}
                    className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                  >
                    <option value="">{t('centerAssignments.subassign_rep_placeholder')}</option>
                    {currentReps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} - {r.city}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setSubAssign(null)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                >
                  {t('centerAssignments.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubAssign()}
                  disabled={saving || !pickRep}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('centerAssignments.saving') : t('centerAssignments.subassign_submit')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Override modal (CEO) */}
        {overrideRow ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('centerAssignments.override_title')} - {overrideRow.label}
              </h2>
              {error ? (
                <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">{error}</div>
              ) : null}
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('centerAssignments.manager_col_label')}
                </label>
                <select
                  value={overrideManager}
                  onChange={(e) => setOverrideManager(e.target.value)}
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                >
                  <option value="">{t('centerAssignments.manager_placeholder')}</option>
                  {managerOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {s.city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">
                  {t('centerAssignments.col_rep')}
                </label>
                <select
                  value={overrideRep}
                  onChange={(e) => setOverrideRep(e.target.value)}
                  className="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-[var(--color-text-primary)] text-sm focus:border-teal-500 outline-none"
                >
                  <option value="">{t('centerAssignments.rep_unassigned')}</option>
                  {repOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} - {s.city}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setOverrideRow(null)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)] border border-[var(--color-border)] text-[var(--color-text-primary)] rounded-lg text-sm transition-colors"
                >
                  {t('centerAssignments.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleOverride()}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('centerAssignments.saving') : t('centerAssignments.save')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Single-add modal (CEO, centers) */}
        {showModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {editingId ? t('centerAssignments.edit') : t('centerAssignments.add')}
              </h2>
              {error ? (
                <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">{error}</div>
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
                      {(form.sourced_by === 'sm' ? managerOptions : repOptions).map((s) => (
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
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('centerAssignments.saving') : t('centerAssignments.save')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Dispute modal (CEO) */}
        {disputeModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-amber-800/40 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-xl">
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {t('centerAssignments.dispute_flag')} - {rel(disputeModal.centers)?.name}
              </h2>
              {error ? (
                <div className="text-red-600 text-sm bg-red-50 rounded-lg p-3">{error}</div>
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
