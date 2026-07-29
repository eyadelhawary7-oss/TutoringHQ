'use client';

/**
 * R5 · Admin teacher ↔ center linking — `Merged-Admin-Accounts` §03.
 *
 * A NEW route. `/admin/center-assignments` is the sales-commission machinery
 * (staff ↔ center) and shares only a name with this design; `R5` marks it
 * do-not-touch and this screen deliberately does not extend it.
 *
 * Two frames in the design: the link list with a By center / By teacher /
 * Unassigned segmented control, and the assign form.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Link2, UserPlus, ArrowLeft } from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { EmptyState } from '@/components/shared';
import { ListRow, ListSkeleton } from '@/components/patterns';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatNumber } from '@/lib/formatNumber';
import { initialsOf } from '@/lib/initials';

type Teacher = { id: string; name: string | null; subject: string | null; plan: string | null };

type CenterGroup = {
  centerId: string;
  centerName: string;
  location: string | null;
  plan: string | null;
  teachers: Teacher[];
};

type TeacherGroup = Teacher & { centers: { centerId: string; centerName: string | null }[] };

type PendingLink = {
  requestId: string;
  createdAt: string;
  teacher: Teacher;
  centerId: string;
  centerName: string | null;
};

type Payload = {
  byCenter: CenterGroup[];
  byTeacher: TeacherGroup[];
  unassigned: TeacherGroup[];
  pending: PendingLink[];
};

type Grouping = 'byCenter' | 'byTeacher' | 'unassigned';

export default function AdminTeacherLinksPage() {
  const t = useTranslations('admin.teacherLinks');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const isRTL = locale === 'ar';
  const router = useRouter();

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>('byCenter');
  const [assigning, setAssigning] = useState(false);
  const [formTeacher, setFormTeacher] = useState('');
  const [formCenter, setFormCenter] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formDone, setFormDone] = useState(false);

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      router.replace('/login');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/teacher-links', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/admin');
        return;
      }
      if (!res.ok) {
        setError(tCommon('errorGeneric'));
        return;
      }
      setData((await res.json()) as Payload);
    } catch {
      setError(tCommon('errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [router, tCommon]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Every center that has a teacher, plus every center a pending request names. */
  const centerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of data?.byCenter ?? []) seen.set(c.centerId, c.centerName);
    for (const p of data?.pending ?? []) {
      if (p.centerName && !seen.has(p.centerId)) seen.set(p.centerId, p.centerName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [data]);

  const teacherOptions = useMemo(() => data?.byTeacher ?? [], [data]);

  async function submitAssignment() {
    if (!formTeacher || !formCenter) return;
    setSaving(true);
    setFormError(null);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setSaving(false);
      return;
    }
    try {
      const res = await fetch('/api/admin/teacher-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(await getCsrfHeaders(token)),
        },
        body: JSON.stringify({ teacherId: formTeacher, centerId: formCenter }),
      });
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (!res.ok) {
        const known = ['ALREADY_A_MEMBER', 'REQUEST_ALREADY_PENDING', 'TEACHER_NOT_FOUND', 'CENTER_NOT_FOUND'];
        setFormError(
          body.code && known.includes(body.code) ? t(`errors.${body.code}`) : tCommon('errorGeneric'),
        );
        return;
      }
      setFormDone(true);
      setFormTeacher('');
      setFormCenter('');
      await load();
    } catch {
      setFormError(tCommon('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  const teacherMeta = (x: Teacher) =>
    [x.subject, x.plan].filter(Boolean).join(' · ') || t('noSubject');

  const shell = (children: React.ReactNode) => (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeTab="centers" activeRoute="/admin/teacher-links" />
      <main className="lg:ms-56 p-6 space-y-6 max-w-[1400px] w-full mx-auto min-w-0">{children}</main>
    </div>
  );

  if (assigning) {
    return shell(
      <>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setAssigning(false);
              setFormError(null);
              setFormDone(false);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-md text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] btn-press chq-focus"
            aria-label={tCommon('back')}
          >
            <DirectionalIcon icon={ArrowLeft} className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold">{t('assignTitle')}</h1>
        </div>

        <div className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-5">
          <div className="space-y-2">
            <label
              htmlFor="tl-teacher"
              className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
            >
              {t('teacherLabel')}
            </label>
            <select
              id="tl-teacher"
              value={formTeacher}
              onChange={(e) => setFormTeacher(e.target.value)}
              className="chq-focus w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm"
            >
              <option value="">{t('teacherPlaceholder')}</option>
              {teacherOptions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name ?? t('unnamedTeacher')} — {teacherMeta(x)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="tl-center"
              className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]"
            >
              {t('centerLabel')}
            </label>
            <select
              id="tl-center"
              value={formCenter}
              onChange={(e) => setFormCenter(e.target.value)}
              className="chq-focus w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm"
            >
              <option value="">{t('centerPlaceholder')}</option>
              {centerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/*
            The design's "Link type · Visiting / Permanent" toggle is NOT here.
            `teacher_center` has no link-type column (id, teacher_id, center_id,
            status, invited_by, invited_at, accepted_at, created_at — checked
            against information_schema 29 July), so the control would write
            nowhere. Omitted rather than stubbed, per the standing rule.
          */}
          <p className="rounded-lg bg-[var(--color-surface-2)] p-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
            {t('consentNote')}
          </p>

          {formError && (
            <p className="text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}
          {formDone && (
            <p className="text-sm text-emerald-700" role="status">
              {t('requestOpened')}
            </p>
          )}

          <button
            type="button"
            onClick={submitAssignment}
            disabled={saving || !formTeacher || !formCenter}
            className="btn-press chq-focus min-h-[44px] w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving ? tCommon('saving') : t('saveAssignment')}
          </button>
        </div>
      </>,
    );
  }

  return shell(
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20">
            <Link2 className="h-5 w-5 text-teal-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{t('title')}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{t('subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setAssigning(true)}
          className="btn-press chq-focus inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-700"
        >
          <UserPlus className="h-4 w-4" />
          {t('assign')}
        </button>
      </div>

      <div
        role="tablist"
        aria-label={t('title')}
        className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-1"
      >
        {(['byCenter', 'byTeacher', 'unassigned'] as const).map((g) => (
          <button
            key={g}
            role="tab"
            type="button"
            aria-selected={grouping === g}
            onClick={() => setGrouping(g)}
            className={`btn-press chq-focus min-h-[40px] rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
              grouping === g
                ? 'bg-teal-600 text-white'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'
            }`}
          >
            {t(`tab_${g}`)}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <ListSkeleton rows={5} />
      ) : (
        <>
          {grouping === 'byCenter' && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('centersHeading')}
              </h2>
              {(data?.byCenter.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Link2}
                  title={t('empty.centersTitle')}
                  description={t('empty.centersBody')}
                  alt={t('empty.centersAlt')}
                />
              ) : (
                <div className="space-y-2">
                  {data?.byCenter.map((c) => (
                    <ListRow
                      key={c.centerId}
                      avatar={initialsOf(c.centerName)}
                      title={c.centerName}
                      meta={c.teachers.map((x) => x.name ?? t('unnamedTeacher')).join(' · ')}
                      badge={
                        <span className="shrink-0 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                          {formatNumber(c.teachers.length, locale)}
                        </span>
                      }
                      chevron={false}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {grouping === 'byTeacher' && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('teachersHeading')}
              </h2>
              {(data?.byTeacher.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Link2}
                  title={t('empty.teachersTitle')}
                  description={t('empty.teachersBody')}
                  alt={t('empty.teachersAlt')}
                />
              ) : (
                <div className="space-y-2">
                  {data?.byTeacher.map((x) => (
                    <ListRow
                      key={x.id}
                      avatar={initialsOf(x.name ?? '')}
                      title={x.name ?? t('unnamedTeacher')}
                      meta={
                        x.centers.length
                          ? x.centers.map((c) => c.centerName ?? tCommon('notSet')).join(' · ')
                          : t('notLinked')
                      }
                      badge={
                        <span className="shrink-0 rounded-md bg-[var(--color-surface-2)] px-2 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                          {formatNumber(x.centers.length, locale)}
                        </span>
                      }
                      chevron={false}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {grouping === 'unassigned' && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('unassignedHeading')}
              </h2>
              {(data?.unassigned.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Link2}
                  title={t('empty.unassignedTitle')}
                  description={t('empty.unassignedBody')}
                  alt={t('empty.unassignedAlt')}
                />
              ) : (
                <div className="space-y-2">
                  {data?.unassigned.map((x) => (
                    <ListRow
                      key={x.id}
                      avatar={initialsOf(x.name ?? '')}
                      title={x.name ?? t('unnamedTeacher')}
                      meta={t('notLinked')}
                      chevron={false}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {(data?.pending.length ?? 0) > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {t('pendingHeading')}
              </h2>
              <div className="space-y-2">
                {data?.pending.map((p) => (
                  <ListRow
                    key={p.requestId}
                    avatar={initialsOf(p.teacher.name ?? '')}
                    title={p.teacher.name ?? t('unnamedTeacher')}
                    meta={p.centerName ?? tCommon('notSet')}
                    badge={
                      <span className="shrink-0 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                        {t('pendingBadge')}
                      </span>
                    }
                    chevron={false}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>,
  );
}
