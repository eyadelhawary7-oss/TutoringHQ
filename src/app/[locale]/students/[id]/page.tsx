'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter, Link } from '@/i18n/routing';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbUpdate, dbInsert, dbDelete } from '@/lib/db-proxy';
import { getCsrfHeaders } from '@/lib/csrf-client';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useToast } from '@/components/ui/ToastProvider';
import { useUser } from '@/contexts/UserContext';
import { ArrowLeft, ClipboardList, CreditCard, MessageCircle, Pencil, Phone, X } from 'lucide-react';
import { KpiCard } from '@/components/shared';
import { FamilyLinkingSection } from '@/components/students/FamilyLinkingSection';
import { ReceiptModal } from '@/components/payments/ReceiptModal';
import { pushRecentlyViewedStudent } from '@/lib/recentlyViewedStudents';
import { formatDateTime, formatDate, formatNumber, formatCurrency } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { getStudentBalances } from '@/lib/studentBalance';
import { initialsOf } from '@/lib/initials';

type FamilyRow = { id: string; family_name: string | null; parent_phone: string | null; parent_name: string | null };

type StudentRow = {
  id: string;
  name: string;
  student_number?: string | null;
  phone?: string | null;
  parent_phone?: string | null;
  parent_pack_opted_in?: boolean | null;
  parent_consent_given?: boolean | null;
  sibling_family_id?: string | null;
  subject?: string | null;
  grade_level?: string | null;
};

type GroupRow = { id: string; name: string; subject: string | null; fee?: number };

type CollectMethod = 'cash' | 'instapay' | 'bank_transfer';

interface ScanRecord {
  id: string;
  scanned_at: string;
  group_id?: string | null;
  payment_status_at_scan?: string | null;
  payment_method?: string | null;
  payment_recorded?: boolean;
}

// Only plain columns that physically exist on the students table (the
// parent/sibling fields are the same ones the list page reads). NOTE: do NOT
// add `balance_due` here — that column is not present in the students schema,
// and selecting it makes PostgREST 400 the whole query, which surfaces as
// "student not found" for every student.
const STUDENT_SELECT =
  'id, name, student_number, phone, parent_phone, parent_pack_opted_in, parent_consent_given, sibling_family_id, subject, grade_level';

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

/** Digits, country-code-prefixed, no leading '+' - the wa.me / tel: contract used across the app. */
function intlDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `20${d.slice(1)}`;
  return `20${d}`;
}

// The list-page normalizer, copied verbatim so a typed parent phone is stored
// in the same +20 canonical form the rest of the app expects.
function normalizeParentPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('01')) return '+2' + digits;
  if (digits.length === 10 && digits.startsWith('1')) return '+2' + digits;
  if (phone.startsWith('+')) return phone;
  return digits.length >= 10 ? '+2' + digits.slice(-10) : phone;
}

function normalizeStudent(raw: Record<string, unknown>): StudentRow {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    student_number: (raw.student_number as string | null | undefined) ?? null,
    phone: (raw.phone as string | null | undefined) ?? null,
    parent_phone: (raw.parent_phone as string | null | undefined) ?? null,
    parent_pack_opted_in: raw.parent_pack_opted_in === true,
    parent_consent_given: raw.parent_consent_given === true,
    sibling_family_id: (raw.sibling_family_id as string | null | undefined) ?? null,
    subject: (raw.subject as string | null | undefined) ?? null,
    grade_level: (raw.grade_level as string | null | undefined) ?? null,
  };
}

