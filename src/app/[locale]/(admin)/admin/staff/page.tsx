'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { Users, Plus, Edit2, UserX, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminSidebar } from '@/components/AdminSidebar'
import { AdminHeader } from '@/components/admin/AdminHeader'
import { useSidebar } from '@/contexts/SidebarContext'
import { useLayout } from '@/contexts/LayoutContext'

interface StaffMember {
  id: string
  name: string
  phone: string
  role: 'sm' | 'sr'
  city: string
  territory: string | null
  territory_city: string | null
  base_salary: number
  hire_date: string
  status: 'active' | 'inactive' | 'terminated'
  termination_type: string | null
  reports_to: string | null
  notes: string | null
  center_count: number
  ytd_commission: number
  manager?: { id: string; name: string } | null
}

interface StaffFormData {
  name: string
  phone: string
  role: 'sm' | 'sr'
  city: string
  territory: string
  territory_city: string
  base_salary: string
  hire_date: string
  reports_to: string
  notes: string
}

const CITY_KEYS = [
  'cairo',
  'alexandria',
  'giza',
  'mansoura',
  'tanta',
  'assiut',
  'ismailia',
] as const

type StaffErrorKey =
  | 'staff.errors.unauthorized'
  | 'staff.errors.forbidden'
  | 'staff.errors.listFailed'
  | 'staff.errors.notFound'
  | 'staff.errors.missingRequired'
  | 'staff.errors.invalidRole'
  | 'staff.errors.phoneDuplicate'
  | 'staff.errors.saveFailed'
  | 'staff.errors.terminationRequired'

function isStaffErrorKey(k: string | undefined): k is StaffErrorKey {
  return (
    k === 'staff.errors.unauthorized' ||
    k === 'staff.errors.forbidden' ||
    k === 'staff.errors.listFailed' ||
    k === 'staff.errors.notFound' ||
    k === 'staff.errors.missingRequired' ||
    k === 'staff.errors.invalidRole' ||
    k === 'staff.errors.phoneDuplicate' ||
    k === 'staff.errors.saveFailed' ||
    k === 'staff.errors.terminationRequired'
  )
}

