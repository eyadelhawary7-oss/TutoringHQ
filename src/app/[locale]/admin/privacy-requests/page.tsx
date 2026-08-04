'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { ListSkeleton } from '@/components/patterns';
import { EmptyState } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import PrivacyQueueHeader, {
  filterByPrivacyType,
  type PrivacyTypeFilter,
} from '@/components/admin/PrivacyQueueHeader';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { useSidebar } from '@/contexts/SidebarContext';
import { useLayout } from '@/contexts/LayoutContext';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatDate } from '@/lib/formatNumber';

type PrivacyRequest = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  relationship: string | null;
  request_types: string[];
  description: string | null;
  correction_detail: string | null;
  status: string;
  response_notes: string | null;
  created_at: string | null;
  due_at: string | null;
};

type CandidateStudent = {
  id: string;
  name: string;
  student_number: string | null;
  center_id: string;
  phone: string | null;
  parent_phone: string | null;
  is_active: boolean;
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function AdminPrivacyRequestsPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { closeMainSidebar } = useSidebar() ?? {};
  const { setHideShell } = useLayout();

  const [rows, setRows] = useState<PrivacyRequest[]>([]);
  // Merged-Admin-Platform §06 — the design's type filter over the queue.
  const [typeFilter, setTypeFilter] = useState<PrivacyTypeFilter>('all');
  const [slaDays, setSlaDays] = useState(30);
  const visibleRows = useMemo(
    () => filterByPrivacyType(rows, typeFilter) as typeof rows,
    [rows, typeFilter],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Record<string, CandidateStudent[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setHideShell(true);
    return () => setHideShell(false);
  }, [setHideShell]);
  useEffect(() => {
    closeMainSidebar?.();
  }, [closeMainSidebar]);

  const authHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    };
    Object.assign(headers, await getCsrfHeaders(session.access_token));
    return headers;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) {
        setError(tc('notAuthenticated'));
        return;
      }
      const res = await fetch('/api/admin/privacy-requests', { headers });
      const body = (await res.json().catch(() => ({}))) as {
        requests?: PrivacyRequest[];
        slaDays?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? tc('error'));
        return;
      }
      setRows(body.requests ?? []);
      // The 30-day PDPL window is server-owned; the header renders whatever it says.
      if (typeof body.slaDays === 'number') setSlaDays(body.slaDays);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, tc]);

  useEffect(() => {
    void load();
  }, [load]);

  const findStudents = useCallback(async (req: PrivacyRequest) => {
    const headers = await authHeaders();
    if (!headers) return;
    const res = await fetch(`/api/admin/privacy-requests/anonymize?phone=${encodeURIComponent(req.phone)}`, { headers });
    const body = (await res.json().catch(() => ({}))) as { students?: CandidateStudent[] };
    setCandidates((prev) => ({ ...prev, [req.id]: body.students ?? [] }));
  }, [authHeaders]);

  const anonymize = useCallback(async (requestId: string, studentId: string) => {
    if (!window.confirm(t('privacyAnonymizeConfirm'))) return;
    setBusyId(studentId);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await fetch('/api/admin/privacy-requests/anonymize', {
        method: 'POST',
        headers,
        body: JSON.stringify({ requestId, studentId }),
      });
      if (res.ok) {
        await load();
        setExpanded(null);
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? tc('error'));
      }
    } finally {
      setBusyId(null);
    }
  }, [authHeaders, load, t, tc]);

  const isOverdue = (due: string | null, status: string) =>
    !!due && status !== 'completed' && status !== 'rejected' && new Date(due) < new Date();

  return (
    <div className="flex flex-1 min-h-0 min-h-screen flex-col">
      <AdminHeader />
      <div className="flex flex-1">
        <AdminSidebar activeRoute="/admin/privacy-requests" />
        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6 lg:ms-56">
          <h1 className="mb-1 text-xl font-semibold text-[var(--color-text-primary)]">
            {t('privacyRequestsTitle')}
          </h1>
          <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
            {t('privacyRequestsSubtitle')}
          </p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {!loading && rows.length > 0 && (
            <PrivacyQueueHeader
              rows={rows}
              filter={typeFilter}
              onFilter={setTypeFilter}
              slaDays={slaDays}
            />
          )}

          {loading ? (
            /* §02 · the word "Loading" is not a loading state. This is a queue
               of rows, so it takes the list skeleton. */
            <ListSkeleton rows={4} />
          ) : visibleRows.length === 0 ? (
            /* §01 quiet variant · an empty privacy queue is the good state and
               nothing here creates a request, so no action and the muted tile. */
            <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-4">
              <EmptyState icon={ShieldCheck} title={t('privacyRequestsEmpty')} quiet />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] text-start text-[var(--color-text-secondary)]">
                    <th className="p-3 text-start">{t('privacyColRequester')}</th>
                    <th className="p-3 text-start">{t('privacyColTypes')}</th>
                    <th className="p-3 text-start">{t('privacyColCreated')}</th>
                    <th className="p-3 text-start">{t('privacyColDue')}</th>
                    <th className="p-3 text-start">{t('privacyColStatus')}</th>
                    <th className="p-3 text-start"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => {
                    const overdue = isOverdue(r.due_at, r.status);
                    const isDeletion = r.request_types?.includes('deletion');
                    const open = expanded === r.id;
                    return (
                      <tr key={r.id} className="border-b border-[var(--color-border-subtle)] align-top">
                        <td className="p-3">
                          <div className="font-medium text-[var(--color-text-primary)]">{r.full_name}</div>
                          <div className="text-xs text-[var(--color-text-secondary)]">{r.phone}</div>
                          {r.email && <div className="text-xs text-[var(--color-text-secondary)]">{r.email}</div>}
                        </td>
                        <td className="p-3 text-[var(--color-text-primary)]">{(r.request_types ?? []).join(', ')}</td>
                        <td className="p-3 text-[var(--color-text-secondary)]">
                          {r.created_at ? formatDate(new Date(r.created_at), locale) : '-'}
                        </td>
                        <td className={`p-3 ${overdue ? 'font-semibold text-red-500' : 'text-[var(--color-text-secondary)]'}`}>
                          {r.due_at ? formatDate(new Date(r.due_at), locale) : '-'}
                          {overdue && <span className="ms-1">⚠</span>}
                        </td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[r.status] ?? ''}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="p-3">
                          {isDeletion && r.status !== 'completed' && (
                            <button
                              type="button"
                              className="rounded-md border border-[var(--color-border-subtle)] px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                              onClick={() => {
                                if (open) {
                                  setExpanded(null);
                                } else {
                                  setExpanded(r.id);
                                  if (!candidates[r.id]) void findStudents(r);
                                }
                              }}
                            >
                              {open ? tc('close') : t('privacyFindStudent')}
                            </button>
                          )}
                          {open && (
                            <div className="mt-2 space-y-2">
                              {(candidates[r.id] ?? []).length === 0 ? (
                                <div className="text-xs text-[var(--color-text-secondary)]">{t('privacyNoStudentMatch')}</div>
                              ) : (
                                (candidates[r.id] ?? []).map((s) => (
                                  <div key={s.id} className="flex items-center gap-2 rounded-md border border-[var(--color-border-subtle)] p-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-[var(--color-text-primary)]">{s.name}</div>
                                      <div className="text-xs text-[var(--color-text-secondary)]">
                                        {s.student_number ?? s.id.slice(0, 8)} · {s.phone ?? s.parent_phone ?? ''}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={busyId === s.id}
                                      className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                                      onClick={() => void anonymize(r.id, s.id)}
                                    >
                                      {busyId === s.id ? tc('loading') : t('privacyAnonymize')}
                                    </button>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
