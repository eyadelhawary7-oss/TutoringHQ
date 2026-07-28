'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession } from '@/lib/adminAuth-client';
import { ArrowLeft, Phone } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatNumber';

/**
 * `/admin/teachers/[id]` — one solo-teacher account, READ ONLY.
 *
 * What the design has that is deliberately absent here:
 *   - **Verified chip and "National ID on file · Valify"** — C1. No verification
 *     column exists; rendering either would be inventing a fact.
 *   - **"Log in as teacher"** — admin impersonation. Auth.
 *   - **"Suspend account"** — a write, and an account-state change.
 * The last two are on the never-ship-without-review line regardless of file, so
 * they are not stubbed here either: a disabled button that looks like it might
 * work is worse than no button.
 *
 * The design's third KPI tile is Attendance %. That needs a definition for a
 * teacher who runs groups across several centres, so this shows **groups**
 * instead — a number that means exactly one thing.
 */

type StatusKey = 'trial' | 'active' | 'overdue' | 'suspended' | 'churned' | 'inactive';

interface AdminTeacherRow {
  id: string;
  name: string | null;
  phone: string | null;
  subject: string | null;
  tier: string | null;
  monthlyMrr: number;
  status: StatusKey;
  studentCount: number;
  groupCount: number;
  createdAt: string | null;
  nextChargeCairoDay: string | null;
  isTest: boolean;
}

const STATUS_DOT: Record<StatusKey, string> = {
  active: 'bg-green-600',
  trial: 'bg-amber-500',
  overdue: 'bg-red-600',
  suspended: 'bg-red-600',
  churned: 'bg-[var(--color-text-muted)]',
  inactive: 'bg-[var(--color-text-muted)]',
};

function initialsOf(name: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[1][0]}`;
}

const KNOWN_TIERS = ['standard', 'pro', 'scale'] as const;

/** `plan_key` is free text — an unknown tier renders as itself, not as a key path. */
function tierKey(tier: string | null): (typeof KNOWN_TIERS)[number] | null {
  const short = (tier ?? '').replace(/^teacher_/, '');
  return (KNOWN_TIERS as readonly string[]).includes(short)
    ? (short as (typeof KNOWN_TIERS)[number])
    : null;
}

export default function AdminTeacherDetailPage() {
  const t = useTranslations('adminTeachers');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const params = useParams();
  const teacherId = typeof params?.id === 'string' ? params.id : '';
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [teacher, setTeacher] = useState<AdminTeacherRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!teacherId) return;
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Same route as the list, filtered to one account, so the two screens can
      // never disagree about what a teacher's numbers are.
      const qs = new URLSearchParams({ teacher_id: teacherId, include_test: '1' });
      const res = await fetch(`/api/admin/teachers?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error || 'Failed to load');
        return;
      }
      const data = await res.json();
      setTeacher((data.teachers ?? [])[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [router, teacherId]);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);

  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/teachers" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin/teachers')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold truncate">
              {teacher?.name ?? t('title')}
            </h1>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
            </div>
          ) : !teacher ? (
            <div className="text-center py-16 text-[var(--color-text-muted)]">{t('notFound')}</div>
          ) : (
            <div className="max-w-3xl space-y-4">
              <div className="rounded-xl border border-border bg-[var(--color-surface-1)] p-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-base font-semibold text-teal-700"
                    aria-hidden
                  >
                    {initialsOf(teacher.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-bold text-[var(--color-text-primary)]">
                      {teacher.name ?? tCommon('notSet')}
                    </p>
                    <p className="truncate text-sm text-[var(--color-text-muted)]">
                      {t('soloTeacher')}
                      {teacher.subject ? ` · ${teacher.subject}` : ''}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800">
                    {tierKey(teacher.tier)
                      ? t(`tiers.${tierKey(teacher.tier)}` as 'tiers.standard')
                      : (teacher.tier ?? t('noPlan'))}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                    <span
                      className={`h-2 w-2 rounded-full ${STATUS_DOT[teacher.status]}`}
                      aria-hidden
                    />
                    {t(`statuses.${teacher.status}` as 'statuses.active')}
                  </span>
                  {teacher.createdAt && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {t('customerSince', {
                        date: formatDate(teacher.createdAt, locale, {
                          year: 'numeric',
                          month: 'long',
                        }),
                      })}
                    </span>
                  )}
                  {teacher.isTest && (
                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">
                      {t('testRow')}
                    </span>
                  )}
                </div>

                {teacher.phone && (
                  <p className="mt-3 inline-flex items-center gap-2 font-mono text-sm text-[var(--color-text-secondary)]">
                    <Phone className="h-4 w-4 shrink-0" aria-hidden />
                    <span dir="ltr">{teacher.phone}</span>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Kpi label={t('kpi.students')} value={formatNumber(teacher.studentCount, locale)} />
                <Kpi label={t('kpi.mrr')} value={formatCurrency(teacher.monthlyMrr, locale)} />
                <Kpi label={t('kpi.groups')} value={formatNumber(teacher.groupCount, locale)} />
              </div>

              {teacher.nextChargeCairoDay && (
                <div className="rounded-xl border border-border bg-[var(--color-surface-1)] p-4">
                  <p className="text-xs text-[var(--color-text-muted)]">{t('nextCharge')}</p>
                  <p className="mt-0.5 font-mono text-sm text-[var(--color-text-primary)]">
                    {formatDate(teacher.nextChargeCairoDay, locale, 'short')}
                  </p>
                </div>
              )}

              <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                {t('readOnlyNote')}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-[var(--color-surface-1)] p-4">
      <p className="text-sm text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}
