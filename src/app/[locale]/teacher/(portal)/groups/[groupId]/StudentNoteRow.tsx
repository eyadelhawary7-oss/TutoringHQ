'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown, Loader2, Lock, NotebookPen } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { formatDate } from '@/lib/formatNumber';

const SAVE_DEBOUNCE_MS = 800;
const MAX_NOTE_LEN = 2000;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

async function authHeader(): Promise<Record<string, string> | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

/**
 * Per-student private note (one per student+group, Pro-only). Collapsed by
 * default; the note is fetched lazily on first expand. Pro teachers get a
 * debounced autosave textarea (800ms, mirroring the live-attendance pattern);
 * Standard teachers get the locked brass upgrade row, mirroring the
 * guest-attendee Pro gate. Guests never reach here (they carry no enrollment,
 * so they are absent from the active roster this row is rendered from).
 */
export default function StudentNoteRow({
  groupId,
  studentId,
  isPro,
}: {
  groupId: string;
  studentId: string;
  isPro: boolean;
}) {
  const t = useTranslations('teacherPortal.notes');
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  // True only after a real keystroke, so the lazy load never triggers a save.
  const userEditedRef = useRef(false);

  const notePath = `/api/teacher/private/groups/${groupId}/students/${studentId}/note`;

  // Lazy load on first expand (Pro only).
  useEffect(() => {
    if (!open || !isPro || loaded) return;
    let stale = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const headers = await authHeader();
        if (!headers) {
          if (!stale) setLoadError(true);
          return;
        }
        const res = await fetch(notePath, { headers });
        if (!res.ok) {
          if (!stale) setLoadError(true);
          return;
        }
        const data = (await res.json()) as { note?: string; updated_at?: string | null };
        if (stale) return;
        setNote(data.note ?? '');
        setUpdatedAt(data.updated_at ?? null);
        setLoaded(true);
      } catch {
        if (!stale) setLoadError(true);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [open, isPro, loaded, notePath]);

  // Debounced autosave after a real edit.
  useEffect(() => {
    if (!open || !isPro || !userEditedRef.current) return;
    const handle = setTimeout(() => {
      void save();
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note]);

  const save = async () => {
    setSaveState('saving');
    try {
      const headers = await authHeader();
      if (!headers) {
        setSaveState('error');
        return;
      }
      const res = await fetch(notePath, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) {
        setSaveState('error');
        return;
      }
      const data = (await res.json()) as { note?: string; updated_at?: string | null };
      setUpdatedAt(data.updated_at ?? null);
      userEditedRef.current = false;
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const onChange = (value: string) => {
    userEditedRef.current = true;
    setSaveState('idle');
    setNote(value);
  };

  return (
    <div className="border-t border-[var(--color-border-subtle)] pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <NotebookPen size={14} aria-hidden />
        {t('toggle')}
        <ChevronDown
          size={14}
          aria-hidden
          className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
        />
      </button>

      {open && (
        <div className="mt-2">
          {!isPro ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                <Lock size={14} className="text-[var(--color-brass)]" aria-hidden />
                {t('proOnly')}
              </span>
              <Link
                href="/teacher/pricing"
                className="text-sm font-medium text-[var(--color-brass)] hover:underline"
              >
                {t('upgradeCta')}
              </Link>
            </div>
          ) : loading ? (
            <div className="h-20 animate-pulse rounded-lg bg-[var(--color-surface-2)]" />
          ) : loadError ? (
            <p className="text-sm text-[var(--color-danger)]" role="alert">
              {t('error')}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={note}
                onChange={(e) => onChange(e.target.value)}
                maxLength={MAX_NOTE_LEN}
                rows={3}
                dir="auto"
                placeholder={t('placeholder')}
                className="w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 text-start text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-teal)] focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--color-text-muted)]">
                  {updatedAt ? t('lastSaved', { date: formatDate(updatedAt, locale, 'short') }) : ''}
                </span>
                {saveState === 'saving' ? (
                  <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    {t('saving')}
                  </span>
                ) : saveState === 'saved' ? (
                  <span className="text-xs text-[var(--color-teal-deep)]">{t('saved')}</span>
                ) : saveState === 'error' ? (
                  <span className="text-xs text-[var(--color-danger)]" role="alert">
                    {t('error')}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
