'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { maskPhone } from '@/lib/whatsapp-pack'
import type {
  NotificationTypes,
  PatchStudentBody,
  WaPackBillingSummary,
  WaPackStudent,
} from '@/types/whatsapp-pack'

interface WaPackClientProps {
  initialCenter: {
    id: string
    name: string
    parent_pack_enabled: boolean
    parent_pack_active_parents: number
  }
  initialNotificationTypes: NotificationTypes
  initialStudents: WaPackStudent[]
  initialBilling: WaPackBillingSummary
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

export default function WaPackClient(props: WaPackClientProps) {
  const t = useTranslations('whatsappPack')
  const locale = useLocale()
  const [students, setStudents] = useState<WaPackStudent[]>(props.initialStudents)
  const [activeCount, setActiveCount] = useState(props.initialCenter.parent_pack_active_parents)
  const notifTypes = props.initialNotificationTypes
  const billing = props.initialBilling
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const billingLabels: Record<WaPackBillingSummary['status'], string> = {
    charged: t('billing_charged'),
    pending: t('billing_pending'),
    failed: t('billing_failed'),
    not_issued: t('billing_not_issued'),
  }

  const isRTL = locale === 'ar'

  async function toggleStudent(studentId: string, field: keyof PatchStudentBody, newValue: boolean) {
    setLoadingId(studentId)
    try {
      const res = await fetch(`/api/whatsapp-pack/student/${studentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: newValue }),
      })
      if (!res.ok) throw new Error('request failed')
      const data = (await res.json()) as { activeCount?: number }
      setStudents((prev) =>
        prev.map((s) => (s.id === studentId ? { ...s, [field]: newValue } as WaPackStudent : s)),
      )
      if (field === 'parent_pack_opted_in' && typeof data.activeCount === 'number') {
        setActiveCount(data.activeCount)
      }
    } catch {
      // toggle springs back
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div
      className="min-h-screen bg-[var(--color-surface-0)] px-4 py-6 sm:px-6 sm:py-8"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-teal-600 sm:text-3xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-800">
              {t('activeParents')}: {activeCount.toLocaleString('en-US')}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-800">
              {t('monthlyCost')}: {(activeCount * 10).toLocaleString('en-US')} ج.م
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-3 py-1 text-sm font-medium',
                billingBadgeClass(billing.status),
              )}
            >
              {t('billingStatus')}: {billingLabels[billing.status]}
            </span>
          </div>
        </section>

        {!props.initialCenter.parent_pack_enabled ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-6 py-16 text-center shadow-sm">
            <MessageCircle className="mb-4 h-14 w-14 text-teal-600" aria-hidden />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('notEnabled')}</h2>
            <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">{t('notEnabledDesc')}</p>
          </div>
        ) : (
          <>
            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-4 shadow-sm sm:p-6">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['scan', notifTypes.scan, t('notifScan')],
                    ['absence', notifTypes.absence, t('notifAbsence')],
                    ['balance', notifTypes.balance, t('notifBalance')],
                    ['announcement', notifTypes.announcement, t('notifAnnouncement')],
                  ] as const
                ).map(([key, on, label]) => (
                  <span
                    key={key}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium',
                      on
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200',
                    )}
                  >
                    {on ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
                    {label}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">{t('globalNoticesInfo')}</p>
            </section>

            <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm">
              {students.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                  <MessageCircle className="mb-4 h-12 w-12 text-teal-600 opacity-80" aria-hidden />
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    {t('noParentPhones')}
                  </h2>
                  <p className="mt-2 max-w-md text-sm text-[var(--color-text-secondary)]">
                    {t('noParentPhonesDesc')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-2)]">
                          <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                            {t('studentName')}
                          </th>
                          <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                            {t('parentPhone')}
                          </th>
                          <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                            {t('packStatus')}
                          </th>
                          {notifTypes.scan ? (
                            <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                              {t('notifScan')}
                            </th>
                          ) : null}
                          {notifTypes.absence ? (
                            <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                              {t('notifAbsence')}
                            </th>
                          ) : null}
                          {notifTypes.balance ? (
                            <th className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                              {t('notifBalance')}
                            </th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((student) => {
                          const disabledRow = loadingId === student.id
                          const subDisabled = !student.parent_pack_opted_in || disabledRow
                          return (
                            <tr
                              key={student.id}
                              className={cn(
                                'border-b border-[var(--color-border-subtle)]',
                                !student.parent_pack_opted_in && 'opacity-50',
                              )}
                            >
                              <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">
                                {student.name}
                              </td>
                              <td className="px-4 py-3 text-[var(--color-text-secondary)] tabular-nums">
                                {maskPhone(student.parent_phone)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col items-start gap-1">
                                  <PackToggle
                                    value={student.parent_pack_opted_in}
                                    disabled={disabledRow}
                                    ariaLabel={t('packStatus')}
                                    onToggle={() =>
                                      void toggleStudent(
                                        student.id,
                                        'parent_pack_opted_in',
                                        !student.parent_pack_opted_in,
                                      )
                                    }
                                  />
                                  <span className="text-xs text-[var(--color-text-tertiary)]">
                                    {student.parent_pack_opted_in ? t('enrolled') : t('notEnrolled')}
                                  </span>
                                </div>
                              </td>
                              {notifTypes.scan ? (
                                <td className="px-4 py-3">
                                  <PackToggle
                                    value={student.notify_on_scan}
                                    disabled={subDisabled}
                                    ariaLabel={t('notifScan')}
                                    onToggle={() =>
                                      void toggleStudent(student.id, 'notify_on_scan', !student.notify_on_scan)
                                    }
                                  />
                                </td>
                              ) : null}
                              {notifTypes.absence ? (
                                <td className="px-4 py-3">
                                  <PackToggle
                                    value={student.notify_on_absence}
                                    disabled={subDisabled}
                                    ariaLabel={t('notifAbsence')}
                                    onToggle={() =>
                                      void toggleStudent(
                                        student.id,
                                        'notify_on_absence',
                                        !student.notify_on_absence,
                                      )
                                    }
                                  />
                                </td>
                              ) : null}
                              {notifTypes.balance ? (
                                <td className="px-4 py-3">
                                  <PackToggle
                                    value={student.notify_on_balance}
                                    disabled={subDisabled}
                                    ariaLabel={t('notifBalance')}
                                    onToggle={() =>
                                      void toggleStudent(
                                        student.id,
                                        'notify_on_balance',
                                        !student.notify_on_balance,
                                      )
                                    }
                                  />
                                </td>
                              ) : null}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="divide-y divide-[var(--color-border-subtle)] md:hidden">
                    {students.map((student) => {
                      const disabledRow = loadingId === student.id
                      const subDisabled = !student.parent_pack_opted_in || disabledRow
                      return (
                        <div
                          key={student.id}
                          className={cn('space-y-3 p-4', !student.parent_pack_opted_in && 'opacity-50')}
                        >
                          <div>
                            <p className="font-medium text-[var(--color-text-primary)]">{student.name}</p>
                            <p className="text-sm text-[var(--color-text-secondary)] tabular-nums">
                              {maskPhone(student.parent_phone)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex flex-col gap-1">
                              <span className="text-xs text-[var(--color-text-tertiary)]">{t('packStatus')}</span>
                              <PackToggle
                                value={student.parent_pack_opted_in}
                                disabled={disabledRow}
                                ariaLabel={t('packStatus')}
                                onToggle={() =>
                                  void toggleStudent(
                                    student.id,
                                    'parent_pack_opted_in',
                                    !student.parent_pack_opted_in,
                                  )
                                }
                              />
                            </div>
                            {notifTypes.scan ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--color-text-tertiary)]">
                                  {t('notifScan')}
                                </span>
                                <PackToggle
                                  value={student.notify_on_scan}
                                  disabled={subDisabled}
                                  ariaLabel={t('notifScan')}
                                  onToggle={() =>
                                    void toggleStudent(student.id, 'notify_on_scan', !student.notify_on_scan)
                                  }
                                />
                              </div>
                            ) : null}
                            {notifTypes.absence ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--color-text-tertiary)]">
                                  {t('notifAbsence')}
                                </span>
                                <PackToggle
                                  value={student.notify_on_absence}
                                  disabled={subDisabled}
                                  ariaLabel={t('notifAbsence')}
                                  onToggle={() =>
                                    void toggleStudent(
                                      student.id,
                                      'notify_on_absence',
                                      !student.notify_on_absence,
                                    )
                                  }
                                />
                              </div>
                            ) : null}
                            {notifTypes.balance ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-xs text-[var(--color-text-tertiary)]">
                                  {t('notifBalance')}
                                </span>
                                <PackToggle
                                  value={student.notify_on_balance}
                                  disabled={subDisabled}
                                  ariaLabel={t('notifBalance')}
                                  onToggle={() =>
                                    void toggleStudent(
                                      student.id,
                                      'notify_on_balance',
                                      !student.notify_on_balance,
                                    )
                                  }
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
