'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getAdminSession } from '@/lib/adminAuth-client';
import { ArrowLeft, GraduationCap, Search } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { formatCurrency, formatNumber } from '@/lib/formatNumber';

/**
 * `/admin/teachers` — the solo-teacher account list, beside `/admin/centers`.
 *
 * Deliberately NOT in this screen:
 *   - the design's **Unverified** filter chip. Verification is C1 (Valify) and
 *     no verification column exists yet, so the chip would filter on nothing.
 *   - the design's per-row green **verified check**, for the same reason.
 * Both come back when C1 lands, and the chip list below is where they go.
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

type ChipKey = 'all' | 'active' | 'trial' | 'overdue';

const CHIPS: ChipKey[] = ['all', 'active', 'trial', 'overdue'];

/** Status dot colour. Green running, amber trialling, red behind, grey neither. */
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

/** Known teacher tiers, sharing the CEO console's short keys. */
const KNOWN_TIERS = ['standard', 'pro', 'scale'] as const;

/**
 * `plan_key` is free text in the catalog, so an unknown tier must render as
 * itself rather than as a missing-message key path.
 */
function tierKey(tier: string | null): (typeof KNOWN_TIERS)[number] | null {
  const short = (tier ?? '').replace(/^teacher_/, '');
  return (KNOWN_TIERS as readonly string[]).includes(short)
    ? (short as (typeof KNOWN_TIERS)[number])
    : null;
}

export default function AdminTeachersPage() {
  const t = useTranslations('adminTeachers');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [teachers, setTeachers] = useState<AdminTeacherRow[]>([]);
  const [chip, setChip] = useState<ChipKey>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const session = await getAdminSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/teachers', {
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
      setTeachers(data.teachers || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [router]);

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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teachers.filter((row) => {
      if (chip === 'active' && row.status !== 'active') return false;
      if (chip === 'trial' && row.status !== 'trial') return false;
      // "Overdue" is the money-behind view: past due, and suspended for it.
      if (chip === 'overdue' && row.status !== 'overdue' && row.status !== 'suspended') return false;
      if (!q) return true;
      return (
        (row.name ?? '').toLowerCase().includes(q) ||
        (row.phone ?? '').toLowerCase().includes(q) ||
        (row.subject ?? '').toLowerCase().includes(q)
      );
    });
  }, [teachers, chip, query]);

  const countFor = useCallback(
    (key: ChipKey) => {
      if (key === 'all') return teachers.length;
      if (key === 'overdue') {
        return teachers.filter((r) => r.status === 'overdue' || r.status === 'suspended').length;
      }
      return teachers.filter((r) => r.status === key).length;
    },
    [teachers],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/teachers" />
        <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 overflow-auto lg:ms-56">
          <div className="flex items-center gap-2 mb-4">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-1.5 rounded-lg hover:bg-muted"
              aria-label={tCommon('back')}
            >
              <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
            </button>
            <h1 className="text-xl font-bold">{t('title')}</h1>
          </div>

          <div className="flex-1">
            <div className="relative mb-4 max-w-md">
              <Search
                className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="w-full ps-9 pe-3 py-2 rounded-lg border border-border bg-[var(--color-surface-1)] text-sm text-[var(--color-text-primary)]"
              />
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {CHIPS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChip(key)}
                  aria-pressed={chip === key}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    chip === key
                      ? 'bg-teal-600 text-white'
                      : 'border border-border bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] hover:bg-muted'
                  }`}
                >
                  {t(`chips.${key}` as 'chips.all')} {formatNumber(countFor(key), locale)}
                </button>
              ))}
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
            ) : visible.length === 0 ? (
              <div className="text-center py-16 text-[var(--color-text-muted)]">
                <GraduationCap className="mx-auto mb-2 h-8 w-8" aria-hidden />
                {teachers.length === 0 ? t('empty') : t('noMatch')}
              </div>
            ) : (
              <ul className="rounded-xl border border-border bg-[var(--color-surface-1)] overflow-hidden divide-y divide-[var(--color-border-subtle)]">
                {visible.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/admin/teachers/${row.id}` as never)}
                      className="flex w-full items-center gap-3 p-4 text-start hover:bg-muted transition-colors"
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-sm font-semibold text-teal-700"
                        aria-hidden
                      >
                        {initialsOf(row.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-semibold text-[var(--color-text-primary)]">
                            {row.name ?? tCommon('notSet')}
                          </span>
                          {row.isTest && (
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800">
                              {t('testRow')}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">
                          {row.subject ? `${row.subject} · ` : ''}
                          {t('studentsCount', { count: formatNumber(row.studentCount, locale) })}
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-xs font-medium text-[var(--color-text-secondary)]">
                          {tierKey(row.tier)
                            ? t(`tiers.${tierKey(row.tier)}` as 'tiers.standard')
                            : (row.tier ?? t('noPlan'))}
                        </span>
                        <span className="block font-mono text-sm text-[var(--color-text-primary)]">
                          {formatCurrency(row.monthlyMrr, locale)}
                        </span>
                      </span>
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[row.status]}`}
                        aria-label={t(`statuses.${row.status}` as 'statuses.active')}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs text-[var(--color-text-muted)] leading-relaxed">
              {t('footnote')}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
