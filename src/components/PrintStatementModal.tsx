'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  StudentBalanceStatement,
  type StudentBalanceStatementProps,
} from './StudentBalanceStatement';
import { supabase } from '@/lib/supabase';
import { Loader2, Printer, X } from 'lucide-react';

interface PrintStatementModalProps {
  studentId: string;
  studentName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function PrintStatementModal({
  studentId,
  studentName,
  isOpen,
  onClose,
}: PrintStatementModalProps) {
  const [dateFrom, setDateFrom] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  });

  const [dateTo, setDateTo] = useState<string>(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [statementData, setStatementData] = useState<null | {
    student: StudentBalanceStatementProps['student'];
    payments: StudentBalanceStatementProps['payments'];
    centerName: string;
    centerLogo: string | null;
  }>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  async function loadData() {
    setIsLoading(true);
    setStatementData(null);
    setLoadError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const meRes = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();
      const centerId = meData?.user?.center_id;
      if (!centerId) throw new Error('No center');

      const centerName = meData?.user?.center?.name ?? 'Center';
      const centerLogo = meData?.user?.center?.logo_url ?? null;

      const { data: student, error: studentErr } = await supabase
        .from('students')
        .select('id, name, student_number, phone, balance_due')
        .eq('id', studentId)
        .eq('center_id', centerId)
        .maybeSingle();

      if (studentErr) throw studentErr;
      if (!student) throw new Error('Student not found');

      const { data: members } = await supabase
        .from('student_group_members')
        .select('group_id')
        .eq('student_id', studentId);

      const groupIds = [...new Set((members || []).map((m) => m.group_id).filter(Boolean))];
      let groupNames: string[] = [];
      if (groupIds.length > 0) {
        const { data: grps } = await supabase
          .from('student_groups')
          .select('name')
          .in('id', groupIds);
        groupNames = (grps || []).map((g) => g.name ?? '').filter(Boolean);
      }

      const dateToEndOfDay = dateTo + 'T23:59:59.999Z';

      const { data: rawPayments } = await supabase
        .from('payments')
        .select('paid_at, amount, method, status, recorded_by')
        .eq('student_id', studentId)
        .gte('paid_at', dateFrom)
        .lte('paid_at', dateToEndOfDay)
        .order('paid_at', { ascending: false });

      const uniqueIds = [
        ...new Set(
          (rawPayments || [])
            .map((p) => p.recorded_by)
            .filter((id): id is string => id !== null && id !== undefined)
        ),
      ];

      const nameMap: Record<string, string> = {};
      if (uniqueIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, phone')
          .in('id', uniqueIds);
        for (const u of users || []) {
          nameMap[u.id] = (u as { id: string; phone?: string }).phone ?? '-';
        }
      }

      const payments = (rawPayments || []).map((p) => ({
        paid_at: p.paid_at,
        amount: Number(p.amount ?? 0),
        method: p.method ?? '-',
        status: (p.status === 'confirmed' || p.status === 'pending' ? p.status : 'pending') as 'confirmed' | 'pending',
        recorded_by_name: p.recorded_by ? (nameMap[p.recorded_by] ?? null) : null,
      }));

      setStatementData({
        student: {
          name: student.name ?? '',
          student_number: student.student_number ?? '',
          phone: student.phone ?? '',
          groups: groupNames,
          balance_due: Number(student.balance_due ?? 0),
        },
        payments,
        centerName,
        centerLogo,
      });
    } catch (err) {
      console.error('Statement load failed:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={onClose}
      >
        <div
          className="modal-spring-in bg-[var(--color-surface-1)] rounded-2xl border border-border p-6 max-w-lg mx-4 w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-[var(--color-text-primary)]">
              طباعة كشف الحساب - {studentName}
            </h3>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-muted"
            >
              <X size={18} className="text-[var(--color-text-secondary)]" />
            </button>
          </div>

          <div className="flex flex-wrap gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              من
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setStatementData(null);
                }}
                className="px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
              إلى
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setStatementData(null);
                }}
                className="px-3 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-sm"
              />
            </label>
          </div>

          {loadError && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
              {loadError}
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={loadData}
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  جاري تحميل البيانات...
                </>
              ) : (
                'تحميل البيانات'
              )}
            </button>
            <button
              onClick={() => window.print()}
              disabled={statementData === null}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted disabled:opacity-50"
            >
              <Printer size={14} /> طباعة
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted"
            >
              إغلاق
            </button>
          </div>

          {statementData !== null && (
            <div className="max-h-96 overflow-y-auto border rounded-lg mt-4">
              <StudentBalanceStatement
                {...statementData}
                dateFrom={dateFrom}
                dateTo={dateTo}
              />
            </div>
          )}

          <p className="text-xs text-slate-400 mt-2">
            سيتم طباعة كشف الحساب فقط عند الضغط على طباعة
          </p>
        </div>
      </div>

      {mounted &&
        statementData !== null &&
        createPortal(
          <div className="balance-statement-print-wrapper">
            <style>{`
              @media screen {
                .balance-statement-print-wrapper {
                  display: none;
                }
              }
              @media print {
                body {
                  visibility: hidden;
                }
                .balance-statement-print-wrapper {
                  display: block !important;
                  visibility: visible;
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: auto;
                }
              }
            `}</style>
            <StudentBalanceStatement
              {...statementData}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          </div>,
          document.body
        )}
    </>
  );
}
