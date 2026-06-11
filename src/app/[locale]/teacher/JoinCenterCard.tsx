'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { formatDate } from '@/lib/formatNumber';

type JoinRequest = {
  id: string;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  centerName: string | null;
};

const ERROR_KEY: Record<string, string> = {
  CENTER_NOT_FOUND: 'errorCenterNotFound',
  ALREADY_A_MEMBER: 'errorAlreadyMember',
  REQUEST_ALREADY_PENDING: 'errorPending',
};

/**
 * Teacher-initiated "join a center" card (FREE zone). A center-less teacher (or
 * any teacher) sends a join request by center code; the center owner approves.
 * Brass styling - this is a teacher-initiated action in the private/teacher
 * identity, distinct from the teal center-cut tracker above it.
 */
export default function JoinCenterCard() {
  const t = useTranslations('teacherPortal.joinCenter');
  const locale = useLocale();

  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [successCenter, setSuccessCenter] = useState<string | null>(null);

  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/teacher/center-requests', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const json = (await res.json()) as { requests: JoinRequest[] };
      setRequests(json.requests ?? []);
    } catch {
      // Non-fatal: the form still works without the history list.
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleSubmit = async () => {
    const trimmed = code.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setErrorKey(null);
    setSuccessCenter(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setErrorKey('errorGeneric');
        return;
      }
      const res = await fetch('/api/teacher/center-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ centerCode: trimmed, message: message.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        code?: string;
        centerName?: string | null;
      };
      if (!res.ok) {
        setErrorKey(ERROR_KEY[json.code ?? ''] ?? 'errorGeneric');
        return;
      }
      setSuccessCenter(json.centerName ?? trimmed);
      setCode('');
      setMessage('');
      loadRequests();
    } catch {
      setErrorKey('errorGeneric');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (id: string) => {
    if (withdrawingId) return;
    setWithdrawingId(id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`/api/teacher/center-requests/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
      });
      if (res.ok) {
        loadRequests();
      }
    } catch {
      // Non-fatal.
    } finally {
      setWithdrawingId(null);
    }
  };

  const statusLabel = (status: JoinRequest['status']) => {
    const map: Record<JoinRequest['status'], string> = {
      pending: 'statusPending',
      accepted: 'statusAccepted',
      declined: 'statusDeclined',
      withdrawn: 'statusWithdrawn',
    };
    return t(map[status]);
  };

  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--color-brass)]/40 bg-[var(--color-surface-1)] p-6">
      <h2 className="mb-1 flex items-center gap-2 text-lg font-bold text-[var(--color-text-primary)]">
        <Building2 size={18} className="text-[var(--color-brass)]" aria-hidden />
        {t('title')}
      </h2>
      <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>

      {successCenter ? (
        <div className="rounded-lg border border-[var(--color-brass)]/30 bg-[var(--color-brass-soft)] p-4 text-sm" style={{ color: 'var(--color-text-amber)' }}>
          {t('successTitle', { center: successCenter })}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="join-center-code" className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('codeLabel')}
            </label>
            <input
              id="join-center-code"
              type="text"
              value={code}
              maxLength={40}
              onChange={(e) => {
                setCode(e.target.value);
                setErrorKey(null);
              }}
              placeholder={t('codePlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-brass)] focus:ring-2 focus:ring-[var(--color-brass)]/30"
            />
          </div>
          <div>
            <label htmlFor="join-center-message" className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('messageLabel')}
            </label>
            <textarea
              id="join-center-message"
              value={message}
              maxLength={500}
              rows={2}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('messagePlaceholder')}
              className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-brass)] focus:ring-2 focus:ring-[var(--color-brass)]/30"
            />
          </div>
          {errorKey && (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {t(errorKey)}
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !code.trim()}
            className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-[var(--color-brass)] px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? t('submitting') : t('submit')}
          </button>
        </div>
      )}

      {requests.length > 0 && (
        <div className="mt-6 border-t border-[var(--color-border)] pt-4">
          <h3 className="mb-3 text-sm font-bold text-[var(--color-text-primary)]">{t('myRequestsTitle')}</h3>
          <ul className="flex flex-col gap-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {r.centerName ?? '-'}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {t('sentOn', { date: formatDate(r.createdAt, locale) })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                    {statusLabel(r.status)}
                  </span>
                  {r.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleWithdraw(r.id)}
                      disabled={withdrawingId === r.id}
                      className="text-xs font-semibold text-[var(--color-danger)] hover:underline disabled:opacity-50"
                    >
                      {withdrawingId === r.id ? t('withdrawing') : t('withdraw')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
