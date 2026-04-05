'use client';

import { useState, useCallback, useId, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { MessageCircle, Send, X, Loader2 } from 'lucide-react';

interface QueryResponse {
  answer_ar: string;
  rows: Record<string, unknown>[];
  row_count: number;
  explanation_ar: string;
}

type ChatLine =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; rows?: Record<string, unknown>[] };

export default function AnalyticsAiChatWidget() {
  const ta = useTranslations('analytics');
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);

  const suggested = useMemo(() => {
    const raw = ta.raw('aiChat.suggested');
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [ta]);

  const submit = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    const userLine: ChatLine = { id: `u-${Date.now()}`, role: 'user', text: q };
    setMessages((prev) => [...prev, userLine]);
    setInput('');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setError(ta('aiChat_loginRequired'));
        setLoading(false);
        return;
      }

      const res = await fetch('/api/ai/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ question: q }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(
          typeof json?.message === 'string' ? json.message : ta('aiChat_errorGeneric')
        );
        setLoading(false);
        return;
      }

      const result = json as QueryResponse;
      const assistantLine: ChatLine = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: result.answer_ar,
        rows: result.rows?.length ? result.rows : undefined,
      };
      setMessages((prev) => [...prev, assistantLine]);
    } catch {
      setError(ta('aiChat_errorGeneric'));
    } finally {
      setLoading(false);
    }
  }, [input, loading, ta]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="no-print fixed z-[60] bottom-0 inset-x-0 md:bottom-6 md:inset-x-auto md:end-6 flex flex-col items-stretch md:items-end pointer-events-none">
      {open && (
        <div
          className="pointer-events-auto mb-3 mx-4 md:mx-0 w-[min(100%,360px)] max-h-[min(70vh,480px)] flex flex-col rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg card-shadow ms-auto me-4 md:me-0 overflow-hidden"
          role="dialog"
          id={`${formId}-panel`}
          aria-labelledby={`${formId}-label`}
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
            <p id={`${formId}-label`} className="text-sm font-semibold text-slate-800 dark:text-white">
              {ta('aiChat_title')}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/80 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
              aria-label={ta('aiChat_close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && !loading && (
              <p className="text-xs text-slate-500 dark:text-slate-400 px-1">{ta('aiChat_emptyHint')}</p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700/80 text-slate-800 dark:text-slate-100 font-cairo text-start'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  {m.role === 'assistant' && m.rows && m.rows.length > 0 && (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-600">
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/80">
                            {Object.keys(m.rows[0]).map((col) => (
                              <th key={col} className="px-2 py-1.5 text-start font-semibold">
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {m.rows.slice(0, 8).map((row, i) => (
                            <tr key={i} className="border-b border-slate-100 dark:border-slate-700/80 last:border-0">
                              {Object.keys(m.rows![0]).map((col) => (
                                <td key={col} className="px-2 py-1.5 text-start">
                                  {String((row as Record<string, unknown>)[col] ?? '-')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 px-1">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                {ta('aiChat_loading')}
              </div>
            )}
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 px-1" role="alert">
                {error}
              </p>
            )}
          </div>

          {suggested.length > 0 && messages.length === 0 && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {suggested.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="text-xs rounded-full border border-slate-200 dark:border-slate-600 px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors font-cairo"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="p-3 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={ta('aiChat_placeholder')}
                disabled={loading}
                className="flex-1 min-w-0 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/50 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 font-cairo"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="shrink-0 flex items-center justify-center w-10 h-10 rounded-xl bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label={ta('aiChat_send')}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 text-center">{ta('aiChat_beta')}</p>
          </form>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setError(null);
        }}
        className={`pointer-events-auto ms-auto me-4 md:me-0 mb-[max(1rem,env(safe-area-inset-bottom))] md:mb-0 flex items-center gap-2 rounded-full bg-teal-600 text-white px-4 py-3 shadow-lg teal-glow btn-lift ${
          open ? 'md:ring-2 md:ring-teal-400/40' : ''
        }`}
        aria-expanded={open}
        aria-controls={`${formId}-panel`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
          <MessageCircle className="w-5 h-5" />
        </span>
        <span className="text-sm font-semibold pe-1 max-md:sr-only">{ta('aiChat_fabLabel')}</span>
      </button>
    </div>
  );
}