export default function StaffPage() {
  const t = useTranslations('admin')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const { closeMainSidebar } = useSidebar() ?? {}
  const { setHideShell } = useLayout()

  const isRTL = locale === 'ar'

  const [gateOk, setGateOk] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingMember, setEditingMember] = useState<StaffMember | null>(null)
  const [showTerminateModal, setShowTerminateModal] = useState<StaffMember | null>(null)
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState<StaffFormData>({
    name: '',
    phone: '',
    role: 'sr',
    city: 'cairo',
    territory: '',
    territory_city: '',
    base_salary: '15000',
    hire_date: new Date().toISOString().split('T')[0],
    reports_to: '',
    notes: '',
  })
  const [terminateForm, setTerminateForm] = useState({
    termination_type: 'resigned',
    termination_date: new Date().toISOString().split('T')[0],
  })

  const translateApiError = useCallback(
    (payload: { errorKey?: string }) => {
      if (payload.errorKey && isStaffErrorKey(payload.errorKey)) {
        return t(payload.errorKey)
      }
      return t('loadError')
    },
    [t],
  )

  const getSession = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session
  }, [])

  const fetchStaff = useCallback(async () => {
    setLoading(true)
    const session = await getSession()
    if (!session?.access_token) {
      setStaff([])
      setLoading(false)
      return
    }
    const res = await fetch('/api/admin/staff', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = (await res.json()) as { staff?: StaffMember[]; errorKey?: string }
    if (!res.ok) {
      setError(translateApiError(data))
      setStaff([])
      setLoading(false)
      return
    }
    setError(null)
    setStaff(data.staff ?? [])
    setLoading(false)
  }, [getSession, translateApiError])

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
      if (!j?.isAdmin) {
        router.replace('/dashboard')
        return
      }
      setIsSuperAdmin(j.role === 'super_admin')
      setGateOk(true)
    }
    void gate()
  }, [getSession, router])

  useEffect(() => {
    if (!gateOk) return
    void fetchStaff()
  }, [gateOk, fetchStaff])

  const filtered = staff.filter((m) => {
    if (filterRole !== 'all' && m.role !== filterRole) return false
    if (filterStatus !== 'all' && m.status !== filterStatus) return false
    return true
  })

  const managers = staff.filter((m) => m.role === 'sm' && m.status === 'active')

  async function handleSave() {
    if (!isSuperAdmin) return
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const url = editingMember ? `/api/admin/staff/${editingMember.id}` : '/api/admin/staff'
    const method = editingMember ? 'PATCH' : 'POST'
    const payload = {
      ...form,
      base_salary: Number(form.base_salary),
      reports_to: form.role === 'sm' ? null : form.reports_to || null,
      territory: form.territory || null,
      territory_city: form.territory_city || null,
    }
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
      setError(translateApiError(data))
      setSaving(false)
      return
    }
    setSaving(false)
    setShowAddModal(false)
    setEditingMember(null)
    resetForm()
    void fetchStaff()
  }

  async function handleTerminate() {
    if (!showTerminateModal || !isSuperAdmin) return
    setSaving(true)
    setError(null)
    const session = await getSession()
    if (!session?.access_token) {
      setSaving(false)
      return
    }
    const res = await fetch(`/api/admin/staff/${showTerminateModal.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ status: 'terminated', ...terminateForm }),
    })
    const data = (await res.json()) as { errorKey?: string }
    if (!res.ok) {
      setError(translateApiError(data))
      setSaving(false)
      return
    }
    setSaving(false)
    setShowTerminateModal(null)
    void fetchStaff()
  }

  function resetForm() {
    setForm({
      name: '',
      phone: '',
      role: 'sr',
      city: 'cairo',
      territory: '',
      territory_city: '',
      base_salary: '15000',
      hire_date: new Date().toISOString().split('T')[0],
      reports_to: '',
      notes: '',
    })
  }

  function openEdit(member: StaffMember) {
    setEditingMember(member)
    setForm({
      name: member.name,
      phone: member.phone,
      role: member.role,
      city: member.city,
      territory: member.territory ?? '',
      territory_city: member.territory_city ?? '',
      base_salary: String(member.base_salary),
      hire_date: member.hire_date,
      reports_to: member.reports_to ?? '',
      notes: member.notes ?? '',
    })
    setShowAddModal(true)
  }

  const roleBadge = (role: string) =>
    ({
      sm: 'bg-teal-500/20 text-teal-300 border border-teal-500/30',
      sr: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
    })[role] ?? ''

  const statusBadge = (status: string) =>
    ({
      active: 'bg-emerald-500/20 text-emerald-300',
      inactive: 'bg-slate-500/20 text-slate-300',
      terminated: 'bg-red-500/20 text-red-300',
    })[status] ?? ''

  const cityLabel = (key: string) => {
    const k = key as (typeof CITY_KEYS)[number]
    if (CITY_KEYS.includes(k)) {
      return t(`staff.city_${k}`)
    }
    return key
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
      <AdminSidebar activeTab="billing" activeRoute="/admin/staff" />

      <main className="lg:ms-56 p-6 space-y-6 max-w-[1200px] w-full mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900 dark:text-white">
                {t('staff.title')}
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {filtered.length.toLocaleString('en-US')}
              </p>
            </div>
          </div>
          {isSuperAdmin ? (
            <button
              type="button"
              onClick={() => {
                resetForm()
                setEditingMember(null)
                setShowAddModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('staff.add')}
            </button>
          ) : null}
        </div>

        {error && !loading ? (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex gap-3 flex-wrap">
          {(['all', 'active', 'inactive', 'terminated'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filterStatus === s
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {s === 'all' ? t('filterAll') : t(`staff.status_${s}`)}
            </button>
          ))}
          <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 self-center" />
          {(['all', 'sm', 'sr'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setFilterRole(r)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                filterRole === r
                  ? 'bg-slate-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {r === 'all' ? t('filterAll') : t(`staff.role_${r}`)}
            </button>
          ))}
        </div>

        <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl overflow-hidden overflow-x-auto">
          {loading ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              {tCommon('loading')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-500 dark:text-slate-400">
              {t('staff.no_staff')}
            </div>
          ) : (
            <table className="w-full text-sm min-w-[800px]">
              <thead className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[var(--color-surface-2)]">
                <tr
                  className={`text-slate-500 dark:text-slate-400 ${isRTL ? 'text-end' : 'text-start'}`}
                >
                  <th className="px-4 py-3 font-medium">{t('staff.col_name')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.col_role')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.col_city')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.reports_to')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.centers_count')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.ytd_commission')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.base_salary')}</th>
                  <th className="px-4 py-3 font-medium">{t('staff.col_status')}</th>
                  <th className="px-4 py-3 font-medium" aria-label={t('actions')} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700/50">
                {filtered.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">{member.name}</div>
                      <div className="text-slate-500 dark:text-slate-400 text-xs">{member.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-md text-xs font-medium ${roleBadge(member.role)}`}
                      >
                        {t(`staff.role_${member.role}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" aria-hidden />
                        {cityLabel(member.city)}
                      </div>
                      {member.territory_city && member.territory_city !== member.city ? (
                        <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                          {t('staff.territory_mismatch')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-300">
                      {member.manager?.name ?? t('staff.dash')}
                    </td>
                    <td className="px-4 py-3 text-slate-900 dark:text-white font-medium">
                      {member.center_count.toLocaleString('en-US')}
                    </td>
                    <td className="px-4 py-3 text-teal-600 dark:text-teal-400 font-medium">
                      {member.ytd_commission.toLocaleString('en-US')} {t('staff.currency_suffix')}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {Number(member.base_salary).toLocaleString('en-US')} {t('staff.currency_suffix')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs ${statusBadge(member.status)}`}>
                        {t(`staff.status_${member.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isSuperAdmin ? (
                        <div
                          className={`flex items-center gap-2 ${isRTL ? 'justify-start' : 'justify-end'}`}
                        >
                          <button
                            type="button"
                            onClick={() => openEdit(member)}
                            className="p-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors"
                            aria-label={t('staff.edit')}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {member.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => setShowTerminateModal(member)}
                              className="p-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 transition-colors"
                              aria-label={t('staff.deactivate')}
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showAddModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {editingMember ? t('staff.edit') : t('staff.add')}
              </h2>
              {error ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {error}
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.name_label')}
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.phone_label')}
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.base_salary')}
                  </label>
                  <input
                    type="number"
                    value={form.base_salary}
                    onChange={(e) => setForm((prev) => ({ ...prev, base_salary: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.hire_date')}
                  </label>
                  <input
                    type="date"
                    value={form.hire_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, hire_date: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.role_label')}
                  </label>
                  <select
                    value={form.role}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        role: e.target.value as 'sm' | 'sr',
                        base_salary: e.target.value === 'sm' ? '30000' : '15000',
                      }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  >
                    <option value="sr">{t('staff.role_sr')}</option>
                    <option value="sm">{t('staff.role_sm')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.col_city')}
                  </label>
                  <select
                    value={form.city}
                    onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                  >
                    {CITY_KEYS.map((c) => (
                      <option key={c} value={c}>
                        {t(`staff.city_${c}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {form.role === 'sr' ? (
                  <div className="col-span-2">
                    <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                      {t('staff.reports_to')}
                    </label>
                    <select
                      value={form.reports_to}
                      onChange={(e) => setForm((prev) => ({ ...prev, reports_to: e.target.value }))}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none"
                    >
                      <option value="">{t('staff.no_reports_to')}</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <div className="col-span-2">
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.notes_label')}
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                    rows={2}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-teal-500 outline-none resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false)
                    setEditingMember(null)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm transition-colors"
                >
                  {t('staff.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('staff.saving') : t('staff.save')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {showTerminateModal ? (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-surface-1)] border border-red-800/40 rounded-2xl w-full max-w-md p-6 space-y-5 shadow-xl">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                {t('staff.deactivate')} - {showTerminateModal.name}
              </h2>
              {error ? (
                <div className="text-red-600 dark:text-red-400 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                  {error}
                </div>
              ) : null}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg p-3 text-amber-800 dark:text-amber-300 text-sm">
                {t('staff.terminate_warning')}
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.termination_type_label')}
                  </label>
                  <select
                    value={terminateForm.termination_type}
                    onChange={(e) =>
                      setTerminateForm((prev) => ({ ...prev, termination_type: e.target.value }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-red-500 outline-none"
                  >
                    <option value="resigned">{t('staff.termination_type_resigned')}</option>
                    <option value="terminated">{t('staff.termination_type_terminated')}</option>
                    <option value="completed">{t('staff.termination_type_completed')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">
                    {t('staff.termination_date_label')}
                  </label>
                  <input
                    type="date"
                    value={terminateForm.termination_date}
                    onChange={(e) =>
                      setTerminateForm((prev) => ({ ...prev, termination_date: e.target.value }))
                    }
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white text-sm focus:border-red-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowTerminateModal(null)
                    setError(null)
                  }}
                  className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-white rounded-lg text-sm transition-colors"
                >
                  {t('staff.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTerminate()}
                  disabled={saving}
                  className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? t('staff.saving') : t('staff.deactivate')}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}
