'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { AdminSidebar } from '@/components/AdminSidebar';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { formatDate } from '@/lib/formatNumber';
import { normalizePhone } from '@/lib/utils/phone';

interface DemoRequestRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  center_name: string | null;
  status: 'pending' | 'contacted' | 'approved' | 'rejected' | string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export default function AdminDemoRequestsPage() {
  const tAdmin = useTranslations('admin');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const isRTL = locale === 'ar';
  const [rows, setRows] = useState<DemoRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setError(tCommon('notAuthenticated'));
        setRows([]);
        return;
      }
      const res = await fetch('/api/admin/demo-requests', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = (await res.json().catch(() => ({}))) as {
        requests?: unknown;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setRows([]);
        return;
      }
      setRows(Array.isArray(body.requests) ? (body.requests as DemoRequestRow[]) : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tCommon]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-h-screen w-full bg-[var(--color-surface-0)]"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <AdminHeader />
      <AdminSidebar activeRoute={pathname ?? undefined} />
      <main className="flex-1 min-w-0 p-4 md:p-6 overflow-auto lg:ms-56 flex flex-col">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
            {tAdmin('demoRequestsTitle')}
          </h1>
          <button
            type="button"
            onClick={() => void loadRequests()}
            className="px-3 py-1.5 rounded-lg text-sm border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors"
          >
            {tAdmin('retry')}
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive px-4 py-3 mb-3 text-sm">
            {error}
          </div>
        ) : null}

        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                  <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                    {tCommon('name')}
                  </th>
                  <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                    {tCommon('phone')}
                  </th>
                  <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">
                    {tAdmin('email')}
                  </th>
                  <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider hidden md:table-cell">
                    {tAdmin('center')}
                  </th>
                  <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                    {tCommon('status')}
                  </th>
                  <th className="text-start py-3 px-4 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
                    {tAdmin('createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-[var(--color-text-secondary)]">
                      {tCommon('loading')}
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-[var(--color-text-secondary)]">
                      {tAdmin('demoRequestsEmpty')}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="hover:bg-[var(--color-surface-0)] transition-colors">
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-primary)] font-medium">
                        {r.name}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">
                        {r.phone ? normalizePhone(r.phone) : tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                        {r.email ?? tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)] hidden md:table-cell">
                        {r.center_name ?? tCommon('notSet')}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            STATUS_STYLES[r.status] ?? 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]'
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-sm text-[var(--color-text-secondary)]">
                        {r.created_at ? formatDate(r.created_at, locale) : tCommon('notSet')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
