'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ChevronDown, ChevronUp, Send } from 'lucide-react';

const SUGGESTED = [
  'كام طالب حضر الأسبوع ده؟',
  'إيه أعلى مجموعة في الإيرادات؟',
  'مين الطلاب اللي عندهم رصيد متأخر؟',
  'كام مدفوعات اتسجلت النهارده؟',
];

interface QueryResponse {
  answer_ar: string;
  rows: Record<string, unknown>[];
  row_count: number;
  explanation_ar: string;
}

export default function NaturalQueryBox() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [expanded, setExpanded] = useState(true);

  const submit = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('يجب تسجيل الدخول');
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
        setError(json?.message ?? json?.error ?? 'تعذر فهم السؤال — حاول بطريقة مختلفة');
        return;
      }

      setResult(json as QueryResponse);
    } catch {
      setError('تعذر فهم السؤال — حاول بطريقة مختلفة');
    } finally {
      setLoading(false);
    }
  }, [question, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const columns = result && result.rows.length > 0
    ? Object.keys(result.rows[0] as Record<string, unknown>)
    : [];

  return (
    <div className="rounded-lg border bg-[var(--color-surface-1)] overflow-hidden" dir="rtl">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between gap-2 p-4 text-right hover:bg-muted/50 transition-colors"
      >
        <span className="font-semibold text-lg">اسأل عن سنترك بالعربي 🤖</span>
        {expanded ? (
          <ChevronDown className="h-5 w-5 shrink-0" />
        ) : (
          <ChevronUp className="h-5 w-5 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="p-4 pt-0 space-y-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اسأل عن سنترك... مثال: كام طالب حضر الأسبوع ده؟"
              className="flex-1 rounded-lg border bg-[var(--color-surface-0)] px-4 py-2.5 font-cairo text-base placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={loading}
            />
            <button
              type="button"
              onClick={submit}
              disabled={loading || !question.trim()}
              className="rounded-lg bg-primary px-4 py-2.5 text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="font-cairo">جاري البحث...</span>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuestion(s)}
                className="rounded-full border bg-muted/30 px-3 py-1.5 text-sm font-cairo hover:bg-muted/60 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {loading && (
            <p className="font-cairo text-[var(--color-text-secondary)] animate-pulse">
              <span className="inline-block animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
              <span className="inline-block animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
              <span className="inline-block animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
              {' '}جاري البحث...
            </p>
          )}

          {error && (
            <p className="font-cairo text-destructive">{error}</p>
          )}

          {result && !loading && (
            <div className="space-y-3">
              <p
                className="font-cairo text-lg text-teal-600 dark:text-teal-400"
                style={{ fontSize: '18px' }}
              >
                {result.answer_ar}
              </p>

              {result.rows.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm font-cairo">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        {columns.map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2 text-right font-semibold"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          {columns.map((col) => (
                            <td key={col} className="px-4 py-2 text-right">
                              {String((row as Record<string, unknown>)[col] ?? '—')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
