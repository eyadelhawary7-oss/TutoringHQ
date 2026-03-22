'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronUp, Send, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AtRiskStudent } from '@/app/api/students/at-risk/route';

export function AtRiskPanel() {
  const t = useTranslations('students');
  const [students, setStudents] = useState<AtRiskStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);

  const loadAtRisk = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setLoading(true);
    try {
      const res = await fetch('/api/students/at-risk', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setStudents(data?.students ?? []);
    } catch {
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAtRisk();
  }, [loadAtRisk]);

  const handleSendReminder = async (s: AtRiskStudent) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !s.parent_phone) return;

    setSendingId(s.id);
    try {
      const res = await fetch('/api/whatsapp/send-balance-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ student_id: s.id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? 'Failed');
      }
      await loadAtRisk();
    } catch {
      // Silent fail or toast
    } finally {
      setSendingId(null);
    }
  };

  const handleChangeStatus = async (s: AtRiskStudent, newStatus: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setChangingId(s.id);
    try {
      const res = await fetch('/api/students/lifecycle', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ student_id: s.id, lifecycle_status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed');
      await loadAtRisk();
    } catch {
      // Silent fail
    } finally {
      setChangingId(null);
    }
  };

  if (loading && students.length === 0) return null;
  if (students.length === 0) return null;

  const severity = (s: AtRiskStudent) => {
    if (s.lifecycle_status === 'inactive' || s.days_since_last_scan >= 30) return 'red';
    if (s.days_since_last_scan >= 14) return 'amber';
    return 'amber';
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 overflow-hidden mb-6">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-100/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-amber-600 shrink-0" />
          <span className="font-semibold text-amber-900">
            {t('atRiskPanelTitle', { count: students.length, defaultValue: `معرضون للخطر (${students.length})` })}
          </span>
        </div>
        {expanded ? <ChevronUp size={18} className="text-amber-600" /> : <ChevronDown size={18} className="text-amber-600" />}
      </button>

      {expanded && (
        <div className="border-t border-amber-200 p-4 space-y-3">
          {students.map((s) => {
            const sev = severity(s);
            const bg = sev === 'red' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200';
            return (
              <div
                key={s.id}
                className={`rounded-lg border p-3 ${bg}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-[var(--color-text-primary)]">{s.name}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                      {t('daysSinceLastScan', { days: s.days_since_last_scan, defaultValue: `${s.days_since_last_scan} يوم منذ آخر مسح` })}
                      {s.at_risk_since && (
                        <span className="ms-2">
                          • {t('atRiskSince', { defaultValue: 'معرض منذ' })} {new Date(s.at_risk_since).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </p>
                    <p className="text-sm font-mono text-[var(--color-text-secondary)] mt-1">
                      {t('balance', { defaultValue: 'المستحق' })}: {s.balance_due.toLocaleString('ar-EG')} ج.م
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.parent_phone && (
                      <button
                        type="button"
                        onClick={() => handleSendReminder(s)}
                        disabled={!!sendingId}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-teal-100 text-teal-700 hover:bg-teal-200 disabled:opacity-50 transition-colors"
                      >
                        {sendingId === s.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        {t('sendReminderToParent', { defaultValue: 'إرسال تذكير للولي' })}
                      </button>
                    )}
                    <select
                      value={s.lifecycle_status}
                      onChange={(e) => handleChangeStatus(s, e.target.value)}
                      disabled={!!changingId}
                      className="text-xs rounded-lg border border-slate-300 bg-[var(--color-surface-1)] px-2 py-1.5 text-[var(--color-text-primary)] disabled:opacity-50"
                    >
                      <option value="at_risk">{t('lifecycleAtRisk', { defaultValue: 'معرض للخطر' })}</option>
                      <option value="active">{t('lifecycleActive', { defaultValue: 'نشط' })}</option>
                      <option value="inactive">{t('lifecycleInactive', { defaultValue: 'غير نشط' })}</option>
                      <option value="churned">{t('lifecycleChurned', { defaultValue: 'منسحب' })}</option>
                      <option value="enrolled">{t('lifecycleEnrolled', { defaultValue: 'مسجل' })}</option>
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
