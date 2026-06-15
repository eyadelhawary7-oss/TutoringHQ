'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatDate } from '@/lib/formatNumber';
import TeacherJoinRequests from '@/components/settings/TeacherJoinRequests';

type Outgoing = {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  teacherName: string | null;
  createdAt: string;
};

const ERROR_KEY: Record<string, string> = {
  TEACHER_CODE_NOT_FOUND: 'errorCodeNotFound',
  ALREADY_A_MEMBER: 'errorAlreadyMember',
  REQUEST_ALREADY_PENDING: 'errorAlreadyPending',
  INVALID_INPUT: 'errorCodeRequired',
};

const STATUS_KEY: Record<Outgoing['status'], string> = {
  pending: 'statusPending',
  accepted: 'statusAccepted',
  declined: 'statusDeclined',
  withdrawn: 'statusWithdrawn',
};

const STATUS_CLASS: Record<Outgoing['status'], string> = {
  pending: 'bg-teal-100 text-teal-800',
  accepted: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-red-100 text-red-700',
  withdrawn: 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]',
};

/**
 * "Add teacher" panel: the owner types a teacher's dedicated code to send a
 * link request (the teacher confirms - linking stays two-sided), sees their
 * outgoing requests, and (via the reused TeacherJoinRequests block) accepts
 * teacher-initiated incoming requests too. One linking hub.
 */
export default function AddTeacherPanel({ onChanged }: { onChanged?: () => void }) {
  const t = useTranslations('teachersSection');
  const locale = useLocale();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);

  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadOutgoing = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/center/teacher-links', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { requests: Outgoing[] };
      setOutgoing(json.requests ?? []);
    } catch {
      // Non-fatal.
    }
  }, []);

  useEffect(() => {
    loadOutgoing();
  }, [loadOutgoing]);

  const submit = async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setErrorKey(null);
    setSuccessName(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/center/teacher-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ code: code.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: string; teacherName?: string | null };
      if (!res.ok) {
        setErrorKey(ERROR_KEY[json.code ?? ''] ?? 'errorGeneric');
        return;
      }
      setSuccessName(json.teacherName ?? '');
      setCode('');
      loadOutgoing();
      onChanged?.();
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setSubmitting(false);
    }
  };

  const withdraw = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/center/teacher-links/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
      });
      if (res.ok) loadOutgoing();
    } catch {
      // Non-fatal.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Incoming teacher-initiated join requests (reused settings block). */}
      <TeacherJoinRequests />

      {/* Add by code. */}
      <section className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
          <UserPlus className="h-5 w-5 text-[var(--color-teal-deep)]" aria-hidden />
          {t('addTitle')}
        </h2>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('addHint')}</p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('codeLabel')}
            </label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={32}
              placeholder={t('codePlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-3 py-2 font-mono text-sm uppercase text-[var(--color-text-primary)]"
              dir="ltr"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !code.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? t('adding') : t('addButton')}
          </button>
        </div>

        {errorKey && (
          <p className="mt-3 text-sm text-[var(--color-danger)]" role="alert">
            {t(errorKey)}
          </p>
        )}
        {successName !== null && (
          <p className="mt-3 text-sm text-emerald-700" role="status">
            {t('addSuccess', { teacher: successName || t('theTeacher') })}
          </p>
        )}

        {/* Outgoing requests the owner started. */}
        {outgoing.length > 0 && (
          <div className="mt-5 border-t border-[var(--color-border-subtle)] pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('outgoingHeading')}
            </p>
            <ul className="flex flex-col gap-2">
              {outgoing.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {r.teacherName ?? '—'}
                    </span>
                    <span className="block text-xs text-[var(--color-text-muted)]">
                      {formatDate(r.createdAt, locale)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[r.status]}`}>
                      {t(STATUS_KEY[r.status])}
                    </span>
                    {r.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => withdraw(r.id)}
                        disabled={busyId === r.id}
                        className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline disabled:opacity-50"
                      >
                        {t('withdraw')}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
