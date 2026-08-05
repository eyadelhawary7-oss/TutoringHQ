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
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  EllipsisVertical,
  IdCard,
  MessageCircle,
  Pencil,
  Phone,
  Plus,
  Printer,
  X,
} from 'lucide-react';
import { QRCard } from '@/components/QRCard';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { FamilyLinkingSection } from '@/components/students/FamilyLinkingSection';
import { StandingBadge, standingAvatarClass } from '@/components/students/StandingBadge';
import { ReceiptModal } from '@/components/payments/ReceiptModal';
import { PrintStatementModal } from '@/components/PrintStatementModal';
import { pushRecentlyViewedStudent } from '@/lib/recentlyViewedStudents';
import { formatDate, formatNumber, formatCurrency } from '@/lib/formatNumber';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { getStudentBalances } from '@/lib/studentBalance';
import { deriveStanding, getStudentStandings, type Standing, type StudentStandingRow } from '@/lib/studentStanding';
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
  qr_code?: string | null;
  created_at?: string | null;
};

/** Another student sharing this one's `sibling_family_id` - Merged-Center-Students
 * §02 "Family" card lists the parent AND each sibling as its own contact row.
 * Live previously rendered only the `families` row (one line for the whole
 * household); this is the missing per-member half. */
type SiblingRow = { id: string; name: string; subject: string | null; grade_level: string | null };

type GroupRow = { id: string; name: string; subject: string | null; fee_per_class?: number | null };

type CenterInfo = { name: string; logo_url: string | null };

/**
 * Only methods that pass BOTH gates a collect must clear: the route allowlist
 * in POST /api/payments/collect AND the live `payments_method_check` constraint
 * (cash | instapay | vodacash | orange | fawry | bank — verified in
 * pg_constraint). 'bank_transfer' passed the route but is NOT in the DB
 * constraint, so every such insert 500s; the option is removed rather than
 * shipped as a guaranteed failure. The route↔constraint mismatch itself is
 * flagged for Eyad — mapping values in a money endpoint is not a UI call.
 */
type CollectMethod = 'cash' | 'instapay';

interface ScanRecord {
  id: string;
  scanned_at: string;
  /**
   * `attendance_scans.status` is CHECK-constrained to present | absent (or NULL)
   * — verified in pg_constraint (`attendance_scans_status_chk`). There is no
   * 'late', so §02's three-state badge ships as TWO states. See needsMigration M1.
   */
  status?: string | null;
  session_date?: string | null;
  group_id?: string | null;
}

/** A logged collection — §03's Payments section. All six columns verified live. */
interface PaymentRecord {
  id: string;
  amount: number | null;
  method: string | null;
  status: string | null;
  paid_at: string | null;
  group_id?: string | null;
}

// Only plain columns that physically exist on the students table (the
// parent/sibling fields are the same ones the list page reads). NOTE: do NOT
// add `balance_due` here — that column is not present in the students schema,
// and selecting it makes PostgREST 400 the whole query, which surfaces as
// "student not found" for every student.
const STUDENT_SELECT =
  'id, name, student_number, phone, parent_phone, parent_pack_opted_in, parent_consent_given, sibling_family_id, subject, grade_level, qr_code, created_at';

/**
 * §03 payment-method chip: a TWO-WAY DISPLAY FOLD, not a stored value.
 * `payments.method` is CHECK-constrained to cash | instapay | vodacash | orange
 * | fawry | bank — there is no 'online' and no 'card'. Cash reads amber, every
 * other (electronic) method reads mint "Online".
 */
function isCashMethod(method: string | null | undefined): boolean {
  return String(method ?? '').toLowerCase() === 'cash';
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
    qr_code: (raw.qr_code as string | null | undefined) ?? null,
    created_at: (raw.created_at as string | null | undefined) ?? null,
  };
}

