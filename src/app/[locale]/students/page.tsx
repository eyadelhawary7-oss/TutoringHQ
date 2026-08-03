'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import {
  AlertCircle,
  Check,
  CreditCard,
  Download,
  EllipsisVertical,
  MessageCircle,
  Plus,
  QrCode,
  Search,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { KpiCard } from '@/components/shared';
import { QRCard } from '@/components/QRCard';
import { PrintStatementModal } from '@/components/PrintStatementModal';
import { AtRiskPanel } from '@/components/students/AtRiskPanel';
import { StandingBadge, standingAvatarClass } from '@/components/students/StandingBadge';
import { SwipeRow } from '@/components/students/SwipeRow';
import { FamilyLinkingSection } from '@/components/students/FamilyLinkingSection';
import { useUser } from '@/contexts/UserContext';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useToast } from '@/components/ui/ToastProvider';
import { useBranchStore } from '@/stores/branchStore';
import { getCsrfHeaders } from '@/lib/csrf-client';
import {
  ANNOUNCEMENT_WARN_THRESHOLD,
  BLAST_PRICE_PER_PARENT,
  getAnnouncementCap,
} from '@/lib/parentPack';
import { formatCurrency, formatNumber, formatPlainInteger } from '@/lib/formatNumber';
import { getStudentBalances, sumOutstanding, type StudentBalance } from '@/lib/studentBalance';
import {
  cairoDaysSince,
  deriveStanding,
  getStudentStandings,
  isBehind,
  type Standing,
  type StudentStandingRow,
} from '@/lib/studentStanding';
import { formatStudentNumberForDisplay } from '@/lib/studentNumberDisplay';
import { initialsOf } from '@/lib/initials';
import { memoryCacheGet, memoryCacheSet } from '@/lib/clientMemoryCache';

// In-memory only (tab-scoped). The roster carries PII (names, phones, parent
// phones) and must never be written to sessionStorage/localStorage.
const STUDENTS_CACHE_KEY = 'chq_students_cache';

/**
 * Merged-Center-Students §01/§03 draw ONE responsive column at every width — no
 * desktop table, no pager. `filteredStudents` is already fully in memory (the
 * fetch is unpaged), so removing pagination is a render cost, not a fetch cost;
 * this caps the mapped list and offers an explicit "show more" past it rather
 * than shipping an unbounded roster into the DOM.
 */
const ROSTER_RENDER_CHUNK = 200;

/**
 * Filter chips, Merged-Center-Students §01 (`.chip` / `.chip.on` / `.chip.sm`).
 *
 *   .chip    { font-size:13px; font-weight:600; padding:8px 16px; border-radius:999px;
 *              background:#F2EEE5; color:#5D635C; border:1px solid transparent }
 *   .chip.on { background:#DFEEEB; color:#0A514A; border-color:rgba(14,107,97,.2) }
 *   .chip.sm { font-size:12px; padding:8px 12px }
 *
 * The selected chip is a MINT fill with accent-deep ink, not a solid teal with
 * white text. On a roster where a filter is almost always active, the old solid
 * fill made the chip row compete with the primary action for attention.
 *
 * `border` sits on both states, transparent when off, so selecting a chip does
 * not change its width and the row never re-flows.
 *
 * Three chip rows render from these — subjects, lifecycle, and the "all groups"
 * lead — and they had drifted into three near-identical copies of the same
 * ternary. One definition each instead.
 */
const CHIP_BASE =
  'shrink-0 rounded-pill border font-semibold transition-colors duration-150 btn-press chq-focus';
const CHIP_OFF =
  'bg-[var(--color-tile)] text-[var(--color-mid)] border-transparent hover:bg-[var(--color-mint)]';
const CHIP_ON =
  'bg-[var(--color-mint)] text-[var(--color-accent-deep)] border-[var(--color-accent)]/20';

/** `.chip` — subject row. */
function chipClass(on: boolean) {
  return `${CHIP_BASE} px-4 py-2 text-base ${on ? CHIP_ON : CHIP_OFF}`;
}

interface Student {
  id: string;
  name: string;
  phone: string;
  parent_phone?: string | null;
  parent_consent_given?: boolean;
  parent_pack_opted_in?: boolean;
  subject: string;
  fee: number;
  payment_status: string;
  student_number?: string;
  qr_code?: string | null;
  grade_level?: string | null;
  is_active?: boolean;
  lifecycle_status?: 'enrolled' | 'active' | 'at_risk' | 'inactive' | 'churned';
  sibling_family_id?: string | null;
  /** students.created_at — NOT NULL live; drives the "New" standing + "joined Nd ago". */
  created_at?: string | null;
}

interface Subject {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  subject: string | null;
  fee_per_class?: number;
}

/**
 * Merged-Center-Students §03 `.seg` — a THREE-way segmented control replacing
 * §01's four standing chips (§03 is the later frame of the same screen, so it
 * wins). Behind = at_risk + overdue; Paid up = paid + new.
 *
 * The six-way lifecycle chip row it replaces filtered on
 * `students.lifecycle_status`, which no code path maintains for payment
 * standing. The column still exists and is still written by
 * /api/students/lifecycle — this screen simply stops reading it.
 */
type Segment = 'all' | 'behind' | 'paid_up';

const STANDING_LABEL_KEY: Record<Standing, 'standing_paid' | 'standing_at_risk' | 'standing_overdue' | 'standing_new'> = {
  paid: 'standing_paid',
  at_risk: 'standing_at_risk',
  overdue: 'standing_overdue',
  new: 'standing_new',
};

/** `intlDigits` contract shared with the detail page: digits, country-code-prefixed, no '+'. */
function intlDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('20')) return d;
  if (d.startsWith('0')) return `20${d.slice(1)}`;
  return `20${d}`;
}

function readStudentsCache(): Student[] | null {
  if (typeof window === 'undefined') return null;
  return memoryCacheGet<Student[]>(STUDENTS_CACHE_KEY);
}