// Resolve the linked family via the same GET /api/families the edit modal uses,
// so the display is guaranteed consistent with FamilyLinkingSection. No fetch at
// all when the student has no family linked.
async function fetchFamilyForStudent(siblingFamilyId: string | null, token: string): Promise<FamilyRow | null> {
  if (!siblingFamilyId) return null;
  try {
    const res = await fetch('/api/families', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const j = (await res.json()) as { families?: FamilyRow[] };
    return (j.families ?? []).find((f) => f.id === siblingFamilyId) ?? null;
  } catch {
    return null;
  }
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
  const tp = useTranslations('payments');
  const { toast } = useToast();
  const { user, hasPermission } = useUser();
  const { addItem, isStudentInCart } = useCardOrderCart();

  const [loading, setLoading] = useState(true);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentRow | null>(null);
  // Live-computed balance (Σ chargeable center-group scans − logged payments) via the
  // isomorphic getStudentBalances helper on the RLS-scoped browser client — the SAME
  // source the scanner and finance views use. There is deliberately NO students.balance_due
  // column (selecting it 400s the whole query); see STUDENT_SELECT below. null = not loaded.
  const [balance, setBalance] = useState<number | null>(null);
  // Lifetime paid (Σ logged payments, never negative/netted) - Merged-Center-Students
  // §02 "Lifetime paid X since date". Same balances helper, .paid instead of .balance.
  const [lifetimePaid, setLifetimePaid] = useState<number | null>(null);
  const [family, setFamily] = useState<FamilyRow | null>(null);
  const [delivered, setDelivered] = useState(false);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [groupNameMap, setGroupNameMap] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  // Collect Payment modal (student is fixed to this page's student).
  const [showCollect, setShowCollect] = useState(false);
  const [collectAmount, setCollectAmount] = useState('');
  const [collectMethod, setCollectMethod] = useState<CollectMethod>('cash');
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<
    { studentName: string; amount: number; method: string; methodLabel: string; paidAt: string } | null
  >(null);

  // Edit Student modal (mirrors the list-page edit fields).
  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editParentPhone, setEditParentPhone] = useState('');
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [editFamilyId, setEditFamilyId] = useState<string | null>(null);
  const [editParentPackOptIn, setEditParentPackOptIn] = useState(false);
  const [showParentSection, setShowParentSection] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const canCollect = hasPermission('can_record_payments') || hasPermission('can_view_payments');
  const canEdit = hasPermission('can_manage_students');
  const parentPackEnabled = user?.center?.parent_pack_enabled === true;

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
        if (cancelled) return;
        setCenterId(cid);

        const sel = await dbSelect({
          table: 'students',
          select: STUDENT_SELECT,
          filters: [
            { column: 'id', op: 'eq', value: id },
            { column: 'center_id', op: 'eq', value: cid },
          ],
        });
        const raw = Array.isArray(sel.data) && sel.data[0] ? (sel.data[0] as Record<string, unknown>) : null;
        const row = raw ? normalizeStudent(raw) : null;
        if (cancelled) return;
        setStudent(row);

        if (row) {
          // Read-only live balance + lifetime paid for the balance card. Best-effort:
          // a hiccup must never break the page (it just leaves the card unloaded).
          getStudentBalances(supabase, { studentIds: [row.id] })
            .then((map) => {
              if (cancelled) return;
              const b = map.get(row.id);
              setBalance(b?.balance ?? 0);
              setLifetimePaid(b?.paid ?? 0);
            })
            .catch((err) => console.error('[student-detail] balance load failed', err));
        }

        if (row && cid) {
          pushRecentlyViewedStudent(cid, { id: row.id, name: row.name });
        }

        if (row) {
          const fam = await fetchFamilyForStudent(row.sibling_family_id ?? null, session.access_token);
          if (!cancelled) setFamily(fam);
        }

        // Per-student attendance history + the center's groups (reused for the
        // attendance-row labels AND the edit modal's group checklist) + this
        // student's current group memberships (to prefill the edit modal).
        if (row) {
          setAttendanceLoading(true);
          const [scansSel, groupsSel, membersSel] = await Promise.all([
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
              select: 'id, name, subject, fee_per_class',
              filters: [{ column: 'center_id', op: 'eq', value: cid }],
              order: { column: 'name' },
            }),
            dbSelect({
              table: 'student_group_members',
              select: 'group_id',
              filters: [{ column: 'student_id', op: 'eq', value: row.id }],
            }),
          ]);
          if (!cancelled) {
            setScans((scansSel.data || []) as ScanRecord[]);
            const grps = (groupsSel.data || []) as GroupRow[];
            setGroups(grps);
            setGroupNameMap(Object.fromEntries(grps.map((g) => [g.id, g.name])));
            setMemberGroupIds(((membersSel.data || []) as { group_id: string }[]).map((m) => m.group_id));
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

  // Re-pull the student row (balance + name + linked family) after a collect or
  // an edit, so the stat row and family section reflect the change.
  const reloadStudent = useCallback(async () => {
    if (!centerId) return;
    // Self-contained: a refresh hiccup must never surface as a collect/edit
    // failure at the call sites (which await this inside their success path).
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const sel = await dbSelect({
        table: 'students',
        select: STUDENT_SELECT,
        filters: [
          { column: 'id', op: 'eq', value: id },
          { column: 'center_id', op: 'eq', value: centerId },
        ],
      });
      const raw = Array.isArray(sel.data) && sel.data[0] ? (sel.data[0] as Record<string, unknown>) : null;
      if (!raw) return;
      const row = normalizeStudent(raw);
      setStudent(row);
      const balanceMap = await getStudentBalances(supabase, { studentIds: [row.id] });
      const b = balanceMap.get(row.id);
      setBalance(b?.balance ?? 0);
      setLifetimePaid(b?.paid ?? 0);
      setFamily(await fetchFamilyForStudent(row.sibling_family_id ?? null, session.access_token));
    } catch (err) {
      console.error('[student-detail] reloadStudent failed', err);
    }
  }, [centerId, id]);

  const onOrderCard = async () => {
    if (!student || delivered || isStudentInCart(student.id)) return;
    try {
      await addItem({ kind: 'student', student_id: student.id });
      toast.success(tCart('toast.added'), tCart('toast.viewCart'));
    } catch {
      toast.error(tToast('error'));
    }
  };

  const methodLabel = (m: CollectMethod) =>
    tp(m === 'cash' ? 'method_cash' : m === 'instapay' ? 'method_instapay' : 'method_bank_transfer');

  // Opens the SAME server-gated flow used elsewhere (POST /api/payments/collect);
  // center_id is forced server-side, the student is already fixed to this page.
  const handleCollect = async () => {
    if (!student) return;
    const amount = Number.parseFloat(collectAmount.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tToast('error'), tCommon('error'));
      return;
    }
    setCollectSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        toast.error(tToast('error'), tCommon('error'));
        return;
      }
      const headers = await getCsrfHeaders(session.access_token);
      const res = await fetch('/api/payments/collect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...headers,
        },
        body: JSON.stringify({ student_id: student.id, amount, method: collectMethod, group_id: null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || tCommon('error'));
      const paidAt: string = typeof data?.paidAt === 'string' ? data.paidAt : new Date().toISOString();
      const wasCash = collectMethod === 'cash';
      const paidMethod = collectMethod;
      toast.success(tToast('saved'));
      setShowCollect(false);
      setCollectAmount('');
      setCollectMethod('cash');
      // Match the payments page: only cash produces an immediate receipt.
      if (wasCash) {
        setReceipt({
          studentName: student.name,
          amount,
          method: paidMethod,
          methodLabel: methodLabel(paidMethod),
          paidAt,
        });
      }
      await reloadStudent();
    } catch (err) {
      toast.error(tToast('error'), err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setCollectSubmitting(false);
    }
  };

  const openEdit = () => {
    if (!student) return;
    setEditName(student.name || '');
    setEditPhone(student.phone || '');
    setEditParentPhone(student.parent_phone || '');
    setEditGroups(memberGroupIds);
    setEditFamilyId(student.sibling_family_id ?? null);
    setEditParentPackOptIn(student.parent_pack_opted_in === true);
    setShowParentSection(false);
    setShowEdit(true);
  };

  // Same writes as the list-page saveEdit (dbUpdate students + rebuild
  // student_group_members + optional consent request); differs only in that it
  // re-fetches this page's student rather than mutating list-page roster state.
  const handleSaveEdit = async () => {
    if (!student || !centerId) return;
    setIsSavingEdit(true);
    try {
      const parentPhoneNorm = editParentPhone.trim() ? normalizeParentPhone(editParentPhone.trim()) : null;
      const consentAt = editParentPackOptIn ? new Date().toISOString() : null;
      await dbUpdate({
        table: 'students',
        data: {
          name: editName.trim(),
          phone: editPhone.trim() || null,
          parent_phone: parentPhoneNorm,
          sibling_family_id: editFamilyId,
          parent_pack_opted_in: editParentPackOptIn,
          parent_consent_given: editParentPackOptIn,
          parent_consent_at: consentAt,
        },
        filters: [{ column: 'id', op: 'eq', value: student.id }],
      });
      await dbDelete({
        table: 'student_group_members',
        filters: [{ column: 'student_id', op: 'eq', value: student.id }],
      });
      for (const gid of editGroups) {
        await dbInsert({ table: 'student_group_members', data: { student_id: student.id, group_id: gid }, select: false });
      }
      if (parentPhoneNorm) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          try {
            await fetch('/api/parents/request-consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ student_id: student.id, parent_phone: parentPhoneNorm }),
            });
          } catch {
            // Non-fatal: consent request is best-effort, same as the list page.
          }
        }
      }
      toast.success(tToast('saved'));
      setShowEdit(false);
      setMemberGroupIds(editGroups);
      await reloadStudent();
    } catch (err) {
      console.error('Edit student error:', err);
      toast.error(tToast('error'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-4 py-6 max-w-lg mx-auto bg-[var(--color-surface-0)]">
        <div className="mb-6 h-5 w-16 animate-pulse rounded bg-[var(--color-surface-2)]" />
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-[var(--color-surface-2)]" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-32 animate-pulse rounded bg-[var(--color-surface-2)]" />
            <div className="h-3.5 w-40 animate-pulse rounded bg-[var(--color-surface-2)]" />
          </div>
        </div>
        <div className="mt-6 h-20 animate-pulse rounded-md bg-[var(--color-surface-2)]" />
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-[var(--color-surface-2)]" />
          ))}
        </div>
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
  const visits = scans.length;
  const lastSeen = scans[0]?.scanned_at ?? null;

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto bg-[var(--color-surface-0)] pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-8">
      <button type="button" className="text-sm text-teal-600 mb-6 flex items-center gap-1" onClick={() => router.back()}>
        <ArrowLeft size={16} /> {tDetail('back')}
      </button>
      <div className="flex items-center gap-3">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-mint)] text-sm font-semibold text-[var(--color-accent-deep)]"
          aria-hidden
        >
          {initialsOf(student.name)}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-bold text-[var(--color-text-primary)]">{student.name}</h1>
            {/* Design (§02): a payment-standing badge beside the name. Same
                real-time balance the KPI card below reads - not a new figure. */}
            {balance !== null && (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  balance > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                }`}
              >
                {balance > 0 ? tDetail('overdue') : tDetail('paidUp')}
              </span>
            )}
          </div>
          {(student.subject || student.grade_level || student.phone) && (
            <p className="truncate text-sm text-[var(--color-text-secondary)]">
              {[
                student.subject,
                student.grade_level ? tDetail('gradeLabel', { grade: student.grade_level }) : null,
                student.phone,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </div>
      </div>
      {student.student_number ? (
        <p className="text-sm font-mono text-[var(--color-text-tertiary)] mt-1" dir="ltr">
          <bdi>{formatStudentNumberForDisplay(student.student_number)}</bdi>
        </p>
      ) : null}

      {/* 1. Balance leads (read-only, live-computed; positive = owed, negative = credit).
          Design (Merged-Center-Students §02): "live balance front and center". It sat
          below the visits / last-seen row, so the screen answered "how often do they
          come" before "do they owe". Same argument as the roster tiles in §01. */}
      {balance !== null && (
        <div className="mt-6">
          <KpiCard
            label={tDetail('balance')}
            value={
              <span
                className={`tabular-nums ${balance > 0 ? 'text-red-600' : balance < 0 ? 'text-green-600' : ''}`}
                dir="ltr"
              >
                {formatCurrency(balance, locale)}
              </span>
            }
          />
        </div>
      )}

      {/* 2. Stat row */}
      <div className={`${balance !== null ? 'mt-3' : 'mt-6'} grid grid-cols-3 gap-3`}>
        <KpiCard
          label={tDetail('visits')}
          value={<span className="tabular-nums">{formatNumber(visits, locale)}</span>}
        />
        <KpiCard label={tDetail('lastSeen')} value={lastSeen ? formatDate(lastSeen, locale, 'short') : '—'} />
        {lifetimePaid !== null && (
          <KpiCard
            label={tDetail('lifetimePaid')}
            value={<span className="tabular-nums" dir="ltr">{formatCurrency(lifetimePaid, locale)}</span>}
          />
        )}
      </div>

      {/* 2. Quick actions */}
      {(() => {
        const studentDigits = intlDigits(student.phone);
        return (canCollect || canEdit || studentDigits) && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {studentDigits && (
              <a
                href={`tel:+${studentDigits}`}
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
              >
                <Phone className="h-6 w-6 text-teal-500" aria-hidden />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{tDetail('callAction')}</span>
              </a>
            )}
            {studentDigits && (
              <a
                href={`https://wa.me/${studentDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
              >
                <MessageCircle className="h-6 w-6 text-teal-500" aria-hidden />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{tDetail('messageAction')}</span>
              </a>
            )}
            {canCollect && (
              <button
                type="button"
                onClick={() => setShowCollect(true)}
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
              >
                <CreditCard className="h-6 w-6 text-teal-500" aria-hidden />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{tp('collectPayment')}</span>
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={openEdit}
                className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-4 text-center shadow-sm transition-colors hover:bg-[var(--color-surface-2)] btn-press chq-focus"
              >
                <Pencil className="h-6 w-6 text-teal-500" aria-hidden />
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">{tCommon('edit')}</span>
              </button>
            )}
          </div>
        );
      })()}

      {/* 3. Parent / Family */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)] mb-3">{tDetail('family')}</h2>
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] p-4">
          {family ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {family.family_name || family.parent_name || tCommon('notAvailable')}
              </p>
              {family.parent_name && family.family_name ? (
                <p className="text-xs text-[var(--color-text-secondary)]">{family.parent_name}</p>
              ) : null}
              {family.parent_phone ? (
                <p className="text-xs font-mono text-[var(--color-text-tertiary)]" dir="ltr">
                  {family.parent_phone}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">{tDetail('noFamilyLinked')}</p>
          )}
        </div>
      </section>

      {/* 4. Attendance history (per-student) */}
      <div className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--color-text-primary)] mb-3">
          <ClipboardList size={16} className="text-teal-600" /> {tAtt('history')}
        </h2>
        <div className="rounded-md border border-[var(--color-line)] bg-[var(--color-panel)] overflow-hidden">
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
                  <tr className="border-b border-[var(--color-line)] bg-[var(--color-surface-0)]">
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
                      <tr key={sc.id} className="border-b border-[var(--color-line)] last:border-0">
                        <td className="py-2.5 px-4 text-[var(--color-text-secondary)] text-start" dir="ltr">
                          {sc.scanned_at
                            ? formatDateTime(sc.scanned_at, locale, { dateStyle: 'short', timeStyle: 'short' })
                            : tCommon('notSet')}
                        </td>
                        <td className="py-2.5 px-4 text-[var(--color-text-secondary)] text-start">
                          {grp ?? tCommon('notAvailable')}
                        </td>
                        <td className="py-2.5 px-4 text-start">
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
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

      {/* 5. Order card (bottom) */}
      {!delivered ? (
        <div className="mt-6 flex flex-col gap-3">
          {inCart ? (
            <div className="space-y-2">
              <button type="button" disabled className="w-full py-3 rounded-md bg-[var(--color-surface-2)] text-sm font-semibold text-[var(--color-text-muted)]">
                {tDetail('inCart')}
              </button>
              <Link href="/orders" className="block text-center text-sm font-semibold text-teal-600 underline">
                {tCart('toast.viewCart')}
              </Link>
            </div>
          ) : (
            <button
              type="button"
              className="w-full py-3 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
              onClick={() => void onOrderCard()}
            >
              {tDetail('orderCard')}
            </button>
          )}
        </div>
      ) : null}

      {/* Collect Payment modal */}
      {showCollect && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => !collectSubmitting && setShowCollect(false)}
          role="presentation"
        >
          <div
            className="bg-[var(--color-panel)] rounded-md border border-[var(--color-line)] shadow-sm w-full max-w-md p-6 modal-spring-in"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="collect-payment-title"
          >
            <h3 id="collect-payment-title" className="text-lg font-bold text-[var(--color-text-primary)] mb-1">
              {tp('collectPayment')}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">{student.name}</p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tp('amount')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  dir="ltr"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] text-sm font-mono text-[var(--color-text-primary)]"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{tp('paymentMethod')}</label>
                <div className="flex flex-wrap gap-2">
                  {(['cash', 'instapay', 'bank_transfer'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setCollectMethod(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors btn-press chq-focus ${
                        collectMethod === m
                          ? 'border-teal-600 bg-teal-600/15 text-teal-700'
                          : 'border-[var(--color-line)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {methodLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                disabled={collectSubmitting}
                onClick={() => setShowCollect(false)}
                className="px-4 py-2 border border-[var(--color-line)] rounded-lg text-sm text-[var(--color-text-primary)] btn-press chq-focus disabled:opacity-50"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                disabled={collectSubmitting}
                onClick={() => void handleCollect()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 btn-press chq-focus"
              >
                {collectSubmitting ? tCommon('loading') : tp('recordPayment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowEdit(false)}>
          <div
            className="bg-[var(--color-panel)] rounded-lg border border-[var(--color-line)] p-6 max-w-sm w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{tCommon('edit')}</h3>
              <button type="button" onClick={() => setShowEdit(false)} className="btn-press chq-focus">
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="space-y-3">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder={ts('studentName')}
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] text-sm"
              />
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder={tCommon('phone')}
                type="tel"
                dir="ltr"
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] text-sm"
              />
              <button
                type="button"
                onClick={() => setShowParentSection((v) => !v)}
                className="w-full text-start text-sm font-medium text-teal-700 py-2 border border-dashed border-teal-200 rounded-lg px-3 hover:bg-teal-50/50 btn-press chq-focus"
              >
                {ts('parentSection')}
              </button>
              {showParentSection && (
                <div className="space-y-3 ps-1 border-s-2 border-teal-100 ms-1 pe-1">
                  <input
                    value={editParentPhone}
                    onChange={(e) => setEditParentPhone(e.target.value)}
                    placeholder={ts('parentPhonePlaceholder')}
                    aria-label={ts('parentPhone')}
                    type="tel"
                    dir="ltr"
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-0)] text-sm"
                  />
                  {parentPackEnabled && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editParentPackOptIn}
                        onChange={(e) => setEditParentPackOptIn(e.target.checked)}
                        className="mt-1 rounded accent-teal-600"
                      />
                      <span className="text-sm text-[var(--color-text-primary)]">
                        <span className="font-medium block">{ts('parentPackOptIn')}</span>
                        <span className="text-xs text-[var(--color-text-secondary)]">{ts('parentPackOptInHint')}</span>
                      </span>
                    </label>
                  )}
                </div>
              )}
              {student.parent_consent_given && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  {ts('parentConsented')}
                </span>
              )}
              <FamilyLinkingSection
                centerId={centerId}
                studentId={student.id}
                currentFamilyId={editFamilyId}
                onFamilyChange={setEditFamilyId}
              />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{ts('assignGroups')}</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--color-surface-2)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editGroups.includes(g.id)}
                        onChange={(e) =>
                          setEditGroups((prev) => (e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id)))
                        }
                        className="rounded accent-teal-600"
                      />
                      <span className="text-sm text-[var(--color-text-primary)]">{g.name}</span>
                      {g.subject ? <span className="text-xs text-[var(--color-text-secondary)] ms-auto">{g.subject}</span> : null}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                className="px-4 py-2 rounded-lg text-sm border border-[var(--color-line)] btn-press chq-focus"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={isSavingEdit}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 btn-press chq-focus"
              >
                {isSavingEdit ? tCommon('loading') : tCommon('save')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ReceiptModal
        isOpen={!!receipt}
        onClose={() => setReceipt(null)}
        studentName={receipt?.studentName ?? ''}
        amount={receipt?.amount ?? 0}
        method={receipt?.method ?? ''}
        methodLabel={receipt?.methodLabel ?? ''}
        paidAt={receipt?.paidAt ?? new Date().toISOString()}
      />
    </div>
  );
}