// Every OTHER student sharing this one's family - the per-member half of the
// Family card the `families` row alone cannot provide. Scoped to center_id
// (same RLS-bearing filter every other query on this page uses) and excludes
// the current student. No families share a member today (checked live), so
// this stays empty-but-ready until FamilyLinkingSection links a second child -
// same "surface already-fetched-but-dropped data" pattern as F13 (grade_level).
async function fetchSiblings(
  siblingFamilyId: string | null,
  centerId: string,
  excludeStudentId: string,
): Promise<SiblingRow[]> {
  if (!siblingFamilyId) return [];
  const { data } = await dbSelect({
    table: 'students',
    select: 'id, name, subject, grade_level',
    filters: [
      { column: 'sibling_family_id', op: 'eq', value: siblingFamilyId },
      { column: 'center_id', op: 'eq', value: centerId },
    ],
    order: { column: 'name' },
  });
  return ((data ?? []) as SiblingRow[]).filter((s) => s.id !== excludeStudentId);
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
  const [siblings, setSiblings] = useState<SiblingRow[]>([]);
  const [delivered, setDelivered] = useState(false);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [groupNameMap, setGroupNameMap] = useState<Record<string, string>>({});
  const [groupSubjectMap, setGroupSubjectMap] = useState<Record<string, string | null>>({});
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [memberGroupIds, setMemberGroupIds] = useState<string[]>([]);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [centerInfo, setCenterInfo] = useState<CenterInfo | null>(null);
  // Standing = balance + the Cairo-day age of the oldest open charge. The
  // §02 "12 days overdue · since 01/07" line and §03's hero hint both read it.
  const [standing, setStanding] = useState<StudentStandingRow | null>(null);
  const [thresholds, setThresholds] = useState<{ overdueAfterDays?: number; newStudentDays?: number }>({});
  /**
   * Attendance as a ratio (§02 stat tile). `scheduled` counts sessions that have
   * already happened for the student's groups.
   *
   * "this term" CANNOT be honoured: academic_years and academic_periods are both
   * 0 rows live, so there is no window to scope to. The sub-label therefore says
   * which window it actually used — never "this term" over an all-time ratio.
   */
  const [attendance, setAttendance] = useState<{ attended: number; scheduled: number; scoped: boolean } | null>(null);
  /** Earliest future scheduled session + that group's per-class fee, or null. */
  const [nextDue, setNextDue] = useState<{ at: string; amount: number | null } | null>(null);
  /** platform_config.qr_card_price. null = read failed → the banner drops the price clause. */
  const [qrCardPrice, setQrCardPrice] = useState<number | null>(null);
  /** Reminders actually sent to this student, or null when unmatchable. */
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [showPrintStatement, setShowPrintStatement] = useState(false);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [remindSubmitting, setRemindSubmitting] = useState(false);

  // ID card quick action (Merged-Center-Students §02: Message / Call / ID card /
  // Edit). Live had Call/Message/Collect payment/Edit - viewing or printing this
  // student's own QR card was reachable only from the roster page. Same
  // QRCode-generation + QRCard-render pattern the roster page already uses.
  const [showIdCard, setShowIdCard] = useState(false);
  const [idCardDataUrl, setIdCardDataUrl] = useState<string | null>(null);

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
        setCenterInfo(
          meData?.user?.center
            ? { name: meData.user.center.name ?? 'TutoringHQ', logo_url: meData.user.center.logo_url ?? null }
            : null,
        );

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
          const sibs = await fetchSiblings(row.sibling_family_id ?? null, cid, row.id);
          if (!cancelled) setSiblings(sibs);
        }

        // Per-student attendance history + the center's groups (reused for the
        // attendance-row labels AND the edit modal's group checklist) + this
        // student's current group memberships (to prefill the edit modal).
        if (row) {
          setAttendanceLoading(true);
          const [scansSel, groupsSel, membersSel, paySel] = await Promise.all([
            dbSelect({
              table: 'attendance_scans',
              // status + session_date drive §02's Present/Absent badge and its
              // "Sun 13/07" date. Both columns confirmed in information_schema.
              select: 'id, scanned_at, session_date, status, group_id',
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
            // §03 Payments section. payments is center-scoped in the proxy's
            // TABLE_SCOPE, so this is the same gate every other read here uses.
            dbSelect({
              table: 'payments',
              select: 'id, amount, method, status, paid_at, group_id',
              filters: [
                { column: 'center_id', op: 'eq', value: cid },
                { column: 'student_id', op: 'eq', value: row.id },
              ],
              order: { column: 'paid_at', ascending: false },
            }),
          ]);
          if (!cancelled) {
            const scanRows = (scansSel.data || []) as ScanRecord[];
            setScans(scanRows);
            setPayments((paySel.data || []) as PaymentRecord[]);
            const grps = (groupsSel.data || []) as GroupRow[];
            setGroups(grps);
            setGroupNameMap(Object.fromEntries(grps.map((g) => [g.id, g.name])));
            setGroupSubjectMap(Object.fromEntries(grps.map((g) => [g.id, g.subject ?? null])));
            const memberIds = ((membersSel.data || []) as { group_id: string }[]).map((m) => m.group_id);
            setMemberGroupIds(memberIds);
            setAttendanceLoading(false);

            // Attendance ratio + next due. `sessions` is not in the proxy's
            // TABLE_SCOPE, but its RLS SELECT policy admits the center's own
            // groups (`sessions_select`), so the browser client reads it directly.
            if (memberIds.length > 0) {
              void (async () => {
                try {
                  // Is there a current academic year at all? Both academic_years
                  // and academic_periods are EMPTY live, so this normally answers
                  // "no" and the label below tells the truth about that.
                  let scoped = false;
                  try {
                    const { data: yr } = await supabase
                      .from('academic_years')
                      .select('id')
                      .eq('center_id', cid)
                      .eq('is_current', true)
                      .limit(1);
                    scoped = Array.isArray(yr) && yr.length > 0;
                  } catch {
                    scoped = false;
                  }
                  const nowIso = new Date().toISOString();
                  const { data: past } = await supabase
                    .from('sessions')
                    .select('id')
                    .in('group_id', memberIds)
                    .in('status', ['finished', 'scheduled'])
                    .lte('scheduled_at', nowIso);
                  const attended = scanRows.filter((sc) => sc.status !== 'absent').length;
                  if (!cancelled) {
                    setAttendance({
                      attended,
                      scheduled: Array.isArray(past) ? past.length : 0,
                      scoped,
                    });
                  }
                  const { data: upcoming } = await supabase
                    .from('sessions')
                    .select('scheduled_at, group_id')
                    .in('group_id', memberIds)
                    .eq('status', 'scheduled')
                    .gt('scheduled_at', nowIso)
                    .order('scheduled_at', { ascending: true })
                    .limit(1);
                  const nx = Array.isArray(upcoming) ? upcoming[0] : null;
                  if (!cancelled && nx) {
                    const g = grps.find((x) => x.id === (nx as { group_id: string }).group_id);
                    setNextDue({
                      at: (nx as { scheduled_at: string }).scheduled_at,
                      // student_groups.fee_per_class — the column the groupsSel
                      // query actually selects (there is no `.fee` key on these
                      // rows, and student_groups has no monthly_fee).
                      amount: g?.fee_per_class ?? null,
                    });
                  }
                } catch (err) {
                  // Fail quiet, never fake: with no session data the ratio tile
                  // and the "Next due" line simply do not render.
                  console.error('[student-detail] session stats failed', err);
                }
              })();
            }
          }
        }

        // Standing (oldest open charge age) + the two thresholds + the ID-card
        // price + the reminder count. Each is independent and each failure mode
        // is "the clause is omitted", never "a number is invented".
        if (row) {
          getStudentStandings(supabase, { studentIds: [row.id] })
            .then((map) => {
              if (!cancelled) setStanding(map.get(row.id) ?? null);
            })
            .catch((err) => console.error('[student-detail] standing load failed', err));

          void (async () => {
            try {
              const res = await fetch('/api/students/ui-config', {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (!res.ok || cancelled) return;
              const j = (await res.json()) as {
                qrCardPrice?: number;
                overdueAfterDays?: number;
                newStudentDays?: number;
              };
              if (cancelled) return;
              if (typeof j.qrCardPrice === 'number') setQrCardPrice(j.qrCardPrice);
              setThresholds({
                overdueAfterDays: j.overdueAfterDays,
                newStudentDays: j.newStudentDays,
              });
            } catch {
              /* price clause is omitted; thresholds fall back to code defaults */
            }
          })();

          void (async () => {
            try {
              const res = await fetch(`/api/students/reminder-count?student_id=${encodeURIComponent(row.id)}`, {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
              if (!res.ok || cancelled) return;
              const j = (await res.json()) as { count?: number; matchable?: boolean };
              if (!cancelled && j.matchable && typeof j.count === 'number') setReminderCount(j.count);
            } catch {
              /* clause omitted */
            }
          })();
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
      // Standing and the payments list move with the balance — a collect that
      // updated the figure but left "12 days overdue" and the last-payment row
      // stale would be the screen contradicting itself.
      setStanding((await getStudentStandings(supabase, { studentIds: [row.id] })).get(row.id) ?? null);
      const paySel = await dbSelect({
        table: 'payments',
        select: 'id, amount, method, status, paid_at, group_id',
        filters: [
          { column: 'center_id', op: 'eq', value: centerId },
          { column: 'student_id', op: 'eq', value: row.id },
        ],
        order: { column: 'paid_at', ascending: false },
      });
      setPayments((paySel.data || []) as PaymentRecord[]);
      setFamily(await fetchFamilyForStudent(row.sibling_family_id ?? null, session.access_token));
      setSiblings(await fetchSiblings(row.sibling_family_id ?? null, centerId, row.id));
    } catch (err) {
      console.error('[student-detail] reloadStudent failed', err);
    }
  }, [centerId, id]);

  /**
   * §03's Remind action. POST /api/whatsapp/send-balance-reminder returns
   * `{ ok:true, sent:n, results:[…] }` and SILENTLY SKIPS a student with no
   * phone (route lines 86-90), so `ok:true` alone is not success. The toast
   * reflects `sent`: a success only when exactly one went out, otherwise the
   * route's own reason ("No phone"). Never a green tick over nothing sent.
   */
  const handleRemind = async () => {
    if (!student || remindSubmitting) return;
    setRemindSubmitting(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error(tToast('error'), tCommon('error'));
        return;
      }
      const res = await fetch('/api/whatsapp/send-balance-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          ...(await getCsrfHeaders(session.access_token)),
        },
        body: JSON.stringify({ student_id: student.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; sent?: number; results?: { error?: string }[]; error?: string }
        | null;
      if (!res.ok) {
        toast.error(tToast('error'), data?.error ?? tCommon('error'));
        return;
      }
      if ((data?.sent ?? 0) === 1) {
        toast.success(tDetail('reminderSent'));
        setReminderCount((n) => (n === null ? n : n + 1));
        return;
      }
      toast.error(tDetail('reminderNotSent'), data?.results?.[0]?.error ?? undefined);
    } catch (err) {
      toast.error(tToast('error'), err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setRemindSubmitting(false);
    }
  };

  const onOrderCard = async () => {
    if (!student || delivered || isStudentInCart(student.id)) return;
    try {
      await addItem({ kind: 'student', student_id: student.id });
      toast.success(tCart('toast.added'), tCart('toast.viewCart'));
    } catch {
      toast.error(tToast('error'));
    }
  };

  // ID card quick action: generate the QR once (persisted on students.qr_code,
  // same column/shape the roster page already writes) then show it in the same
  // QRCard preview used there.
  const openIdCard = async () => {
    if (!student) return;
    setShowIdCard(true);
    setIdCardDataUrl(student.qr_code ?? null);
    if (student.qr_code) return;
    try {
      const dataUrl = await QRCode.toDataURL(student.id, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      await dbUpdate({
        table: 'students',
        data: { qr_code: dataUrl },
        filters: [{ column: 'id', op: 'eq', value: student.id }],
      });
      setStudent((prev) => (prev ? { ...prev, qr_code: dataUrl } : prev));
      setIdCardDataUrl(dataUrl);
    } catch (err) {
      console.error('[student-detail] QR generation failed', err);
    }
  };

  const downloadIdCard = () => {
    if (!idCardDataUrl || !student) return;
    const link = document.createElement('a');
    const numForFile = (student.student_number || student.id).replace(/^#/, '');
    link.download = `QR-${student.name}-${numForFile}.png`;
    link.href = idCardDataUrl;
    link.click();
  };

  const printIdCard = () => {
    if (!idCardDataUrl || !student) return;
    const esc = (s: string) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const logoHtml = centerInfo?.logo_url
      ? `<img src="${esc(centerInfo.logo_url)}" alt="" style="height:7mm;width:auto;max-width:12mm;object-fit:contain" />`
      : '';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <!DOCTYPE html><html dir="ltr">
      <head>
        <meta charset="utf-8">
        <style>
          body { margin: 0; padding: 10mm; font-family: system-ui, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .card { width: 85.6mm; height: 54mm; background: linear-gradient(135deg, #0D9488 0%, #1E293B 100%); position: relative; overflow: hidden; color: white; }
          .top-bar { position: absolute; top: 0; inset-inline-start: 0; inset-inline-end: 0; display: flex; align-items: center; justify-content: space-between; padding: 2.5mm 3mm; background: rgba(0,0,0,0.35); }
          .center-name { font-size: 9px; font-weight: 500; opacity: 0.9; }
          .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
          .qr-wrap { width: 25mm; height: 25mm; background: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
          .qr-wrap img { width: 20mm; height: 20mm; }
          .name { font-size: 14px; font-weight: bold; margin-top: 2.5mm; text-align: center; }
          .num { font-size: 10px; opacity: 0.7; margin-top: 0.5mm; font-family: monospace; }
          .bottom { position: absolute; bottom: 0; inset-inline-start: 0; inset-inline-end: 0; padding: 1.5mm; border-top: 1px solid rgba(255,255,255,0.2); text-align: center; font-size: 7px; opacity: 0.3; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="top-bar">${logoHtml}<span class="center-name">${esc(centerInfo?.name || 'TutoringHQ')}</span></div>
          <div class="center">
            <div class="qr-wrap"><img src="${idCardDataUrl}" alt="QR" /></div>
            <div class="name">${esc(student.name)}</div>
            <div class="num">${esc(formatStudentNumberForDisplay(student.student_number))}</div>
          </div>
          <div class="bottom">TutoringHQ</div>
        </div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const methodLabel = (m: CollectMethod) => tp(m === 'cash' ? 'method_cash' : 'method_instapay');

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
      /* §02's loading frame, block for block: a 42px back square beside two
         header lines, a 54px identity tile, the 104px balance card, TWO stat
         tiles (not three — the third was dropped with Visits/Last seen when the
         statrow was built), FOUR quick-action tiles, then the two section
         blocks and the pinned bottom bar. A skeleton that lays out differently
         from what replaces it makes the page jump on load, which is the one
         thing a skeleton exists to stop. */
      <div
        className="mx-auto flex min-h-screen w-full max-w-lg flex-col bg-[var(--color-surface-0)]"
        aria-busy="true"
      >
        <div className="flex items-center gap-3 px-4 pt-2 pb-3">
          <div className="h-[42px] w-[42px] shrink-0 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
          <div className="flex-1 space-y-2">
            <div className="h-[15px] w-32 animate-pulse rounded bg-[var(--color-surface-2)]" />
            <div className="h-[11px] w-24 animate-pulse rounded bg-[var(--color-surface-2)]" />
          </div>
          <div className="h-[42px] w-[42px] shrink-0 animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
        </div>
        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          <div className="flex items-center gap-3">
            <div className="h-[54px] w-[54px] shrink-0 animate-pulse rounded-2xl bg-[var(--color-surface-2)]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/5 animate-pulse rounded bg-[var(--color-surface-2)]" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-[var(--color-surface-2)]" />
            </div>
          </div>
          <div className="h-[104px] animate-pulse rounded-2xl bg-[var(--color-surface-2)]" />
          <div className="flex gap-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-[74px] flex-1 animate-pulse rounded-2xl bg-[var(--color-surface-2)]"
              />
            ))}
          </div>
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 flex-1 animate-pulse rounded-xl bg-[var(--color-surface-2)]"
              />
            ))}
          </div>
          <div className="h-24 animate-pulse rounded-2xl bg-[var(--color-surface-2)]" />
          <div className="h-[120px] animate-pulse rounded-2xl bg-[var(--color-surface-2)]" />
        </div>
        <div className="px-4 pb-4 pt-3">
          <div className="h-[50px] animate-pulse rounded-xl bg-[var(--color-surface-2)]" />
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
  const studentDigits = intlDigits(student.phone);
  const parentDigits = intlDigits(family?.parent_phone ?? student.parent_phone);
  // deriveStanding is the ONE place the four states are decided (roster and
  // detail read the same function), so the badge here can never disagree with
  // the badge on the row that linked to it.
  const standingValue: Standing = standing
    ? deriveStanding(standing, new Date(), thresholds)
    : 'paid';
  const owes = (balance ?? 0) > 0;
  const recentScans = scans.slice(0, 3);
  const recentPayments = payments.slice(0, 5);
  // §03's Attendance card carries a second fact next to the ratio: "Last
  // attended 20/07". `scans` comes back ordered scanned_at DESC, so the first
  // row that is not an absence IS the last attendance — no extra query, no
  // client-side sort to get wrong. Absent when the student has never been
  // scanned present; there is no placeholder date.
  const lastAttendedAt =
    scans.find((sc) => sc.status !== 'absent')?.session_date ??
    scans.find((sc) => sc.status !== 'absent')?.scanned_at ??
    null;
  const identityMeta = [
    student.subject,
    student.grade_level ? tDetail('gradeLabel', { grade: student.grade_level }) : null,
  ].filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-0)]">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
        {/* §02 `.topbar` — a 42×42 back square at the START edge (the chevron
            mirrors in RTL), the name over subject · grade, and a kebab carrying
            what the design removes from the body. */}
        <div className="flex items-center gap-3 px-4 pt-2 pb-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={tDetail('back')}
            className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] btn-press chq-focus"
          >
            <DirectionalIcon icon={ChevronLeft} className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-semibold leading-tight text-[var(--color-text-primary)]">
              {student.name}
            </p>
            {identityMeta.length > 0 ? (
              <p className="truncate text-xs text-[#80827A]">{identityMeta.join(' · ')}</p>
            ) : null}
          </div>
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label={tCommon('actions')}
              aria-expanded={pageMenuOpen}
              onClick={() => setPageMenuOpen((v) => !v)}
              className="grid h-[42px] w-[42px] place-items-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[var(--color-text-secondary)] btn-press chq-focus"
            >
              <EllipsisVertical size={20} aria-hidden />
            </button>
            {pageMenuOpen ? (
              <div
                role="menu"
                className="absolute end-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-1 shadow-lg"
              >
                {canCollect ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPageMenuOpen(false);
                      setShowPrintStatement(true);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                  >
                    {ts('statement.printStatement')}
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPageMenuOpen(false);
                    void openIdCard();
                  }}
                  className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                >
                  {ts('viewQR')}
                </button>
                {/* The standalone student-number line the design does NOT draw
                    lives here instead of on the header. */}
                {student.student_number ? (
                  <p
                    className="px-3 py-2 font-mono text-xs text-[var(--color-text-tertiary)]"
                    dir="ltr"
                  >
                    <bdi>{formatStudentNumberForDisplay(student.student_number)}</bdi>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          {/* §02 `.idhdr` — a 54×54 rounded tile tinted by standing (the live
              circle was a fixed mint), the name at 20px, and the standing badge
              at the row end replacing the ad-hoc red/green pill. */}
          <div className="flex items-center gap-3">
            <div
              className={`grid h-[54px] w-[54px] shrink-0 place-items-center rounded-2xl text-[22px] font-semibold ${standingAvatarClass(standingValue)}`}
              aria-hidden
            >
              {initialsOf(student.name)}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-semibold text-[var(--color-text-primary)]">
                {student.name}
              </h1>
              <p className="truncate text-xs text-[#80827A]">
                {[
                  student.subject,
                  student.grade_level ? tDetail('gradeLabel', { grade: student.grade_level }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {student.phone ? (
                  <>
                    {identityMeta.length > 0 ? ' · ' : ''}
                    <span className="font-mono" dir="ltr">
                      {student.phone}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            {balance !== null ? (
              <StandingBadge
                standing={standingValue}
                label={ts(
                  standingValue === 'paid'
                    ? 'standing_paid'
                    : standingValue === 'overdue'
                      ? 'standing_overdue'
                      : standingValue === 'at_risk'
                        ? 'standing_at_risk'
                        : 'standing_new',
                )}
              />
            ) : null}
          </div>

          {/* Balance. §03 draws the owing state as a TEAL GRADIENT hero (its
              later frame wins over §02's red card); §02's mint card stays for
              the settled state. */}
          {balance !== null ? (
            owes ? (
              <div className="rounded-2xl bg-[linear-gradient(150deg,#0E6B61,#0A514A)] p-6 text-[#F2EEE5]">
                <p className="text-xs opacity-90">{tDetail('outstanding')}</p>
                <p className="num mt-1 text-[30px] font-bold leading-none tabular-nums" dir="ltr">
                  {formatCurrency(balance, locale)}
                </p>
                {/* Three clauses, and only the ones with a real source render.
                    "N sessions unpaid" and "oldest <date>" come from the FIFO
                    fold; "reminded N times" only when wa_message_queue could
                    actually be matched to this student's phone AND is non-zero. */}
                {(() => {
                  const hint = [
                    standing && standing.openChargeCount > 0
                      ? tDetail('sessionsUnpaid', {
                          count: formatNumber(standing.openChargeCount, locale),
                        })
                      : null,
                    standing?.oldestUnpaidAt
                      ? tDetail('oldestCharge', {
                          date: formatDate(standing.oldestUnpaidAt, locale, 'short'),
                        })
                      : null,
                    reminderCount !== null && reminderCount > 0
                      ? tDetail('remindedTimes', { count: formatNumber(reminderCount, locale) })
                      : null,
                  ].filter(Boolean);
                  if (hint.length === 0) return null;
                  return (
                    <p className="mt-2 text-[11px] leading-relaxed opacity-[.82]">
                      {hint.join(' · ')}
                    </p>
                  );
                })()}
                {standing?.oldestUnpaidDays != null && standing.oldestUnpaidAt ? (
                  <p className="mt-2 text-xs opacity-[.82] tabular-nums">
                    {tDetail('overdueSince', {
                      days: formatNumber(standing.oldestUnpaidDays, locale),
                      date: formatDate(standing.oldestUnpaidAt, locale, 'short'),
                    })}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-[rgba(26,109,77,.18)] bg-[#E4F0E9] p-6">
                <p className="text-xs font-semibold text-[#1A6D4D] opacity-85">{tDetail('balance')}</p>
                <p className="num mt-1.5 text-[34px] font-bold leading-none tabular-nums text-[#1A6D4D]" dir="ltr">
                  {formatCurrency(balance, locale)}
                  <span className="ms-2 text-[15px] font-semibold">· {tDetail('paidUp')}</span>
                </p>
                {/* "Next due <date> · <amount>" — DERIVED, never stored: the
                    earliest future scheduled session of a group this student
                    belongs to, priced at that group's fee_per_class. Omitted
                    entirely when there is no such session; no placeholder date. */}
                {nextDue ? (
                  <p className="mt-2 text-xs text-[#5D635C] tabular-nums">
                    {nextDue.amount != null
                      ? tDetail('nextDueWithAmount', {
                          date: formatDate(nextDue.at, locale, 'short'),
                          amount: formatCurrency(nextDue.amount, locale),
                        })
                      : tDetail('nextDue', { date: formatDate(nextDue.at, locale, 'short') })}
                  </p>
                ) : null}
              </div>
            )
          ) : null}

          {/* §03 `.acts` — two secondary actions directly under the hero. */}
          {canCollect ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={remindSubmitting}
                onClick={() => void handleRemind()}
                className="flex-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-3 text-center text-xs font-semibold text-[var(--color-accent-deep)] disabled:opacity-50 btn-press chq-focus"
              >
                {remindSubmitting ? tCommon('loading') : tDetail('remind')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollectMethod('cash');
                  setCollectAmount(owes ? String(Math.round(balance ?? 0)) : '');
                  setShowCollect(true);
                }}
                className="flex-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-3 text-center text-xs font-semibold text-[var(--color-accent-deep)] btn-press chq-focus"
              >
                {tDetail('recordCash')}
              </button>
            </div>
          ) : null}

          {/* §02 `.statrow` — TWO tiles, not three. Visits and Last seen are not
              drawn and are gone. */}
          <div className="flex gap-2">
            <div className="flex-1 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
              <p className="text-xs text-[#80827A]">{tDetail('attendance')}</p>
              <p className="num mt-1 text-[22px] font-semibold leading-none tabular-nums text-[var(--color-text-primary)]" dir="ltr">
                {attendance && attendance.scheduled > 0
                  ? `${formatNumber(attendance.attended, locale)}/${formatNumber(attendance.scheduled, locale)}`
                  : formatNumber(scans.filter((sc) => sc.status !== 'absent').length, locale)}
              </p>
              {/* Tells the truth about which window it used. academic_years is
                  EMPTY live, so this reads "all time" — never "this term" over
                  an all-time ratio. */}
              <p className="mt-1 text-xs text-[#80827A]">
                {attendance?.scoped ? tDetail('windowThisTerm') : tDetail('windowAllTime')}
              </p>
              {lastAttendedAt ? (
                <p className="mt-1 text-xs text-[#80827A] tabular-nums">
                  {tDetail('lastAttended', {
                    date: formatDate(lastAttendedAt, locale, 'short'),
                  })}
                </p>
              ) : null}
            </div>
            {lifetimePaid !== null ? (
              <div className="flex-1 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
                <p className="text-xs text-[#80827A]">{tDetail('lifetimePaid')}</p>
                <p className="num mt-1 text-[22px] font-semibold leading-none tabular-nums text-[var(--color-text-primary)]" dir="ltr">
                  {formatCurrency(lifetimePaid, locale)}
                </p>
                {student.created_at ? (
                  <p className="mt-1 text-xs text-[#80827A]">
                    {tDetail('sinceEnrolled', {
                      date: formatDate(student.created_at, locale, { month: 'short', year: 'numeric' }),
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* §02 `.qact` — four equal tiles at ~64px: Message / Call / ID card /
              Edit. All four ALWAYS render; Message and Call are disabled (not
              removed) when the student has no phone, so the row never collapses
              to a 2- or 3-up the design does not draw. */}
          <div className="flex gap-2">
            <a
              href={studentDigits ? `https://wa.me/${studentDigits}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!studentDigits}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-1 py-3 ${
                studentDigits ? 'btn-press chq-focus' : 'pointer-events-none opacity-50'
              }`}
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                <MessageCircle size={18} aria-hidden />
              </span>
              <span className="text-[11px] font-semibold text-[var(--color-mid)]">
                {tDetail('messageAction')}
              </span>
            </a>
            <a
              href={studentDigits ? `tel:+${studentDigits}` : undefined}
              aria-disabled={!studentDigits}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-1 py-3 ${
                studentDigits ? 'btn-press chq-focus' : 'pointer-events-none opacity-50'
              }`}
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                <Phone size={18} aria-hidden />
              </span>
              <span className="text-[11px] font-semibold text-[var(--color-mid)]">
                {tDetail('callAction')}
              </span>
            </a>
            <button
              type="button"
              onClick={() => void openIdCard()}
              className="flex flex-1 flex-col items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-1 py-3 btn-press chq-focus"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                <IdCard size={18} aria-hidden />
              </span>
              <span className="text-[11px] font-semibold text-[var(--color-mid)]">
                {tDetail('idCardAction')}
              </span>
            </button>
            <button
              type="button"
              onClick={openEdit}
              disabled={!canEdit}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-1 py-3 ${
                canEdit ? 'btn-press chq-focus' : 'opacity-50'
              }`}
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                <Pencil size={18} aria-hidden />
              </span>
              <span className="text-[11px] font-semibold text-[var(--color-mid)]">{tCommon('edit')}</span>
            </button>
          </div>

          {/* §03 Payments. `payments` is 0 rows live but has an ACTIVE writer
              (POST /api/payments/collect), so this is a real feature with an
              empty table — not a dead one. */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold text-[var(--color-mid)]">{tDetail('paymentsTitle')}</h2>
              <Link href="/payments" className="text-xs font-semibold text-[#0E6B61]">
                {tDetail('seeAll')}
              </Link>
            </div>
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
              {recentPayments.length === 0 ? (
                <p className="py-3 text-[13px] text-[var(--color-text-secondary)]">
                  {tDetail('noPayments')}
                </p>
              ) : (
                recentPayments.map((p, i) => {
                  const subject = p.group_id ? groupSubjectMap[p.group_id] : null;
                  const st = String(p.status ?? '').toLowerCase();
                  const known = st === 'confirmed' || st === 'paid' || st === 'pending';
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2 py-3 text-[13px] ${
                        i < recentPayments.length - 1 ? 'border-b border-[#F0ECE2]' : ''
                      }`}
                    >
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                          isCashMethod(p.method)
                            ? 'bg-[#F4EBD7] text-[#9A6B1F]'
                            : 'bg-[var(--color-mint)] text-[#0E6B61]'
                        }`}
                      >
                        {tDetail(isCashMethod(p.method) ? 'methodCash' : 'methodOnline')}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--color-mid)]">
                        {[p.paid_at ? formatDate(p.paid_at, locale, 'short') : null, subject]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums" dir="ltr">
                        {formatCurrency(Number(p.amount ?? 0), locale)}
                      </span>
                      {/* No "Failed" chip: nothing in the codebase ever writes
                          payments.status = 'failed'. An unrecognised value shows
                          its raw text in neutral styling rather than being
                          silently classed as Paid. */}
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${
                          !known
                            ? 'bg-[#F0ECE2] text-[#9C3322]'
                            : st === 'pending'
                              ? 'bg-[#F4EBD7] text-[#9A6B1F]'
                              : 'bg-[var(--color-mint)] text-[#0E6B61]'
                        }`}
                      >
                        {known ? tDetail(st === 'pending' ? 'statusUnpaid' : 'statusPaid') : String(p.status ?? '')}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* §03 Contacts — one `.person` card per human WITH a phone, each
              carrying its own Call and WhatsApp buttons. Replaces §02's inert
              family row (§03 is the later frame of the same screen). */}
          <section>
            <h2 className="mb-2 text-[15px] font-bold text-[var(--color-text-primary)]">
              {tDetail('contacts')}
            </h2>
            {parentDigits || studentDigits ? (
              <div className="flex flex-col gap-2">
                {parentDigits ? (
                  <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-tile)] text-[13px] font-bold text-[var(--color-mid)]">
                        {initialsOf(family?.parent_name || family?.family_name || student.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {family?.parent_name || family?.family_name || tDetail('parentRole')}
                        </p>
                        <p className="text-[11px] text-[#80827A]">{tDetail('parentRole')}</p>
                        <p className="mt-1 font-mono text-xs text-[var(--color-mid)]" dir="ltr">
                          {family?.parent_phone ?? student.parent_phone}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <a
                        href={`tel:+${parentDigits}`}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-tile)] py-3 text-xs font-bold text-[#3A3F3A] btn-press chq-focus"
                      >
                        <Phone size={15} aria-hidden /> {tDetail('call')}
                      </a>
                      <a
                        href={`https://wa.me/${parentDigits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-[rgba(18,104,74,.2)] bg-[var(--color-mint)] py-3 text-xs font-bold text-[#0E6B61] btn-press chq-focus"
                      >
                        <MessageCircle size={15} aria-hidden /> {tDetail('whatsapp')}
                      </a>
                    </div>
                  </div>
                ) : null}
                {studentDigits ? (
                  <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-tile)] text-[13px] font-bold text-[var(--color-mid)]">
                        {initialsOf(student.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {student.name}
                        </p>
                        <p className="text-[11px] text-[#80827A]">{tDetail('studentRole')}</p>
                        <p className="mt-1 font-mono text-xs text-[var(--color-mid)]" dir="ltr">
                          {student.phone}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <a
                        href={`tel:+${studentDigits}`}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-tile)] py-3 text-xs font-bold text-[#3A3F3A] btn-press chq-focus"
                      >
                        <Phone size={15} aria-hidden /> {tDetail('call')}
                      </a>
                      <a
                        href={`https://wa.me/${studentDigits}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-[rgba(18,104,74,.2)] bg-[var(--color-mint)] py-3 text-xs font-bold text-[#0E6B61] btn-press chq-focus"
                      >
                        <MessageCircle size={15} aria-hidden /> {tDetail('whatsapp')}
                      </a>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-[13px] text-[var(--color-text-secondary)]">
                {tDetail('noFamilyLinked')}
              </p>
            )}
          </section>

          {/* Siblings keep §02's chevron row treatment. §03 does not draw them,
              but dropping them would remove the only sibling navigation there is. */}
          {siblings.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[13px] font-semibold text-[var(--color-mid)]">
                {tDetail('family')}
              </h2>
              <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
                {siblings.map((sib, i) => (
                  <Link
                    key={sib.id}
                    href={`/students/${sib.id}`}
                    className={`flex items-center gap-2 py-3 ${
                      i < siblings.length - 1 ? 'border-b border-[#F0ECE2]' : ''
                    }`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--color-mint)] text-xs font-semibold text-[var(--color-accent-deep)]">
                      {initialsOf(sib.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                        {sib.name}
                      </p>
                      <p className="truncate text-xs text-[#80827A]">
                        {[
                          tDetail('siblingRole'),
                          sib.subject,
                          sib.grade_level ? tDetail('gradeLabel', { grade: sib.grade_level }) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <DirectionalIcon icon={ChevronRight} className="h-[18px] w-[18px] text-[#80827A]" />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* §02 Recent attendance — the THREE most recent scans, with a See-all
              link to the full list. */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold text-[var(--color-mid)]">
                {tDetail('recentAttendance')}
              </h2>
              <Link href="/attendance" className="text-xs font-semibold text-[#0E6B61]">
                {tDetail('seeAll')}
              </Link>
            </div>
            <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-1">
              {attendanceLoading ? (
                <div className="flex justify-center py-6">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                </div>
              ) : recentScans.length === 0 ? (
                <p className="py-3 text-[13px] text-[var(--color-text-secondary)]">
                  {tAtt('noDataInPeriod')}
                </p>
              ) : (
                recentScans.map((sc, i) => {
                  const absent = sc.status === 'absent';
                  const grp = sc.group_id ? groupNameMap[sc.group_id] : null;
                  return (
                    <div
                      key={sc.id}
                      className={`flex items-center gap-2 py-3 ${
                        i < recentScans.length - 1 ? 'border-b border-[#F0ECE2]' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="num text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {formatDate(sc.session_date ?? sc.scanned_at, locale, {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </p>
                        {grp ? <p className="truncate text-xs text-[#80827A]">{grp}</p> : null}
                      </div>
                      {/* TWO states, not three. attendance_scans.status is
                          CHECK-constrained to present | absent — a "Late" badge
                          derived from scanned_at vs sessions.scheduled_at would
                          be a different fact wearing the design's label. M1. */}
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-semibold ${
                          absent ? 'bg-[#F4E5E2] text-[#9C3322]' : 'bg-[#E4F0E9] text-[#1A6D4D]'
                        }`}
                      >
                        {absent ? <X size={12} aria-hidden /> : <Check size={12} strokeWidth={2.5} aria-hidden />}
                        {tDetail(absent ? 'attendanceAbsent' : 'attendancePresent')}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* §02 Order-ID-card CTA, two states. Live correctly hides it once the
              card is delivered — the design draws no delivered state, so that
              stays. */}
          {!delivered ? (
            inCart ? (
              <div className="flex items-center gap-3 rounded-2xl border border-[rgba(14,107,97,.2)] bg-[var(--color-mint)] px-3.5 py-3">
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-[var(--color-surface-1)] text-[#0A514A]">
                  <Check size={20} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#0A514A]">{tDetail('inCart')}</p>
                  {qrCardPrice !== null ? (
                    <p className="text-xs text-[#0A514A] opacity-80 tabular-nums">
                      {tDetail('cardInCartSub', {
                        count: formatNumber(1, locale),
                        amount: formatCurrency(qrCardPrice, locale),
                      })}
                    </p>
                  ) : null}
                </div>
                <Link
                  href="/orders"
                  className="shrink-0 rounded-full bg-[#0E6B61] px-3 py-1.5 text-[13px] font-semibold text-[#FFFDF8]"
                >
                  {tCart('toast.viewCart')}
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[#CDB98A] bg-[var(--color-surface-1)] px-3.5 py-3">
                <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl bg-[#F4EBD7] text-[#9A6B1F]">
                  <CreditCard size={20} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {tDetail('cardTitle')}
                  </p>
                  {/* The price is the REAL configured number
                      (platform_config.qr_card_price, code default when the row
                      is absent — which it is). When the read fails the clause is
                      dropped; the design's sample 25 is never rendered. */}
                  <p className="text-xs text-[#80827A] tabular-nums">
                    {qrCardPrice !== null
                      ? tDetail('cardSubWithPrice', {
                          amount: formatCurrency(qrCardPrice, locale),
                        })
                      : tDetail('cardSub')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void onOrderCard()}
                  className="shrink-0 rounded-full bg-[#F4EBD7] px-3 py-1.5 text-[13px] font-semibold text-[#9A6B1F] btn-press chq-focus"
                >
                  {tDetail('orderAction')}
                </button>
              </div>
            )
          ) : null}
        </div>

        {/* §02 `.bottombar` — ONE primary over a scrim. Owing → Collect payment
            (the money action); settled → New payment. Both open the same collect
            modal. No bar at all without the permission — never a dead button.
            §03's "Send reminder" primary would occupy this same slot, so it is
            the `.act` Remind button above instead; two stacked bottom bars is
            not something either frame draws. */}
        {canCollect ? (
          <div className="sticky bottom-0 flex gap-2 bg-[linear-gradient(0deg,var(--color-surface-0)_70%,transparent)] px-4 pb-4 pt-3">
            <button
              type="button"
              onClick={() => {
                setCollectAmount(owes ? String(Math.round(balance ?? 0)) : '');
                setShowCollect(true);
              }}
              className="btn-lift flex h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0E6B61] text-[15px] font-semibold text-[#FFFDF8] shadow-sm btn-press chq-focus"
            >
              {owes ? <CreditCard size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
              {owes ? tp('collectPayment') : tp('newPayment')}
            </button>
          </div>
        ) : null}
      </div>

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
                  {(['cash', 'instapay'] as const).map((m) => (
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

      {/* ID card quick action modal — same QRCard preview + download/print pair
          the roster page's View QR modal already uses. */}
      {showIdCard && student && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => {
            setShowIdCard(false);
            setIdCardDataUrl(null);
          }}
          role="presentation"
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border)] p-6 max-w-sm mx-4 w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('viewQR')}</h3>
              <button
                type="button"
                onClick={() => {
                  setShowIdCard(false);
                  setIdCardDataUrl(null);
                }}
                className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] btn-press chq-focus"
              >
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="flex justify-center mb-5">
              <div className="w-full max-w-[320px] rounded-2xl overflow-hidden shadow-xl">
                <QRCard
                  student={student}
                  qrDataUrl={idCardDataUrl}
                  centerLogo={centerInfo?.logo_url ?? null}
                  centerName={centerInfo?.name ?? 'TutoringHQ'}
                  scale={1.2}
                  variant="preview"
                />
              </div>
            </div>
            <div className="text-center mb-4">
              <div className="font-bold text-[var(--color-text-primary)]">{student.name}</div>
              <div className="font-mono text-sm text-[var(--color-text-secondary)]">
                {formatStudentNumberForDisplay(student.student_number)}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadIdCard}
                disabled={!idCardDataUrl}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50 btn-press chq-focus"
              >
                <Download size={14} /> {tCommon('download')}
              </button>
              <button
                type="button"
                onClick={printIdCard}
                disabled={!idCardDataUrl}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 btn-press chq-focus"
              >
                <Printer size={14} /> {tCommon('print')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print statement — moved off the (undrawn) body CTA row into the
          top-bar kebab, same modal the roster uses. */}
      {showPrintStatement ? (
        <PrintStatementModal
          studentId={student.id}
          studentName={student.name}
          isOpen
          onClose={() => setShowPrintStatement(false)}
        />
      ) : null}

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
