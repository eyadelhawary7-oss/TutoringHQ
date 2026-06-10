'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';

/**
 * Teacher profile settings. A thin form over PATCH /api/teacher/profile (the
 * already-tested route). The (portal) layout gates auth server-side and wraps
 * this in the TeacherShell, so there is no auth boilerplate here - we only need
 * the access token to call the Bearer-scoped API. Prefill comes from
 * GET /api/teacher/profile (own row only). Cream tokens, RTL logical props.
 *
 * Note: grade_levels is not editable here - teacher_profiles has no such column
 * and the PATCH route does not accept it. Adding it would need a migration plus
 * an API change; deferred.
 */
export default function TeacherSettingsPage() {
  const t = useTranslations('teacherSettings');
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [subject, setSubject] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace('/login');
      return null;
    }
    return fetch(path, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${session.access_token}`,
      },
    });
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await authedFetch('/api/teacher/profile');
      if (!res) return;
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = (await res.json()) as { displayName?: string | null; subject?: string | null };
      setDisplayName(data.displayName ?? '');
      setSubject(data.subject ?? '');
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [authedFetch, router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    if (displayName.trim().length < 2) {
      setError(t('errorName'));
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch('/api/teacher/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          subject: subject.trim() ? subject.trim() : null,
        }),
      });
      if (!res) return;
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setError(t('errorGeneric'));
        return;
      }
      setSaved(true);
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
        <div className="h-44 animate-pulse rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-8 text-center shadow-card">
        <h2 className="mb-2 text-lg font-bold text-[var(--color-text-primary)]">{t('errorTitle')}</h2>
        <p className="mb-6 text-sm text-[var(--color-text-secondary)]">{t('errorBody')}</p>
        <button
          onClick={load}
          className="rounded-lg bg-teal-600 px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-teal-700"
        >
          {t('retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>
      </div>

      <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6 shadow-card">
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('nameLabel')}
            </label>
            <input
              type="text"
              value={displayName}
              maxLength={120}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSaved(false);
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-primary)]">
              {t('subjectLabel')}
            </label>
            <input
              type="text"
              value={subject}
              maxLength={80}
              onChange={(e) => {
                setSubject(e.target.value);
                setSaved(false);
              }}
              placeholder={t('subjectPlaceholder')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-3)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-teal-500 focus:ring-2 focus:ring-teal-500"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[var(--color-danger-muted)] bg-[var(--color-danger-muted)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          )}
          {saved && (
            <div className="rounded-lg border border-[var(--color-teal)]/30 bg-[var(--color-teal-soft)] p-3 text-sm text-[var(--color-teal-deep)]">
              {t('saved')}
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-primary-foreground transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
