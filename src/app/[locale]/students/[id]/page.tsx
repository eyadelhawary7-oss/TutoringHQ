'use client';

import { useEffect, useState, use } from 'react';
import { useRouter, Link } from '@/i18n/routing';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useToast } from '@/components/ui/ToastProvider';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { pushRecentlyViewedStudent } from '@/lib/recentlyViewedStudents';
import { formatDateTime } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';

type StudentRow = { id: string; name: string; student_number?: string | null };

interface ScanRecord {
  id: string;
  scanned_at: string;
  group_id?: string | null;
  payment_status_at_scan?: string | null;
  payment_method?: string | null;
  payment_recorded?: boolean;
}

function deriveResultBadge(scan: ScanRecord, t: (k: string) => string): { label: string; cls: string } {
  if (scan.payment_status_at_scan === 'paid') {
    return { label: t('resultPaid'), cls: 'bg-green-100 text-green-700' };
  }
  if (scan.payment_recorded && scan.payment_method) {
    const digital = ['instapay', 'vodacash', 'vodafone_cash', 'orange', 'orange_cash', 'fawry', 'bank', 'bank_transfer'];
    if (digital.includes(String(scan.payment_method).toLowerCase())) {
      return { label: t('resultPending'), cls: 'bg-purple-100 text-purple-700' };
    }
    return { label: t('resultPaid'), cls: 'bg-green-100 text-green-700' };
  }
  return { label: t('resultUnpaid'), cls: 'bg-yellow-100 text-yellow-700' };
}

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const locale = useLocale();
  const tCart = useTranslations('cart');
  const tDetail = useTranslations('cart.studentDetail');
  const tToast = useTranslations('toasts');
  const ts = useTranslations('students');
  const tAtt = useTranslations('attendance');
  const tCommon = useTranslations('common');
  const { toast } = useToast();
  const { addItem, isStudentInCart } = useCardOrderCart();

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [delivered, setDelivered] = useState(false);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [groupNameMap, setGroupNameMap] = useState<Record<string, string>>({});
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const meData = await meRes.json();
        const cid = meData?.user?.center_id as string | undefined;
        if (!cid) return;

        const sel = await dbSelect({
          table: 'students',
          select: 'id, name, student_number',
          filters: [
            { column: 'id', op: 'eq', value: id },
            { column: 'center_id', op: 'eq', value: cid },
          ],
        });
        const row =
          Array.isArray(sel.data) && sel.data[0]
            ? ({
                id: String((sel.data[0] as Record<string, unknown>).id),
                name: String((sel.data[0] as Record<string, unknown>).name ?? ''),
                student_number: (sel.data[0] as Record<string, unknown>).student_number as string | null | undefined,
              } satisfies StudentRow)
            : null;
        if (cancelled) return;
        setStudent(row);

        if (row && cid) {
          pushRecentlyViewedStudent(cid, { id: row.id, name: row.name });
        }

        // Per-student attendance history (folded in from the former standalone
        // Attendance page — reads the same attendance_scans source).
        if (row) {
          setAttendanceLoading(true);
          const [scansSel, groupsSel] = await Promise.all([
            dbSelect({
              table: 'attendance_scans',
              select: 'id, scanned_at, group_id, payment_status_at_scan, payment_method, payment_recorded',
              filters: [
                { column: 'center_id', op: 'eq', value: cid },
                { column: 'student_id', op: 'eq', value: row.id },
              ],
              order: { column: 'scanned_at', ascending: false },
            }),
            dbSelect({
              table: 'student_groups',
              select: 'id, name',
              filters: [{ column: 'center_id', op: 'eq', value: cid }],
            }),
          ]);
          if (!cancelled) {
            setScans((scansSel.data || []) as ScanRecord[]);
            const groups = (groupsSel.data || []) as { id: string; name: string }[];
            setGroupNameMap(Object.fromEntries(groups.map((g) => [g.id, g.name])));
            setAttendanceLoading(false);
          }
        }

        if (row && session.access_token) {
          const stRes = await fetch('/api/card-order-cart/student-card-status', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: [row.id] }),
          });
          if (stRes.ok && !cancelled) {
            const j = (await stRes.json()) as { statusByStudentId?: Record<string, string> };
            setDelivered(j.statusByStudentId?.[row.id] === 'delivered');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onOrderCard = async () => {
    if (!student || delivered || isStudentInCart(student.id)) return;
    try {
      await addItem({ kind: 'student', student_id: student.id });
      toast.success(tCart('toast.added'), tCart('toast.viewCart'));
    } catch {
      toast.error(tToast('error'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-0)]">
        <p className="text-sm text-[var(--color-text-secondary)]">{ts('loading')}</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen px-4 py-8 max-w-lg mx-auto">
        <button type="button" className="text-sm text-teal-600 mb-4 flex items-center gap-1" onClick={() => router.back()}>
          <ArrowLeft size={16} /> {tDetail('back')}
        </button>
        <p className="text-[var(--color-text-secondary)]">{tDetail('notFound')}</p>
      </div>
    );
  }

  const inCart = isStudentInCart(student.id);

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto bg-[var(--color-surface-0)] pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-8">
      <button type="button" className="text-sm text-teal-600 mb-6 flex items-center gap-1" onClick={() => router.back()}>
        <ArrowLeft size={16} /> {tDetail('back')}
      </button>
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{student.name}</h1>
      {student.student_number ? (
        <p className="text-sm font-mono text-[var(--color-text-tertiary)] mt-1" dir="ltr">
          <bdi>{formatStudentNumberForDisplay(student.student_number)}</bdi>
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-3">
        {!delivered ? (
          inCart ? (
            <div className="space-y-2">
              <button type="button" disabled className="w-full py-3 rounded-xl bg-[var(--color-surface-2)] text-sm font-semibold text-[var(--color-text-muted)]">
                {tDetail('inCart')}
              </button>
              <Link href="/orders" className="block text-center text-sm font-semibold text-teal-600 underline">
                {tCart('toast.viewCart')}
              </Link>
            </div>
          ) : (
            <button
              type="button"
              className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
              onClick={() => void onOrderCard()}
            >
              {tDetail('orderCard')}
            </button>
          )
        ) : null}
      </div>

      {/* Attendance history (per-student) */}
      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)] mb-3">
          <ClipboardList size={16} className="text-teal-600" /> {tAtt('history')}
        </h2>
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] overflow-hidden">
          {attendanceLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-teal-500 border-t-transparent rounded-full" />
            </div>
          ) : scans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--color-text-secondary)] text-center">{tAtt('noDataInPeriod')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]">
                    <th className="text-start py-2.5 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{tAtt('dateTime')}</th>
                    <th className="text-start py-2.5 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{tAtt('group')}</th>
                    <th className="text-start py-2.5 px-4 text-xs font-semibold text-[var(--color-text-secondary)]">{tAtt('result')}</th>
                  </tr>
                </thead>
                <tbody>
                  {scans.map((sc) => {
                    const badge = deriveResultBadge(sc, tAtt);
                    const grp = sc.group_id ? groupNameMap[sc.group_id] : null;
                    return (
                      <tr key={sc.id} className="border-b border-[var(--color-border-subtle)] last:border-0">
                        <td className="py-2.5 px-4 text-[var(--color-text-secondary)] text-start" dir="ltr">
                          {sc.scanned_at
                            ? formatDateTime(sc.scanned_at, locale, { dateStyle: 'short', timeStyle: 'short' })
                            : tCommon('notSet')}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--color-text-secondary)] text-start">
                          {grp ?? tCommon('notAvailable')}
                        </td>
                        <td className="py-2.5 px-4 text-start">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