export default function StudentsPage() {
  const locale = useLocale();
  const ts = useTranslations('students');
  const tEmpty = useTranslations('emptyStates');
  const tCart = useTranslations('cart');
  const router = useRouter();
  const tCommon = useTranslations('common');
  const tToast = useTranslations('toasts');
  const tConsent = useTranslations('guardianConsent');
  const tp = useTranslations('payments');
  const { user, hasPermission, refreshUser } = useUser();
  const canViewPayments =
    user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin' || hasPermission('can_view_payments');
  // `addItem`/`activeItemCount` fed the per-row cart action and the "Order cards"
  // link, neither of which the design draws (`/orders` keeps its sidebar entry).
  // Batch add survives because multi-select survives — see the bulk bar.
  const { addItemsBatch, isStudentInCart } = useCardOrderCart();
  const { toast } = useToast();

  const [students, setStudents] = useState<Student[] | null>(() => readStudentsCache());
  const [studentsListFresh, setStudentsListFresh] = useState(false);
  const [printStudent, setPrintStudent] = useState<{ id: string; name: string } | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentGroupsMap, setStudentGroupsMap] = useState<Record<string, { names: string[]; fees: number[]; subjects: string[]; groupIds: string[] }>>({});
  const [balanceByStudent, setBalanceByStudent] = useState<Record<string, number>>({});
  // Full balance rows, kept alongside the id→number map so the roster tile can
  // sum through sumOutstanding() rather than re-implementing the arithmetic.
  // null = balances have not loaded yet (distinct from "loaded, nobody owes").
  const [balanceRows, setBalanceRows] = useState<StudentBalance[] | null>(null);
  // Standing rows (§01/§03) — balance PLUS the age of the oldest open charge,
  // which getStudentBalances cannot provide. null = not loaded yet.
  const [standingRows, setStandingRows] = useState<Map<string, StudentStandingRow> | null>(null);
  // True when the balance/standing fold threw. The roster then keeps its chip
  // column EMPTY (a defaulted mint "Paid" chip nobody verified is fake success
  // on a money surface) and an inline strip says so — a console.error alone
  // left the failure invisible and every row wearing "Paid" forever.
  const [standingsFailed, setStandingsFailed] = useState(false);
  const [overdueAfterDays, setOverdueAfterDays] = useState<number | undefined>(undefined);
  const [newStudentDays, setNewStudentDays] = useState<number | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('all');
  const [filterKey, setFilterKey] = useState(0);
  const [showAddModal, setShowAddModal] = useState(false);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [renderLimit, setRenderLimit] = useState(ROSTER_RENDER_CHUNK);
  // Collect payment, opened from the row swipe (§01's masthead names "pay" as
  // the first swipe action; the roster had no money action at all before).
  const [collectTarget, setCollectTarget] = useState<Student | null>(null);
  const [collectAmount, setCollectAmount] = useState('');
  // cash | instapay only: the two values that pass BOTH the collect route's
  // allowlist AND the live payments_method_check constraint (verified in
  // pg_constraint — 'bank_transfer' is not in it and every such insert 500s).
  const [collectMethod, setCollectMethod] = useState<'cash' | 'instapay'>('cash');
  const [collectSubmitting, setCollectSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    phone: '',
    parentPhone: '',
    subjectId: '',
    monthlyFee: '',
    groupId: '',
    parentPackOptIn: false,
    guardianConsent: false,
  });
  const [showParentSectionAdd, setShowParentSectionAdd] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [createGroupForm, setCreateGroupForm] = useState({ name: '', subjectId: '', fee: '' });
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [qrModalStudent, setQrModalStudent] = useState<Student | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editParentPhone, setEditParentPhone] = useState('');
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [editSiblingFamilyId, setEditSiblingFamilyId] = useState<string | null>(null);
  const [editParentPackOptIn, setEditParentPackOptIn] = useState(false);
  const [showParentSectionEdit, setShowParentSectionEdit] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [announcementBlastType, setAnnouncementBlastType] = useState<'ops' | 'promo' | null>(null);
  const [announcementMessage, setAnnouncementMessage] = useState('');
  const [announcementSubmitting, setAnnouncementSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Student | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [centerInfo, setCenterInfo] = useState<{
    name?: string;
    logo_url?: string;
    phone?: string;
    governorate?: string;
    delivery_address?: Record<string, unknown>;
    parent_pack_enabled?: boolean;
    plan?: string;
    announcement_balance?: string | number;
    parent_pack_active_parents?: number;
  } | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const rowMenuRef = useRef<HTMLDivElement>(null);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [studentCardDelivered, setStudentCardDelivered] = useState<Record<string, boolean>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const addToggling = (id: string) => setTogglingIds((prev) => new Set(prev).add(id));
  const removeToggling = (id: string) =>
    setTogglingIds((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });

  useEffect(() => {
    if (rowMenuId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRowMenuId(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rowMenuRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('[data-row-menu-trigger]')) return;
      setRowMenuId(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [rowMenuId]);

  useEffect(() => {
    const loadStudents = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const meRes = await fetch('/api/me', {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        const meData = await meRes.json().catch(() => null);

        if (!meData?.user?.center_id) return;
        setCenterId(meData.user.center_id);
        setCenterInfo(
          meData.user.center
            ? {
                name: meData.user.center.name,
                logo_url: meData.user.center.logo_url,
                phone: meData.user.center.phone,
                governorate: meData.user.center.governorate,
                delivery_address: meData.user.center.delivery_address,
                parent_pack_enabled: meData.user.center.parent_pack_enabled,
                plan: meData.user.center.plan,
                announcement_balance: meData.user.center.announcement_balance,
                parent_pack_active_parents: meData.user.center.parent_pack_active_parents,
              }
            : null
        );

        const { data } = await dbSelect({
          table: 'students',
          select:
            // created_at feeds the §01 "New" standing and its "joined Nd ago"
            // meta segment. NOT NULL on students, confirmed in
            // information_schema.columns before it was added here.
            'id, name, phone, parent_phone, parent_consent_given, parent_pack_opted_in, subject, fee, payment_status, student_number, qr_code, grade_level, is_active, lifecycle_status, sibling_family_id, created_at, center_id',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        });

        const list = Array.isArray(data) ? (data as Student[]) : [];
        setStudents(list);
        memoryCacheSet(STUDENTS_CACHE_KEY, list);
        setStudentsListFresh(true);
      } catch (err) {
        console.error('[students] loadStudents failed', err);
        setStudents((prev) => prev ?? []);
        setStudentsListFresh(true);
      }
    };

    loadStudents();
  }, []);

  // The two standing thresholds live in platform_config (key/value — no DDL).
  // Both rows are absent today, so the code defaults in studentStanding.ts
  // apply; a failed read simply leaves them undefined and those defaults stand.
  useEffect(() => {
    if (!centerId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch('/api/students/ui-config', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { overdueAfterDays?: number; newStudentDays?: number };
        if (cancelled) return;
        if (typeof j.overdueAfterDays === 'number') setOverdueAfterDays(j.overdueAfterDays);
        if (typeof j.newStudentDays === 'number') setNewStudentDays(j.newStudentDays);
      } catch {
        /* defaults stand */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centerId]);

  useEffect(() => {
    if (groups.length === 0) return;
    const loadBalanceData = async () => {
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json().catch(() => null);
      if (!meData?.user?.center_id) return;
      const cid = meData.user.center_id;

      // Single source of truth: the shared balance helper (group fee × attended
      // − logged payments, absent excluded, pending counted, credit shown).
      // Replaces the old inline math that charged absent scans, dropped pending
      // payments, and floored credits to zero.
      const balances = await getStudentBalances(supabase, { centerId: cid });
      const balance: Record<string, number> = {};
      for (const [sid, b] of balances) balance[sid] = b.balance;
      setBalanceByStudent(balance);
      setBalanceRows(Array.from(balances.values()));

      // Standing adds the one thing the balance helper cannot: the Cairo-day age
      // of the oldest open charge, which every "N days overdue" / "oldest N days"
      // string in §01/§02/§03 reads. Same exclusions, and the net figure runs
      // through the same computeBalance, so the two can never disagree.
      setStandingRows(await getStudentStandings(supabase, { centerId: cid }));
      setStandingsFailed(false);
      } catch (err) {
        console.error('[students] loadBalanceData failed', err);
        // Surface it: standingRows stays null, so no chip renders anywhere —
        // the strip below the search bar tells the user why (blocker fix:
        // silent catch + 'paid' default painted unverified mint badges).
        setStandingsFailed(true);
      }
    };
    loadBalanceData();
  }, [groups]);

  useEffect(() => {
    const loadSubjectsAndGroups = async () => {
      try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json().catch(() => null);
      if (!meData?.user?.center_id) return;
      const [subRes, grpRes] = await Promise.all([
        dbSelect({ table: 'subjects', select: 'id, name', filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }], order: { column: 'name' } }),
        dbSelect({ table: 'student_groups', select: 'id, name, subject, fee_per_class', filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }], order: { column: 'name' } }),
      ]);
      if (subRes.data) setSubjects(subRes.data as Subject[]);
      if (grpRes.data) {
        const grps = grpRes.data as Group[];
        setGroups(grps);
        const groupIds = grps.map((g) => g.id);
        if (groupIds.length > 0) {
          const { data: membersData } = await dbSelect({
            table: 'student_group_members',
            select: 'student_id, group_id',
            filters: [{ column: 'group_id', op: 'in', value: groupIds }],
          });
          const map: Record<string, { names: string[]; fees: number[]; subjects: string[]; groupIds: string[] }> = {};
          for (const m of (membersData || []) as { student_id: string; group_id: string }[]) {
            const g = grps.find((x) => x.id === m.group_id);
            if (g) {
              if (!map[m.student_id]) map[m.student_id] = { names: [], fees: [], subjects: [], groupIds: [] };
              map[m.student_id].names.push(g.name);
              map[m.student_id].fees.push(g.fee_per_class ?? 0);
              map[m.student_id].groupIds.push(g.id);
              if (g.subject && !map[m.student_id].subjects.includes(g.subject)) {
                map[m.student_id].subjects.push(g.subject);
              }
            }
          }
          setStudentGroupsMap(map);
        }
      }
      } catch (err) {
        console.error('[students] loadSubjectsAndGroups failed', err);
      }
    };
    loadSubjectsAndGroups();
  }, []);

  const distinctSubjects = useMemo(() => {
    const subs = new Set<string>();
    for (const g of groups) {
      if (g.subject) subs.add(g.subject);
    }
    return Array.from(subs).sort();
  }, [groups]);

  const studentsList = useMemo(() => students ?? [], [students]);
  const studentsStale = Boolean(students !== null && !studentsListFresh);

  /**
   * The roster's "who is behind" tile — both halves from ONE source.
   *
   * Design (Merged-Center-Students §01) shows "Unpaid · 14 · 4,200 EGP due".
   * Count and amount must describe the same students or the tile contradicts
   * itself, so both derive from the balance helper: count = students with a
   * positive balance, amount = sumOutstanding() over those same rows (positives
   * only — one student's credit never cancels another's debt).
   *
   * NOT students.payment_status. That column defaults to 'unpaid' and no code
   * path ever updates it (verified against the live catalog and every write
   * site), so counting it renders "unpaid = total headcount" on every roster.
   *
   * null until balances load — an unknown amount is shown as unknown, never 0.
   */
  const unpaid = useMemo(() => {
    if (balanceRows === null) return null;
    const behind = balanceRows.filter((b) => b.balance > 0);
    return { count: behind.length, amount: sumOutstanding(behind) };
  }, [balanceRows]);

  /**
   * Standing per student (§01 badge / §03 segmentation), from the shared fold.
   *
   * Until the standing query lands every row reads 'paid' — the neutral state —
   * rather than flashing a debt badge nobody has verified yet. `deriveStanding`
   * is the ONE place the four states are decided; the roster never re-derives.
   */
  const standingById = useMemo(() => {
    const map = new Map<string, Standing>();
    if (standingRows === null) return map;
    const now = new Date();
    for (const s of studentsList) {
      const row = standingRows.get(s.id);
      if (!row) continue;
      map.set(
        s.id,
        deriveStanding(row, now, { overdueAfterDays, newStudentDays }),
      );
    }
    return map;
  }, [standingRows, studentsList, overdueAfterDays, newStudentDays]);

  const standingOf = useCallback(
    (id: string): Standing => standingById.get(id) ?? 'paid',
    [standingById],
  );

  /**
   * §03's amber alert: how many are behind, what they owe in total, and how old
   * the oldest debt is. All three come from the same standing fold, so the
   * headline count and the money underneath can never describe different people.
   * Renders nothing at zero.
   */
  const behindSummary = useMemo(() => {
    if (standingRows === null) return null;
    let count = 0;
    let oldestDays = 0;
    const rows: StudentBalance[] = [];
    for (const s of studentsList) {
      const row = standingRows.get(s.id);
      if (!row || !isBehind(standingOf(s.id))) continue;
      count += 1;
      oldestDays = Math.max(oldestDays, row.oldestUnpaidDays ?? 0);
      rows.push({ studentId: s.id, charge: row.charge, paid: row.paid, balance: row.balance });
    }
    return { count, oldestDays, total: sumOutstanding(rows) };
  }, [standingRows, studentsList, standingOf]);

  const filteredStudents = useMemo(() => {
    return studentsList.filter((s) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = s.name?.toLowerCase().includes(q);
        const qNum = q.replace(/^#/, '').toUpperCase();
        const matchNumber = (s.student_number ?? '')
          .replace(/^#/, '')
          .toUpperCase()
          .includes(qNum);
        const matchPhone = (s.phone || '').includes(q);
        if (!matchName && !matchNumber && !matchPhone) return false;
      }
      if (subjectFilter) {
        const subs = studentGroupsMap[s.id]?.subjects ?? [];
        if (!subs.includes(subjectFilter)) return false;
      }
      if (segment === 'behind' && !isBehind(standingOf(s.id))) return false;
      if (segment === 'paid_up' && isBehind(standingOf(s.id))) return false;
      return true;
    });
  }, [studentsList, searchQuery, subjectFilter, segment, studentGroupsMap, standingOf]);

  /**
   * §03 splits the ALL segment into a BEHIND group over an ALL STUDENTS group.
   * Behind / Paid up render flat, with no group label — as drawn.
   */
  const groupedStudents = useMemo(() => {
    const capped = filteredStudents.slice(0, renderLimit);
    if (segment !== 'all') return [{ labelKey: null as string | null, rows: capped }];
    const behind = capped.filter((s) => isBehind(standingOf(s.id)));
    const rest = capped.filter((s) => !isBehind(standingOf(s.id)));
    const out: { labelKey: string | null; rows: Student[] }[] = [];
    if (behind.length > 0) out.push({ labelKey: 'groupBehind', rows: behind });
    if (rest.length > 0) out.push({ labelKey: behind.length > 0 ? 'groupAll' : null, rows: rest });
    return out;
  }, [filteredStudents, segment, standingOf, renderLimit]);

  useEffect(() => {
    if (!centerId || studentsList.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;
        const ids = studentsList.map((s) => s.id);
        const res = await fetch('/api/card-order-cart/student-card-status', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok || cancelled) return;
        const j = (await res.json()) as { statusByStudentId?: Record<string, string> };
        const map: Record<string, boolean> = {};
        for (const [id, st] of Object.entries(j.statusByStudentId ?? {})) {
          map[id] = st === 'delivered';
        }
        if (!cancelled) setStudentCardDelivered(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [centerId, studentsList]);

  const toggleBulkStudent = useCallback((id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bulkAddToCart = useCallback(async () => {
    const ids = [...bulkSelected].filter((id) => !isStudentInCart(id) && !studentCardDelivered[id]);
    if (ids.length === 0) return;
    setBulkSubmitting(true);
    try {
      await addItemsBatch(ids.map((student_id) => ({ kind: 'student' as const, student_id })));
      toast.success(tCart('toast.added'));
      setBulkSelected(new Set());
    } catch {
      toast.error(tToast('error'));
    } finally {
      setBulkSubmitting(false);
    }
  }, [bulkSelected, isStudentInCart, studentCardDelivered, addItemsBatch, toast, tCart, tToast]);

  useEffect(() => {
    setRenderLimit(ROSTER_RENDER_CHUNK);
  }, [searchQuery, subjectFilter, segment]);

  /**
   * §01 meta + KPI sub-label: how many branches this center belongs to.
   * A "branch" is a `centers` row sharing an `organizations.id` — there is no
   * `branches` table. BranchSwitcher already hydrates this store from
   * GET /api/branches, which returns the single own-center array with
   * plan:'single' when the center has no organization_id (0 of 2 live).
   * Falls back to 1 — the center itself — never to the design's sample 3.
   */
  const branches = useBranchStore((s) => s.branches);
  const branchCount = Math.max(1, branches.length);

  /**
   * Collect payment from a roster row — the SAME server-gated endpoint the
   * detail page posts to (POST /api/payments/collect, center forced server-side,
   * CSRF headers attached). No new money path is introduced here.
   */
  const handleRosterCollect = useCallback(async () => {
    const target = collectTarget;
    if (!target) return;
    const amount = Number.parseFloat(collectAmount.replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(tToast('error'), tCommon('error'));
      return;
    }
    setCollectSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
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
        body: JSON.stringify({ student_id: target.id, amount, method: collectMethod, group_id: null }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || tCommon('error'));
      toast.success(tToast('saved'));
      setCollectTarget(null);
      setCollectAmount('');
      setCollectMethod('cash');
      // Re-fold balances AND standings so the row's money column and badge move
      // together — never one without the other.
      if (centerId) {
        const balances = await getStudentBalances(supabase, { centerId });
        const next: Record<string, number> = {};
        for (const [sid, b] of balances) next[sid] = b.balance;
        setBalanceByStudent(next);
        setBalanceRows(Array.from(balances.values()));
        setStandingRows(await getStudentStandings(supabase, { centerId }));
      }
    } catch (err) {
      toast.error(tToast('error'), err instanceof Error ? err.message : tCommon('error'));
    } finally {
      setCollectSubmitting(false);
    }
  }, [collectTarget, collectAmount, collectMethod, centerId, toast, tToast, tCommon]);

  const activeParentsForAnnounce =
    user?.center?.parent_pack_active_parents ?? centerInfo?.parent_pack_active_parents ?? 0;
  const canSendAnnouncement =
    (user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin') && activeParentsForAnnounce > 0;
  const announcementPlan = user?.center?.plan ?? centerInfo?.plan ?? 'starter';
  const announcementBalanceNum = Number(
    user?.center?.announcement_balance ?? centerInfo?.announcement_balance ?? 0,
  );
  const announcementCap = getAnnouncementCap(announcementPlan);
  const announcementCapWarning =
    announcementBalanceNum >= announcementCap * ANNOUNCEMENT_WARN_THRESHOLD;
  const announcementCapReached = announcementBalanceNum >= announcementCap;

  const handlePackToggle = async (student: Student) => {
    if (togglingIds.has(student.id)) return;
    const newValue = !student.parent_pack_opted_in;
    const prevOpted = student.parent_pack_opted_in ?? false;
    setStudents((prev) =>
      (prev ?? []).map((s) => (s.id === student.id ? { ...s, parent_pack_opted_in: newValue } : s)),
    );
    addToggling(student.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setStudents((prev) =>
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, parent_pack_opted_in: prevOpted } : s)),
        );
        return;
      }
      const res = await fetch(`/api/parent-pack/student/${student.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ parent_pack_opted_in: newValue }),
      });
      if (!res.ok) {
        setStudents((prev) =>
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, parent_pack_opted_in: prevOpted } : s)),
        );
        toast.error(ts('packOptInError'));
        return;
      }
      await refreshUser();
    } finally {
      removeToggling(student.id);
    }
  };

  const openQRModal = async (student: Student) => {
    setQrModalStudent(student);
    setQrDataUrl(null);
    try {
      let dataUrl = student.qr_code;
      if (!dataUrl) {
        dataUrl = await QRCode.toDataURL(student.id, {
          width: 300,
          margin: 2,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        await dbUpdate({
          table: 'students',
          data: { qr_code: dataUrl },
          filters: [{ column: 'id', op: 'eq', value: student.id }],
        });
        setStudents((prev) =>
          (prev ?? []).map((s) => (s.id === student.id ? { ...s, qr_code: dataUrl } : s))
        );
      }
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('QR generation error:', err);
    }
  };

  const handleRegenerateQR = async () => {
    if (!qrModalStudent || !confirm(ts('regenerateQRConfirm', { defaultValue: 'This will invalidate the printed card. Are you sure?' }))) return;
    try {
      const dataUrl = await QRCode.toDataURL(qrModalStudent.id, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      await dbUpdate({
        table: 'students',
        data: { qr_code: dataUrl },
        filters: [{ column: 'id', op: 'eq', value: qrModalStudent.id }],
      });
      setStudents((prev) =>
        (prev ?? []).map((s) => (s.id === qrModalStudent.id ? { ...s, qr_code: dataUrl } : s))
      );
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('QR regenerate error:', err);
    }
  };

  const downloadQR = () => {
    if (!qrDataUrl || !qrModalStudent) return;
    const link = document.createElement('a');
    const numForFile = (qrModalStudent.student_number || qrModalStudent.id).replace(/^#/, '');
    link.download = `QR-${qrModalStudent.name}-${numForFile}.png`;
    link.href = qrDataUrl;
    link.click();
  };

  const printCard = () => {
    if (!qrDataUrl || !qrModalStudent) return;
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
            <div class="qr-wrap"><img src="${qrDataUrl}" alt="QR" /></div>
            <div class="name">${esc(qrModalStudent.name)}</div>
            <div class="num">${esc(formatStudentNumberForDisplay(qrModalStudent.student_number))}</div>
          </div>
          <div class="bottom">TutoringHQ</div>
        </div>
      </body></html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const openEdit = (s: Student) => {
    setEditStudent(s);
    setEditName(s.name || '');
    setEditPhone(s.phone || '');
    setEditParentPhone(s.parent_phone || '');
    setEditGroups(studentGroupsMap[s.id]?.groupIds ?? []);
    setEditSiblingFamilyId(s.sibling_family_id ?? null);
    setEditParentPackOptIn(s.parent_pack_opted_in === true);
    setShowParentSectionEdit(false);
  };

  function normalizeParentPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('01')) return '+2' + digits;
    if (digits.length === 10 && digits.startsWith('1')) return '+2' + digits;
    if (phone.startsWith('+')) return phone;
    return digits.length >= 10 ? '+2' + digits.slice(-10) : phone;
  }

  const saveEdit = async () => {
    if (!editStudent || !centerId) return;
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
          sibling_family_id: editSiblingFamilyId,
          parent_pack_opted_in: editParentPackOptIn,
          parent_consent_given: editParentPackOptIn,
          parent_consent_at: consentAt,
        },
        filters: [{ column: 'id', op: 'eq', value: editStudent.id }],
      });
      await dbDelete({ table: 'student_group_members', filters: [{ column: 'student_id', op: 'eq', value: editStudent.id }] });
      for (const gid of editGroups) {
        await dbInsert({ table: 'student_group_members', data: { student_id: editStudent.id, group_id: gid }, select: false });
      }
      if (parentPhoneNorm) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          try {
            await fetch('/api/parents/request-consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ student_id: editStudent.id, parent_phone: parentPhoneNorm }),
            });
          } catch {}
        }
      }
      const updatedGroups = groups.filter((g) => editGroups.includes(g.id));
      setStudentGroupsMap((prev) => ({
        ...prev,
        [editStudent.id]: {
          names: updatedGroups.map((g) => g.name),
          fees: updatedGroups.map((g) => g.fee_per_class ?? 0),
          subjects: [...new Set(updatedGroups.map((g) => g.subject).filter(Boolean))] as string[],
          groupIds: editGroups,
        },
      }));
      setStudents((prev) =>
        (prev ?? []).map((s) =>
          s.id === editStudent.id
            ? {
                ...s,
                name: editName.trim(),
                phone: editPhone.trim(),
                parent_phone: parentPhoneNorm ?? s.parent_phone,
                sibling_family_id: editSiblingFamilyId,
                parent_pack_opted_in: editParentPackOptIn,
                parent_consent_given: editParentPackOptIn,
              }
            : s
        )
      );
      setEditStudent(null);
    } catch (err) {
      console.error('Edit student error:', err);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const cid = meData?.user?.center_id;
    const userId = meData?.user?.id;
    if (!cid || !userId) return;
    try {
      await dbDelete({ table: 'student_group_members', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      await dbDelete({ table: 'attendance_scans', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      await dbDelete({ table: 'payments', filters: [{ column: 'student_id', op: 'eq', value: student.id }] });
      const { error } = await dbDelete({ table: 'students', filters: [{ column: 'id', op: 'eq', value: student.id }] });
      if (!error) {
        setStudents((prev) => (prev ?? []).filter((s) => s.id !== student.id));
        await auditLog({ centerId: cid, userId, action: 'student_delete', entityType: 'students', entityId: student.id, details: { name: student.name } });
      }
    } catch (err) {
      console.error('Delete student error:', err);
    }
  };

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const centerId = meData?.user?.center_id;
    const userId = meData?.user?.id;
    if (!centerId || !userId || !addForm.name.trim()) {
      toast.error(ts('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }
    if (!addForm.groupId) {
      toast.error(ts('groupRequiredError'));
      return;
    }
    if (!addForm.guardianConsent) {
      toast.error(tConsent('required'));
      return;
    }
    setIsAdding(true);
    try {
      const selectedGroup = groups.find((g) => g.id === addForm.groupId);
      const subjectValue = selectedGroup?.subject ?? subjects.find((s) => s.id === addForm.subjectId)?.name ?? null;
      const parentPhoneNorm = addForm.parentPhone.trim()
        ? normalizeParentPhone(addForm.parentPhone.trim())
        : null;
      const packEnabled = meData?.user?.center?.parent_pack_enabled === true;
      const optedIn = packEnabled && addForm.parentPackOptIn;
      // Fee comes from group (groups.fee_per_class), not from students table
      const insertPayload = {
        center_id: centerId,
        name: addForm.name.trim(),
        phone: addForm.phone.trim() || null,
        parent_phone: parentPhoneNorm,
        subject: subjectValue,
        payment_status: 'unpaid' as const,
        parent_pack_opted_in: optedIn,
        parent_consent_given: optedIn,
        parent_consent_at: optedIn ? new Date().toISOString() : null,
        // Server verifies this and stamps guardian_consent_confirmed_at/_by.
        guardian_consent_confirmed: addForm.guardianConsent,
      };
      const { data: inserted, error } = await dbInsert({
        table: 'students',
        data: insertPayload,
        select: '*',
      });
      if (error) {
        const errMsg = typeof error === 'object' && error !== null && 'message' in error
          ? (error as { message: string }).message
          : String(error);
        console.error('[AddStudent] Supabase insert failed:', errMsg, insertPayload);
        throw new Error(errMsg);
      }
      const student = Array.isArray(inserted) ? inserted[0] : inserted;
      if (!student?.id) throw new Error('Insert failed');
      const studentNumber = (student as Student).student_number ?? '';
      let qrDataURL: string | undefined;
      try {
        qrDataURL = await QRCode.toDataURL(student.id, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
        await dbUpdate({ table: 'students', data: { qr_code: qrDataURL }, filters: [{ column: 'id', op: 'eq', value: student.id }] });
      } catch {}
      if (addForm.groupId) {
        await dbInsert({
          table: 'student_group_members',
          data: { group_id: addForm.groupId, student_id: student.id },
          select: false,
        });
      }
      if (parentPhoneNorm) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            await fetch('/api/parents/request-consent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ student_id: student.id, parent_phone: parentPhoneNorm }),
            });
          }
        } catch {}
      }
      await auditLog({ centerId, userId, action: 'student_create', entityType: 'students', entityId: student.id, details: { name: addForm.name, student_number: studentNumber } });
      const addedGroup = groups.find((g) => g.id === addForm.groupId);
      if (addedGroup) {
        setStudentGroupsMap((prev) => ({
          ...prev,
          [student.id]: {
            names: [addedGroup.name],
            fees: [addedGroup.fee_per_class ?? 0],
            subjects: addedGroup.subject ? [addedGroup.subject] : [],
            groupIds: [addedGroup.id],
          },
        }));
      }
      setStudents((prev) => [{ ...student, student_number: studentNumber } as Student, ...(prev ?? [])]);
      toast.success(ts('addStudentSuccess', { name: addForm.name.trim(), studentNumber: formatStudentNumberForDisplay(studentNumber) || studentNumber }));
      setAddForm({ name: '', phone: '', parentPhone: '', subjectId: '', monthlyFee: '', groupId: '', parentPackOptIn: false, guardianConsent: false });
      setShowParentSectionAdd(false);
      setShowAddModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: string }).message) : 'Failed to add student');
      toast.error(tToast('error'), msg);
    } finally {
      setIsAdding(false);
    }
  };

  const errorDetail = (err: unknown): string =>
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: string }).message)
        : 'Failed to create group';

  const handleCreateGroupQuick = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
    const meData = await meRes.json();
    const cid = meData?.user?.center_id;
    const uid = meData?.user?.id;
    if (!cid || !uid) return;

    if (!createGroupForm.name.trim()) {
      toast.error(ts('add.groupNameRequired'));
      return;
    }
    if (!createGroupForm.subjectId) {
      toast.error(ts('add.groupSubjectRequired'));
      return;
    }
    const fee = Number(createGroupForm.fee);
    if (!Number.isFinite(fee) || fee <= 0) {
      toast.error(ts('add.groupFeeRequired'));
      return;
    }

    setCreatingGroup(true);
    try {
      const subjectName = subjects.find((s) => s.id === createGroupForm.subjectId)?.name ?? '';
      const { data: inserted, error } = await dbInsert({
        table: 'student_groups',
        data: {
          center_id: cid,
          name: createGroupForm.name.trim(),
          subject: subjectName,
          fee_per_class: fee,
          center_cut_egp: 0,
          max_capacity: null,
        },
        single: true,
      });
      if (error || !inserted) {
        toast.error(tToast('error'), errorDetail(error));
        return;
      }
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      await auditLog({ centerId: cid, userId: uid, action: 'group_create', entityType: 'student_groups', entityId: row.id, details: { name: row.name } });
      const newGroup: Group = { id: row.id, name: createGroupForm.name.trim(), subject: subjectName, fee_per_class: fee };
      setGroups((prev) => [...prev, newGroup]);
      setAddForm((f) => ({ ...f, groupId: newGroup.id, subjectId: createGroupForm.subjectId, monthlyFee: String(fee) }));
      setCreateGroupForm({ name: '', subjectId: '', fee: '' });
      setShowCreateGroup(false);
      toast.success(ts('add.groupCreated'));
    } catch (err) {
      toast.error(tToast('error'), errorDetail(err));
    } finally {
      setCreatingGroup(false);
    }
  };

  return (
    <>
      <div className="min-h-screen w-full min-w-0 overflow-x-clip bg-[var(--color-surface-0)] page-enter max-md:pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
        <div className="px-4 pt-4 pb-3 max-w-3xl mx-auto w-full">
          {/* §01/§03 `.topbar` — a 17px/600 title over a 12px meta line.
              The design's single bar also carries a hamburger and a bell; both
              are already the global shell (AppShell → MobileTopBar), so they are
              deliberately NOT duplicated here. The one divergence is the shell
              bar showing the wordmark where the design shows the page title —
              the page owns the title row instead, stacking two rows. */}
          <div
            className={`mb-3 flex items-center gap-3 transition-opacity duration-300 ${studentsStale ? 'opacity-70' : 'opacity-100'}`}
          >
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[17px] font-semibold leading-tight text-[var(--color-text-primary)]">
                {ts('title')}
              </h1>
              {/* KEPT AGAINST THE DESIGN'S COPY — its roster meta (design line
                  846) reads "142 enrolled · 8 behind". This meta keeps the
                  "{active} active · {branches} branches" form, but `active`
                  counts students.is_active: the flag /api/students/[id]
                  actually writes and the standing fold, at-risk API and import
                  already read. NOT lifecycle_status — that column is 'enrolled'
                  on every live row (column default; its sole writer is the
                  manual AtRiskPanel PATCH via /api/students/lifecycle), so
                  filtering it for 'active' rendered "0 active" over a populated
                  roster. Same source as the KPI tile below, so the two cannot
                  contradict; `branches` is the real branch count, floored at 1
                  — never the design's sample 3. */}
              <p className="mt-0.5 text-xs text-[#80827A] tabular-nums">
                {students === null
                  ? '\u00a0'
                  : ts('rosterMeta', {
                      active: formatNumber(
                        studentsList.filter((s) => s.is_active === true).length,
                        locale,
                      ),
                      branches: formatNumber(branchCount, locale),
                    })}
              </p>
            </div>
          </div>

          {/* §01 search + add: a 44px `.field` and a 44×44 `.addbtn` square. The
              button's label moves to aria-label so the control stays named. */}
          <div className="mb-3 flex items-center gap-2.5">
            <div className="flex h-11 flex-1 min-w-0 items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-3 focus-within:border-teal-500 transition-colors duration-150">
              <Search size={18} className="shrink-0 text-[var(--color-text-muted)]" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setFilterKey((k) => k + 1);
                }}
                placeholder={ts('search_placeholder')}
                className="w-full min-w-0 border-0 bg-transparent text-[13px] text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                dir="auto"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              aria-label={ts('add_student')}
              className="btn-lift grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-600 text-white shadow-sm transition-all duration-150 hover:bg-teal-700 btn-press chq-focus"
            >
              <Plus size={22} aria-hidden />
            </button>
          </div>

          {/* Fold failure is SAID, not swallowed: when the balance/standing
              load throws, every chip stays absent (see the srow memo) and this
              strip says why. Mutually exclusive with the amber alert below —
              that one needs standingRows, which a failed fold leaves null. */}
          {standingsFailed ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
              <AlertCircle size={20} className="shrink-0 text-destructive" aria-hidden />
              <p className="min-w-0 flex-1 text-[13px] text-destructive">
                {ts('standingsLoadError')}
              </p>
            </div>
          ) : null}

          {/* §03 `.alert` — the amber "N behind on payment" strip. Nothing at
              zero: an alert that always fires is not an alert. */}
          {behindSummary && behindSummary.count > 0 ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-[rgba(138,94,22,.25)] bg-[#F4EBD7] px-4 py-3">
              <AlertCircle size={20} className="shrink-0 text-[#9A6B1F]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-[#9A6B1F]">
                  {ts('behindAlertTitle', { count: formatNumber(behindSummary.count, locale) })}
                </p>
                <p className="mt-0.5 text-[11px] text-[#9A6B1F] opacity-85 tabular-nums">
                  {ts('behindAlertSub', {
                    total: formatCurrency(Math.round(behindSummary.total), locale),
                    days: formatNumber(behindSummary.oldestDays, locale),
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSegment('behind');
                  setFilterKey((k) => k + 1);
                }}
                className="shrink-0 rounded-lg bg-[#9A6B1F] px-3 py-2 text-[11px] font-bold text-[#FFFDF8] btn-press chq-focus"
              >
                {ts('behindAlertAction')}
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 mb-4">
            {students === null ? (
              <>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                  <div className="h-3 w-24 rounded bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="h-7 w-16 rounded bg-[var(--color-surface-2)] animate-pulse" />
                </div>
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-sm p-6 flex flex-col gap-2" aria-hidden>
                  <div className="h-3 w-28 rounded bg-[var(--color-surface-2)] animate-pulse" />
                  <div className="h-7 w-12 rounded bg-[var(--color-surface-2)] animate-pulse" />
                </div>
              </>
            ) : (
              <div className={`contents transition-opacity duration-300 ${studentsStale ? 'opacity-70' : 'opacity-100'}`}>
                <KpiCard
                  label={ts('active_students')}
                  // students.is_active, never lifecycle_status — same source and
                  // same reason as the topbar meta above (see that memo).
                  value={formatNumber(
                    studentsList.filter((s) => s.is_active === true).length,
                    locale,
                  )}
                  // §01: "across 3 branches". Real count from the branch store
                  // (GET /api/branches), floored at 1 — the center itself.
                  subLabel={ts('acrossBranches', {
                    count: formatNumber(branchCount, locale),
                  })}
                  tone="success"
                />
                {/* Design (Merged-Center-Students §01) leads the roster with who is
                    behind rather than a second headcount. Both figures come from
                    `unpaid` above — see that memo for why payment_status is not used. */}
                <KpiCard
                  label={ts('unpaidStudents')}
                  value={
                    unpaid === null ? (
                      <span className="inline-block h-7 w-12 rounded bg-[var(--color-surface-2)] animate-pulse align-middle" aria-hidden />
                    ) : (
                      formatNumber(unpaid.count, locale)
                    )
                  }
                  subLabel={
                    unpaid === null
                      ? undefined
                      : ts('unpaidAmountDue', {
                          amount: formatCurrency(Math.round(unpaid.amount), locale),
                        })
                  }
                  // §01 draws the unpaid tile's sub in danger ink. KpiCard's
                  // `tone` already colours the sub-label, and --color-danger IS
                  // #9C3322 (globals.css) — no new prop needed for it.
                  tone="danger"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 mb-3">
            <div className="flex flex-wrap items-center gap-2 pb-1">
              <button
                type="button"
                onClick={() => {
                  setSubjectFilter(null);
                  setFilterKey((k) => k + 1);
                }}
                className={chipClass(subjectFilter === null)}
              >
                {ts('allGroups')}
              </button>
              {distinctSubjects.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => {
                    setSubjectFilter(subjectFilter === sub ? null : sub);
                    setFilterKey((k) => k + 1);
                  }}
                  className={chipClass(subjectFilter === sub)}
                >
                  {sub}
                </button>
              ))}
            </div>

            {/* §03 `.seg` — a three-way segmented control replacing §01's
                lifecycle chips. Behind = at_risk + overdue; Paid up = paid + new.
                The design's fourth "Covered" state needs a per-student
                monthly-plan flag that does not exist (see needsMigration M2) and
                is deliberately NOT rendered. */}
            <div
              className="flex rounded-xl border border-[var(--color-border-subtle)] bg-[#F2EEE5] p-1"
              role="tablist"
              aria-label={ts('filter_all')}
            >
              {(['all', 'behind', 'paid_up'] as const).map((seg) => (
                <button
                  key={seg}
                  type="button"
                  role="tab"
                  aria-selected={segment === seg}
                  onClick={() => {
                    setSegment(seg);
                    setFilterKey((k) => k + 1);
                  }}
                  className={`flex-1 rounded-lg py-3 text-center text-xs font-semibold transition-colors duration-150 btn-press chq-focus ${
                    segment === seg
                      ? 'bg-[var(--color-surface-1)] text-[var(--color-accent-deep)] shadow-sm'
                      : 'text-[var(--color-mid)]'
                  }`}
                >
                  {ts(seg === 'all' ? 'seg_all' : seg === 'behind' ? 'seg_behind' : 'seg_paidUp')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-4 max-w-3xl mx-auto w-full space-y-4 pb-6">
          {/* KEPT AGAINST THE DESIGN, behind the alert's Review action: the
              at-risk panel carries the lifecycle <select>, which is the ONLY UI
              that can move a student out of at_risk (PATCH /api/students/lifecycle),
              and a per-student parent reminder. §03's amber alert restores the
              reminder at the detail level but nothing restores the status edit.
              Reachable only from the Behind segment so it never competes with
              the roster the design draws. */}
          {segment === 'behind' ? <AtRiskPanel /> : null}

          {students === null ? (
            /* §01 loading skeleton: a 44px search + 44 square, two KPI blocks,
               ONE chip row, then four `.srow` skeletons. The old desktop-table
               skeleton is gone with the table. */
            <div className="space-y-3" aria-busy="true">
              <div className="flex items-center gap-2.5">
                <div className="h-11 flex-1 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
                <div className="h-11 w-11 shrink-0 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[0, 1].map((i) => (
                  <div key={i} className="h-[76px] rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
                ))}
              </div>
              <div className="flex gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-8 w-20 rounded-full bg-[var(--color-surface-2)] animate-pulse" />
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3"
                  >
                    <div className="h-[38px] w-[38px] shrink-0 rounded-xl bg-[var(--color-surface-2)] animate-pulse" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-[13px] w-3/5 rounded bg-[var(--color-surface-2)] animate-pulse" />
                      <div className="h-[11px] w-4/5 rounded bg-[var(--color-surface-2)] animate-pulse" />
                    </div>
                    <div className="h-[22px] w-[58px] shrink-0 rounded-full bg-[var(--color-surface-2)] animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ) : students.length === 0 ? (
            /* §01 empty state: a 76×76 mint tile, an 18px title, a ~30ch body,
               and the two buttons pinned below. The shared EmptyState cannot
               produce this shape, so it is rendered inline in this branch only. */
            <div className="flex min-h-[52vh] flex-col">
              <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
                <div className="grid h-[76px] w-[76px] place-items-center rounded-3xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                  <Users size={34} aria-hidden />
                </div>
                <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
                  {tEmpty('students.title')}
                </h2>
                <p className="max-w-[30ch] text-[13px] leading-relaxed text-[var(--color-text-secondary)]">
                  {tEmpty('students.description')}
                </p>
              </div>
              <div className="flex flex-col gap-2.5 px-4 pb-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="btn-lift flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-teal-600 text-[15px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-teal-700 btn-press chq-focus"
                >
                  <UserPlus size={18} aria-hidden /> {tEmpty('students.action')}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/students/import')}
                  className="btn-lift flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[13px] font-semibold text-[var(--color-text-primary)] transition-all duration-150 btn-press chq-focus"
                >
                  <Upload size={18} aria-hidden /> {tEmpty('students.importAction')}
                </button>
              </div>
            </div>
          ) : (
            <div
              key={filterKey}
              className={`transition-opacity duration-300 ${studentsStale ? 'opacity-70' : 'opacity-100'}`}
            >
              {filteredStudents.length === 0 ? (
                <div className="card p-10 flex flex-col items-center gap-3 mt-4">
                  <Users size={40} className="text-[var(--color-text-tertiary)]" aria-hidden />
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">{ts('empty_title')}</p>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{ts('empty_subtitle')}</p>
                </div>
              ) : (
                <>
                  {groupedStudents.map((group) => (
                    <div key={group.labelKey ?? 'flat'}>
                      {/* §03 `.dl` group label — only under the ALL segment. */}
                      {group.labelKey ? (
                        <p className="mx-1 mb-2 mt-3 text-[11px] font-bold tracking-wide text-[#80827A]">
                          {ts(group.labelKey === 'groupBehind' ? 'groupBehind' : 'groupAll')}
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-2">
                        {group.rows.map((s) => {
                          const standing = standingOf(s.id);
                          const row = standingRows?.get(s.id) ?? null;
                          const balNum = Number(balanceByStudent[s.id] ?? 0);
                          const behind = isBehind(standing);
                          const waDigits = intlDigits(s.parent_phone ?? s.phone);
                          // §01 meta line: subject · grade · one standing-dependent
                          // tail. Every segment drops out when its source is null —
                          // no placeholders, no "missed 0".
                          const metaParts = [
                            s.subject || null,
                            s.grade_level ? ts('gradeLabel', { grade: s.grade_level }) : null,
                            standing === 'overdue' || standing === 'at_risk'
                              ? balNum > 0
                                ? ts('owesAmount', { amount: formatCurrency(balNum, locale) })
                                : null
                              : null,
                            standing === 'at_risk' && (row?.absentCount ?? 0) > 0
                              ? ts('missedSessions', {
                                  count: formatNumber(row?.absentCount ?? 0, locale),
                                })
                              : null,
                            standing === 'new' && s.created_at
                              ? ts('joinedAgo', {
                                  // Cairo calendar days, same arithmetic as every
                                  // other ageing string on this screen — never
                                  // wall-clock division that shifts at midnight UTC.
                                  days: formatNumber(cairoDaysSince(s.created_at), locale),
                                })
                              : null,
                          ].filter(Boolean);
                          return (
                            <SwipeRow
                              key={s.id}
                              onLongPress={() => {
                                setSelectMode(true);
                                toggleBulkStudent(s.id);
                              }}
                              actions={[
                                // §01 masthead: pay / message / edit / remove.
                                ...(canViewPayments
                                  ? [
                                      {
                                        label: tp('collectPayment'),
                                        variant: 'default' as const,
                                        icon: <CreditCard size={16} />,
                                        onClick: () => {
                                          setCollectTarget(s);
                                          setCollectAmount(balNum > 0 ? String(Math.round(balNum)) : '');
                                          setCollectMethod('cash');
                                        },
                                      },
                                    ]
                                  : []),
                                ...(waDigits
                                  ? [
                                      {
                                        label: ts('swipe_message'),
                                        variant: 'default' as const,
                                        icon: <MessageCircle size={16} />,
                                        onClick: () => {
                                          window.open(
                                            `https://wa.me/${waDigits}`,
                                            '_blank',
                                            'noopener,noreferrer',
                                          );
                                        },
                                      },
                                    ]
                                  : []),
                                {
                                  label: ts('swipe_edit'),
                                  variant: 'default' as const,
                                  icon: (
                                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                  ),
                                  onClick: () => openEdit(s),
                                },
                                {
                                  label: ts('swipe_delete'),
                                  variant: 'danger' as const,
                                  icon: (
                                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                      <path d="M10 11v6M14 11v6" />
                                    </svg>
                                  ),
                                  onClick: () => setDeleteTarget(s),
                                },
                              ]}
                            >
                              {/* §01/§03 `.srow` — avatar, name + one meta line,
                                  a standing chip or money column, and a kebab.
                                  Nothing else. */}
                              <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3 shadow-sm">
                                {selectMode ? (
                                  <input
                                    type="checkbox"
                                    className="shrink-0"
                                    aria-label={s.name}
                                    checked={bulkSelected.has(s.id)}
                                    disabled={studentCardDelivered[s.id] || isStudentInCart(s.id)}
                                    onChange={() => toggleBulkStudent(s.id)}
                                  />
                                ) : null}
                                <div
                                  className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl text-[13px] font-semibold ${
                                    behind ? 'bg-[#F4EBD7] text-[#9A6B1F]' : standingAvatarClass(standing)
                                  }`}
                                  aria-hidden
                                >
                                  {initialsOf(s.name)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <Link
                                    href={`/students/${s.id}`}
                                    className="block truncate text-[15px] font-semibold leading-tight text-[var(--color-text-primary)] btn-press chq-focus rounded outline-offset-2"
                                  >
                                    {s.name}
                                  </Link>
                                  {metaParts.length > 0 ? (
                                    <p className="mt-1 truncate text-xs text-[#80827A]">
                                      {metaParts.join(' · ')}
                                    </p>
                                  ) : null}
                                </div>
                                {/* §03: behind rows carry an amber money column
                                    (amount over age), settled rows a mint chip.
                                    The age comes from the FIFO fold, never from
                                    a wall-clock guess. NOTHING renders until the
                                    fold lands (standingRows !== null — the same
                                    gate the detail page puts on balance !==
                                    null): before it, standingOf() is only the
                                    'paid' default, and a mint "Paid" chip on a
                                    student who may owe is exactly the fake
                                    success this money surface must never show. */}
                                {standingRows === null ? null : behind && balNum > 0 ? (
                                  <div className="shrink-0 text-end">
                                    <b className="block text-[13px] font-bold tabular-nums text-[#9A6B1F]">
                                      {formatCurrency(balNum, locale)}
                                    </b>
                                    {row?.oldestUnpaidDays != null ? (
                                      <span className="text-[11px] text-[#9A6B1F] opacity-80">
                                        {ts('daysCount', {
                                          count: formatNumber(row.oldestUnpaidDays, locale),
                                        })}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : behind || segment === 'all' ? (
                                  // A behind row that has no positive figure to
                                  // show still gets its real badge — never the
                                  // mint "Paid up" chip, which would contradict
                                  // the very filter that surfaced it.
                                  <StandingBadge
                                    standing={standing}
                                    label={ts(STANDING_LABEL_KEY[standing])}
                                  />
                                ) : (
                                  <span className="shrink-0 rounded-full bg-[var(--color-mint)] px-3 py-1 text-[11px] font-bold text-[var(--color-accent-deep)]">
                                    {ts('paidUpChip')}
                                  </span>
                                )}
                                {/* §01 row kebab — where the roster's surviving
                                    per-row functions live now that the action
                                    strip is gone. Also the keyboard-reachable
                                    path into multi-select. */}
                                <div className="relative shrink-0">
                                  <button
                                    type="button"
                                    data-row-menu-trigger
                                    aria-label={tCommon('actions')}
                                    aria-expanded={rowMenuId === s.id}
                                    onClick={() => setRowMenuId(rowMenuId === s.id ? null : s.id)}
                                    className="ms-1 p-0.5 text-[#B0B1A7] btn-press chq-focus"
                                  >
                                    <EllipsisVertical size={18} aria-hidden />
                                  </button>
                                  {rowMenuId === s.id ? (
                                    <div
                                      ref={rowMenuRef}
                                      role="menu"
                                      className="absolute end-0 top-full z-50 mt-1 min-w-[200px] rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-1)] p-1 shadow-lg"
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                                        onClick={() => {
                                          setRowMenuId(null);
                                          openEdit(s);
                                        }}
                                      >
                                        {tCommon('edit')}
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                                        onClick={() => {
                                          setRowMenuId(null);
                                          void openQRModal(s);
                                        }}
                                      >
                                        {ts('viewQR')}
                                      </button>
                                      {canViewPayments ? (
                                        <button
                                          type="button"
                                          role="menuitem"
                                          className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                                          onClick={() => {
                                            setRowMenuId(null);
                                            setPrintStudent({ id: s.id, name: s.name });
                                          }}
                                        >
                                          {ts('statement.printStatement')}
                                        </button>
                                      ) : null}
                                      {/* KEPT AGAINST THE DESIGN: the parent-pack
                                          opt-in is the only per-student entry
                                          point to a PAID WhatsApp feature. The
                                          design draws no replacement, so it moves
                                          into the kebab rather than being deleted. */}
                                      {user?.center?.parent_pack_enabled === true ? (
                                        <button
                                          type="button"
                                          role="menuitemcheckbox"
                                          aria-checked={!!s.parent_pack_opted_in}
                                          disabled={
                                            togglingIds.has(s.id) ||
                                            s.is_active !== true ||
                                            !s.parent_phone ||
                                            String(s.parent_phone).trim() === ''
                                          }
                                          title={
                                            s.is_active !== true
                                              ? ts('packDisabledInactive')
                                              : !s.parent_phone || String(s.parent_phone).trim() === ''
                                                ? ts('packDisabledNoPhone')
                                                : undefined
                                          }
                                          className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
                                          onClick={() => {
                                            setRowMenuId(null);
                                            void handlePackToggle(s);
                                          }}
                                        >
                                          <span>{ts('parentPackOptIn')}</span>
                                          {s.parent_pack_opted_in ? (
                                            <Check size={14} className="shrink-0 text-teal-600" aria-hidden />
                                          ) : null}
                                        </button>
                                      ) : null}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                                        onClick={() => {
                                          setRowMenuId(null);
                                          setSelectMode(true);
                                          toggleBulkStudent(s.id);
                                        }}
                                      >
                                        {ts('selectAction')}
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="w-full rounded-lg px-3 py-2 text-start text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                                        onClick={() => {
                                          setRowMenuId(null);
                                          setDeleteTarget(s);
                                        }}
                                      >
                                        {tCommon('delete')}
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </SwipeRow>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {filteredStudents.length > renderLimit ? (
                    <button
                      type="button"
                      onClick={() => setRenderLimit((n) => n + ROSTER_RENDER_CHUNK)}
                      className="mt-3 w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] py-3 text-[13px] font-semibold text-[var(--color-accent-deep)] btn-press chq-focus"
                    >
                      {ts('loadMore', {
                        count: formatNumber(filteredStudents.length - renderLimit, locale),
                      })}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>

        {/* §03 `.footer` — a full-width primary pinned under the list. It opens
            the SAME add modal as §01's `.addbtn` square; the square keeps the
            accessible name so screen readers get one "Add student" control, not
            two. */}
        {students !== null && students.length > 0 ? (
          <div className="sticky bottom-0 z-30 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 pb-6 pt-3">
            <div className="max-w-3xl mx-auto w-full">
              {/* KEPT AGAINST THE DESIGN: Send Announcement is a PAID blast that
                  debits centers.announcement_balance and has no other entry point
                  anywhere in the app. The design draws no home for it, so it sits
                  here as a text button — and only for a center that actually has
                  active pack parents, which is nobody live, so the common roster
                  matches the design exactly. */}
              {canSendAnnouncement ? (
                <button
                  type="button"
                  onClick={() => {
                    setAnnouncementBlastType(null);
                    setAnnouncementMessage('');
                    setShowAnnouncementModal(true);
                  }}
                  className="mb-2 w-full py-2 text-center text-[13px] font-semibold text-[var(--color-accent-deep)] btn-press chq-focus"
                >
                  {ts('sendAnnouncement')}
                </button>
              ) : null}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setShowAddModal(true)}
                className="btn-lift flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 p-4 text-[15px] font-bold text-white shadow-sm transition-all duration-150 hover:bg-teal-700 btn-press"
              >
                <Plus size={18} aria-hidden /> {ts('add_student')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border)] p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('addStudent')}</h3>
              <button onClick={() => setShowAddModal(false)} className="btn-press chq-focus"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            <form onSubmit={handleAddStudent} className="space-y-3">
              <input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder={ts('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm" required />
              <input value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm" />
              <button
                type="button"
                onClick={() => setShowParentSectionAdd((v) => !v)}
                className="w-full text-start text-sm font-medium text-teal-700 py-2 border border-dashed border-teal-200 rounded-lg px-3 hover:bg-teal-50/50 btn-press chq-focus"
              >
                {ts('parentSection')}
              </button>
              {showParentSectionAdd && (
                <div className="space-y-3 ps-1 border-s-2 border-teal-100 ms-1 pe-1">
                  <input
                    value={addForm.parentPhone}
                    onChange={(e) => setAddForm((f) => ({ ...f, parentPhone: e.target.value }))}
                    placeholder={ts('parentPhonePlaceholder')}
                    aria-label={ts('parentPhone')}
                    type="tel"
                    dir="ltr"
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
                  />
                  {centerInfo?.parent_pack_enabled === true && (
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addForm.parentPackOptIn}
                        onChange={(e) => setAddForm((f) => ({ ...f, parentPackOptIn: e.target.checked }))}
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
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{ts('groupRequired')}</label>
                {showCreateGroup ? (
                  <div className="space-y-2 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/30">
                    <input
                      value={createGroupForm.name}
                      onChange={(e) => setCreateGroupForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder={ts('add.groupNamePlaceholder')}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
                    />
                    <select
                      value={createGroupForm.subjectId}
                      onChange={(e) => setCreateGroupForm((f) => ({ ...f, subjectId: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
                    >
                      <option value="">{tCommon('select')}</option>
                      {subjects.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    <input
                      value={createGroupForm.fee}
                      onChange={(e) => setCreateGroupForm((f) => ({ ...f, fee: e.target.value }))}
                      placeholder={ts('add.groupFeePlaceholder')}
                      type="number"
                      inputMode="decimal"
                      dir="ltr"
                      className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => { setShowCreateGroup(false); setCreateGroupForm({ name: '', subjectId: '', fee: '' }); }}
                        className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)]"
                      >
                        {tCommon('cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCreateGroupQuick()}
                        disabled={creatingGroup}
                        className="px-3 py-1.5 text-xs rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-medium disabled:opacity-50"
                      >
                        {creatingGroup ? '...' : ts('add.createGroup')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={addForm.groupId}
                      onChange={(e) => { const gId = e.target.value; const g = groups.find((gr) => gr.id === gId); setAddForm((f) => ({ ...f, groupId: gId, subjectId: g ? subjects.find((s) => s.name === g.subject)?.id ?? '' : '', monthlyFee: g?.fee_per_class != null ? String(g.fee_per_class) : '' })); }}
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
                      required
                      disabled={groups.length === 0}
                    >
                      {groups.length === 0 ? (
                        <option value="" disabled>{ts('add.noGroupsPlaceholder')}</option>
                      ) : (
                        <option value="">{tCommon('select')}</option>
                      )}
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                          {g.fee_per_class != null ? ` (${formatCurrency(g.fee_per_class, locale)})` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setShowCreateGroup(true)}
                      className="shrink-0 px-3 py-2.5 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                    >
                      {ts('add.newGroup')}
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">{ts('autoGenerateNumber')}</p>
              <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-3">
                <input
                  type="checkbox"
                  required
                  checked={addForm.guardianConsent}
                  onChange={(e) => setAddForm((f) => ({ ...f, guardianConsent: e.target.checked }))}
                  className="mt-0.5 rounded accent-teal-600"
                />
                <span className="text-sm text-[var(--color-text-primary)]">{tConsent('checkboxLabel')}</span>
              </label>
              <div className="flex gap-2 justify-end mt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm border border-[var(--color-border)] btn-press chq-focus">{tCommon('cancel')}</button>
                <button type="submit" disabled={isAdding} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 btn-press chq-focus">{isAdding ? tCommon('loading') : tCommon('save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditStudent(null)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border)] p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{tCommon('edit')}</h3>
              <button onClick={() => setEditStudent(null)} className="btn-press chq-focus"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            <div className="space-y-3">
              <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={ts('studentName')} className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm" />
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder={tCommon('phone')} type="tel" dir="ltr" className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm" />
              <button
                type="button"
                onClick={() => setShowParentSectionEdit((v) => !v)}
                className="w-full text-start text-sm font-medium text-teal-700 py-2 border border-dashed border-teal-200 rounded-lg px-3 hover:bg-teal-50/50 btn-press chq-focus"
              >
                {ts('parentSection')}
              </button>
              {showParentSectionEdit && (
                <div className="space-y-3 ps-1 border-s-2 border-teal-100 ms-1 pe-1">
                  <input
                    value={editParentPhone}
                    onChange={(e) => setEditParentPhone(e.target.value)}
                    placeholder={ts('parentPhonePlaceholder')}
                    aria-label={ts('parentPhone')}
                    type="tel"
                    dir="ltr"
                    className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
                  />
                  {user?.center?.parent_pack_enabled === true && (
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
              {editStudent.parent_consent_given && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  {ts('parentConsented', { defaultValue: 'موافقة ولي الأمر ✓' })}
                </span>
              )}
              <FamilyLinkingSection
                centerId={centerId}
                studentId={editStudent.id}
                currentFamilyId={editSiblingFamilyId}
                onFamilyChange={setEditSiblingFamilyId}
              />
              <div>
                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{ts('assignGroups')}</label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {groups.map((g) => (
                    <label key={g.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-[var(--color-surface-2)] cursor-pointer">
                      <input type="checkbox" checked={editGroups.includes(g.id)} onChange={(e) => setEditGroups((prev) => e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id))} className="rounded accent-primary" />
                      <span className="text-sm text-[var(--color-text-primary)]">{g.name}</span>
                      <span className="text-xs text-[var(--color-text-secondary)] ms-auto">{g.subject}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setEditStudent(null)} className="px-4 py-2 rounded-lg text-sm border border-[var(--color-border)] btn-press chq-focus">{tCommon('cancel')}</button>
              <button onClick={saveEdit} disabled={isSavingEdit} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 btn-press chq-focus">{isSavingEdit ? tCommon('loading') : tCommon('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteTarget(null)}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border)] p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-[var(--color-text-primary)] text-lg mb-2">{ts('deleteStudent')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-3">{ts('deleteStudentConfirm')}</p>
            <p className="font-medium text-[var(--color-text-primary)] mb-5">{deleteTarget.name}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg text-sm border border-[var(--color-border)] btn-press chq-focus">{tCommon('cancel')}</button>
              <button onClick={() => { if (deleteTarget) { handleDeleteStudent(deleteTarget); setDeleteTarget(null); } }} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-destructive hover:bg-destructive/90 btn-press chq-focus">{tCommon('delete')}</button>
            </div>
          </div>
        </div>
      )}

      {/* View QR Modal -- Professional ID Card */}
      {qrModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4" onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }}>
          <div className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border)] p-6 max-w-sm mx-4 w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('viewQR')}</h3>
              <button onClick={() => { setQrModalStudent(null); setQrDataUrl(null); }} className="p-1.5 rounded-lg hover:bg-[var(--color-surface-2)] btn-press chq-focus"><X size={18} className="text-[var(--color-text-secondary)]" /></button>
            </div>
            {/* Professional ID card */}
            <div className="flex justify-center mb-5">
              <div className="w-full max-w-[320px] rounded-2xl overflow-hidden shadow-xl">
                <QRCard
                  student={qrModalStudent}
                  qrDataUrl={qrDataUrl}
                  centerLogo={centerInfo?.logo_url ?? null}
                  centerName={centerInfo?.name ?? 'TutoringHQ'}
                  scale={1.2}
                  variant="preview"
                />
              </div>
            </div>
            {/* Student details below card */}
            <div className="text-center mb-4">
              <div className="font-bold text-[var(--color-text-primary)]">{qrModalStudent.name}</div>
              <div className="font-mono text-sm text-[var(--color-text-secondary)]">
                {formatStudentNumberForDisplay(qrModalStudent.student_number)}
              </div>
              {(balanceByStudent[qrModalStudent.id] ?? 0) > 0 && (
                <div className="mt-2 text-sm font-bold text-red-600">
                  {ts('balance')}: {formatCurrency(Math.round(balanceByStudent[qrModalStudent.id]!), locale)}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={downloadQR} disabled={!qrDataUrl} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium border border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors disabled:opacity-50 btn-press chq-focus">
                <Download size={14} /> {tCommon('download')}
              </button>
              <button onClick={printCard} disabled={!qrDataUrl} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50 btn-press chq-focus">
                <QrCode size={14} /> {tCommon('print')}
              </button>
            </div>
            {qrDataUrl && <button onClick={handleRegenerateQR} className="mt-3 w-full py-1 text-xs text-amber-600 hover:underline btn-press chq-focus">{ts('regenerateQR')}</button>}
          </div>
        </div>
      )}

      {showAnnouncementModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!announcementSubmitting) setShowAnnouncementModal(false);
          }}
          role="presentation"
        >
          <div
            className="bg-[var(--color-surface-1)] rounded-2xl border border-[var(--color-border)] max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-[var(--color-text-primary)]">{ts('sendAnnouncement')}</h3>
              <button
                type="button"
                disabled={announcementSubmitting}
                onClick={() => setShowAnnouncementModal(false)}
                className="p-1 rounded-lg hover:bg-[var(--color-surface-2)] btn-press chq-focus"
                aria-label={tCommon('cancel')}
              >
                <X size={18} className="text-[var(--color-text-secondary)]" />
              </button>
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setAnnouncementBlastType('ops')}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  announcementBlastType === 'ops'
                    ? 'border-teal-600 bg-teal-50 text-teal-900'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'
                } btn-press chq-focus`}
              >
                {ts('announcementOps')}
              </button>
              <button
                type="button"
                onClick={() => setAnnouncementBlastType('promo')}
                className={`flex-1 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                  announcementBlastType === 'promo'
                    ? 'border-amber-500 bg-amber-50 text-amber-900'
                    : 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]'
                } btn-press chq-focus`}
              >
                {ts('announcementPromo')}
              </button>
            </div>
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">{ts('announcementMessage')}</label>
            <textarea
              value={announcementMessage}
              onChange={(e) => setAnnouncementMessage(e.target.value.slice(0, 200))}
              dir="rtl"
              maxLength={200}
              rows={4}
              className="w-full border border-[var(--color-border)] rounded-lg p-3 text-sm bg-[var(--color-surface-0)]"
            />
            <p className="text-xs text-[var(--color-text-tertiary)] mt-1 text-end">
              {200 - announcementMessage.length}
            </p>
            <p className="text-xs font-medium text-[var(--color-text-secondary)] mt-3">{ts('announcementPreview')}</p>
            <div
              className="mt-1 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm text-[var(--color-text-primary)] whitespace-pre-wrap"
              dir="rtl"
            >
              {announcementBlastType === 'promo'
                ? ts('announcementPreviewPromo', {
                    center: centerInfo?.name ?? '',
                    message: announcementMessage.trim() || '…',
                  })
                : ts('announcementPreviewOps', {
                    center: centerInfo?.name ?? '',
                    message: announcementMessage.trim() || '…',
                  })}
            </div>
            <p className="text-sm mt-3 text-[var(--color-text-primary)]">
              {ts('announcementParentsCount', {
                count: formatPlainInteger(Math.round(Number(activeParentsForAnnounce)), locale),
              })}
            </p>
            <p className="text-sm font-mono mt-1 text-[var(--color-text-primary)]" dir="ltr">
              {ts('announcementCost')}:{' '}
              {formatCurrency(
                Math.round(activeParentsForAnnounce * BLAST_PRICE_PER_PARENT * 100) / 100,
                locale,
              )}
            </p>
            {announcementCapWarning && !announcementCapReached && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                {ts('announcementCapWarning', {
                  balance: formatPlainInteger(Math.round(announcementBalanceNum), locale),
                  cap: formatPlainInteger(Math.round(announcementCap), locale),
                })}
              </p>
            )}
            {announcementCapReached && (
              <p className="text-sm text-red-300 bg-red-950/30 border border-red-900/50 rounded-lg p-2 mt-2">
                {ts('announcementCapReached')}
              </p>
            )}
            <button
              type="button"
              disabled={
                announcementSubmitting ||
                !announcementBlastType ||
                !announcementMessage.trim() ||
                announcementCapReached ||
                activeParentsForAnnounce === 0
              }
              onClick={async () => {
                if (!announcementBlastType) return;
                setAnnouncementSubmitting(true);
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session?.access_token) return;
                  const res = await fetch('/api/parent-pack/announcement', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${session.access_token}`,
                    },
                    body: JSON.stringify({
                      blast_type: announcementBlastType,
                      message: announcementMessage.trim(),
                    }),
                  });
                  if (!res.ok) {
                    toast.error(tToast('error'));
                    return;
                  }
                  const j = (await res.json()) as { sent?: number; totalCost?: number };
                  toast.success(
                    ts('announcementSentToast', {
                      count: j.sent ?? 0,
                      cost: formatNumber(j.totalCost ?? 0, locale),
                    }),
                  );
                  await refreshUser();
                  const meRes = await fetch('/api/me', {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                  });
                  const meData = await meRes.json();
                  if (meData?.user?.center) {
                    setCenterInfo((prev) => ({
                      ...(prev ?? {}),
                      announcement_balance: meData.user.center.announcement_balance,
                      parent_pack_active_parents: meData.user.center.parent_pack_active_parents,
                    }));
                  }
                  setShowAnnouncementModal(false);
                  setAnnouncementMessage('');
                  setAnnouncementBlastType(null);
                } finally {
                  setAnnouncementSubmitting(false);
                }
              }}
              className="mt-4 w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed btn-press chq-focus"
            >
              {announcementSubmitting ? tCommon('loading') : ts('announcementConfirm')}
            </button>
          </div>
        </div>
      )}

      {/* KEPT AGAINST THE DESIGN: the design draws no checkbox, but its masthead
          explicitly contracts long-press multi-select — and a selection with no
          confirm affordance is a dead gesture. Only appears after a deliberate
          long-press (or the kebab's Select item). */}
      {bulkSelected.size > 0 ? (
        <div className="fixed start-0 end-0 bottom-[calc(56px+env(safe-area-inset-bottom,0px))] md:bottom-6 z-[70] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-xl px-4 py-3 max-w-lg w-full">
            <span className="text-sm text-[var(--color-text-secondary)] flex-1 tabular-nums">
              {formatNumber(bulkSelected.size, locale)}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--color-text-secondary)] btn-press chq-focus"
              onClick={() => {
                setBulkSelected(new Set());
                setSelectMode(false);
              }}
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              data-testid="students-bulk-add-cart"
              disabled={bulkSubmitting}
              className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 shrink-0"
              onClick={() => void bulkAddToCart()}
            >
              {tCart('picker.addSelected', { count: bulkSelected.size })}
            </button>
          </div>
        </div>
      ) : null}

      {/* Collect payment from a roster row (§01 swipe action "pay"). Posts to
          the SAME POST /api/payments/collect the detail page uses — no new money
          path, no client-side ledger write. */}
      {collectTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !collectSubmitting && setCollectTarget(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-6"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="roster-collect-title"
          >
            <h3 id="roster-collect-title" className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">
              {tp('collectPayment')}
            </h3>
            <p className="mb-4 text-sm text-[var(--color-text-secondary)]">{collectTarget.name}</p>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
              {tp('amount')}
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={collectAmount}
              onChange={(e) => setCollectAmount(e.target.value)}
              dir="ltr"
              placeholder="0"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
            />
            <label className="mb-1 mt-4 block text-xs font-medium text-[var(--color-text-secondary)]">
              {tp('paymentMethod')}
            </label>
            <div className="flex flex-wrap gap-2">
              {(['cash', 'instapay'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCollectMethod(m)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors btn-press chq-focus ${
                    collectMethod === m
                      ? 'border-teal-600 bg-teal-600/15 text-teal-700'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  {tp(m === 'cash' ? 'method_cash' : 'method_instapay')}
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={collectSubmitting}
                onClick={() => setCollectTarget(null)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-50 btn-press chq-focus"
              >
                {tCommon('cancel')}
              </button>
              <button
                type="button"
                disabled={collectSubmitting}
                onClick={() => void handleRosterCollect()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:opacity-50 btn-press chq-focus"
              >
                {collectSubmitting ? tCommon('loading') : tp('recordPayment')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Print Statement Modal */}
      {printStudent && (
        <PrintStatementModal
          studentId={printStudent.id}
          studentName={printStudent.name}
          isOpen={true}
          onClose={() => setPrintStudent(null)}
        />
      )}

    </>
  );
}
