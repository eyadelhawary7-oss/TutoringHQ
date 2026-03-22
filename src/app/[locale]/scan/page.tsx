'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert } from '@/lib/db-proxy';
import {
  syncStudentsToLocal,
  getAllStudentsOffline,
  getStudentOffline,
  queueScan,
  getUnsyncedCount,
  hasPaidTodayOffline,
  markPaidTodayOffline,
} from '@/lib/db';
import { syncQueuedScans } from '@/lib/sync';
import CameraScanner from '@/components/CameraScanner';
import BluetoothScanner from '@/components/BluetoothScanner';
import ScanResultScreen from '@/components/ScanResultScreen';
import { Camera, Bluetooth, Hash, BookOpen, ChevronRight, Search } from 'lucide-react';
import { useUser } from '@/contexts/UserContext';

type ScanMode = 'camera' | 'bluetooth' | 'manual';

interface Student {
  id: string;
  name: string;
  payment_status: string;
  fee: number;
  subject: string;
  parent_phone?: string | null;
  student_number?: string | null;
  last_payment_method?: string | null;
  groups?: { id: string; name: string; fee: number; subject?: string | null }[];
}

/** Fire-and-forget: notify parent of scan (async, no await). */
function notifyParentScan(studentId: string, result: 'attended' | 'absent' | 'pending_payment') {
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session) return;
    fetch('/api/parents/notify-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ student_id: studentId, result }),
    }).catch(() => {});
  });
}

/** Check if student paid TODAY for a specific group (per-session payment logic). payments table is source of truth. */
async function hasPaidToday(studentId: string, centerId: string, groupId?: string | null): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const filters: { column: string; op: 'eq' | 'gte' | 'lte'; value: string }[] = [
    { column: 'student_id', op: 'eq', value: studentId },
    { column: 'center_id', op: 'eq', value: centerId },
    { column: 'paid_at', op: 'gte', value: today + 'T00:00:00' },
    { column: 'paid_at', op: 'lte', value: today + 'T23:59:59' },
  ];
  if (groupId) filters.push({ column: 'group_id', op: 'eq', value: groupId });
  const { data } = await dbSelect({
    table: 'payments',
    select: 'id',
    filters,
    limit: 1,
  });
  return Array.isArray(data) ? data.length > 0 : !!data;
}

let persistedMode: ScanMode = 'camera';

export default function ScanPage() {
  const t = useTranslations('scan');
  const ts = useTranslations('scanner');
  const tSync = useTranslations('sync');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { user, hasPermission } = useUser();

  const [mode, setMode] = useState<ScanMode>(persistedMode);
  const [manualIdInput, setManualIdInput] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
  const [needGroupSelection, setNeedGroupSelection] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string; fee: number; subject?: string | null } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [addedAmountToBalance, setAddedAmountToBalance] = useState(0);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);
  const modeRef = useRef<ScanMode>('camera');
  const [mounted, setMounted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('chq-scanner-sound') !== 'false';
  });
  const [scanHistory, setScanHistory] = useState<
    Array<{
      id: string;
      studentName: string;
      time: Date;
      status: 'success' | 'error' | 'duplicate';
    }>
  >([]);
  const resultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scanFrameState, setScanFrameState] = useState<'idle' | 'success' | 'error'>('idle');
  const [lastSuccessStudentName, setLastSuccessStudentName] = useState('');
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { persistedMode = mode; }, [mode]);

  // Sync students (with groups) to IndexedDB when center is available and online
  const fetchAndSyncStudents = useCallback(async () => {
    if (!centerId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: studentsRaw } = await dbSelect({
        table: 'students',
        select: 'id, name, phone, parent_phone, subject, fee, qr_code, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
      });
      const studentsList = (studentsRaw || []) as { id: string; name?: string; phone?: string; subject?: string; fee?: number; student_number?: string | null }[];

      if (studentsList.length > 0) {
        const { data: membersData } = await dbSelect({
          table: 'student_group_members',
          select: 'student_id, group_id',
          filters: [{ column: 'student_id', op: 'in', value: studentsList.map(s => s.id) }],
        });
        const members = (membersData || []) as { student_id: string; group_id: string }[];

        const groupIds = [...new Set(members.map(m => m.group_id))];
        let groupsMap: Record<string, { id: string; name: string; fee: number; subject?: string | null }> = {};
        if (groupIds.length > 0) {
          const { data: groupsData } = await dbSelect({
            table: 'student_groups',
            select: 'id, name, fee, subject',
            filters: [{ column: 'id', op: 'in', value: groupIds }],
          });
          groupsMap = Object.fromEntries(
            ((groupsData || []) as { id: string; name?: string; fee?: number; subject?: string | null }[]).map(g => [
              g.id,
              { id: g.id, name: g.name ?? '', fee: g.fee ?? 0, subject: g.subject ?? null },
            ])
          );
        }

        const studentsWithGroups = studentsList.map(s => {
          const studentGroups = members
            .filter(m => m.student_id === s.id)
            .map(m => groupsMap[m.group_id])
            .filter(Boolean);
          return {
            ...s,
            groups: studentGroups,
          };
        }) as Student[];

        await syncStudentsToLocal(
          studentsWithGroups as unknown as (Record<string, unknown> & { id: string; student_number?: string | null })[]
        );
        setStudents(studentsWithGroups);
      } else {
        setStudents([]);
      }
    } catch {
      try {
        const cached = await getAllStudentsOffline();
        setStudents((cached ?? []) as Student[]);
      } catch {
        setStudents([]);
      }
    }
  }, [centerId]);

  const canAllowLateEntry = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_allow_late_entry');

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (meData?.user?.center_id) {
        setCenterId(meData.user.center_id);
      }
    };
    loadUser();
  }, []);

  // Initial load and background sync when device regains connectivity
  useEffect(() => {
    if (!centerId) return;
    fetchAndSyncStudents();
    window.addEventListener('online', fetchAndSyncStudents);
    return () => {
      window.removeEventListener('online', fetchAndSyncStudents);
    };
  }, [centerId, fetchAndSyncStudents]);

  // Online/offline and pending count
  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = async () => {
      setIsOnline(true);
      setIsSyncing(true);
      try {
        await syncQueuedScans();
        const count = await getUnsyncedCount();
        setPendingCount(count);
      } catch {
        //
      } finally {
        setIsSyncing(false);
      }
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const updatePending = async () => {
      try {
        const count = await getUnsyncedCount();
        setPendingCount(count);
      } catch {
        //
      }
    };
    updatePending();
    const interval = setInterval(updatePending, 3000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    };
  }, []);

  const playBeep = useCallback((success: boolean) => {
    if (!soundEnabled) return;
    if (typeof window === 'undefined') return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = success ? 880 : 440;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch (_) {}
  }, [soundEnabled]);

  const vibrate = useCallback((pattern: number | number[]) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }, []);

  const normalizeForLookup = (input: string): { byId: boolean; value: string } => {
    const trimmed = input.trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(trimmed)) return { byId: true, value: trimmed };
    if (/^\d+$/.test(trimmed)) return { byId: false, value: 'STU-' + trimmed.padStart(5, '0') };
    if (trimmed.toUpperCase().startsWith('STU-')) return { byId: false, value: trimmed.toUpperCase() };
    return { byId: false, value: trimmed };
  };

  const handleScan = useCallback(async (code: string) => {
    if (isProcessingRef.current) return;
    if (!centerId || !userId) {
      setError('جاري التحميل... حاول مرة أخرى');
      setTimeout(() => setError(''), 3000);
      return;
    }
    isProcessingRef.current = true;
    setError('');

    const { byId, value } = normalizeForLookup(code);
    let student: Student | null = null;
    let usedOffline = false;

    try {
      // ONLINE: Try Supabase first
      if (navigator.onLine) {
        try {
          const filters = byId
            ? [{ column: 'id', op: 'eq' as const, value }, { column: 'center_id', op: 'eq' as const, value: centerId }]
            : [{ column: 'student_number', op: 'eq' as const, value: value.toUpperCase() }, { column: 'center_id', op: 'eq' as const, value: centerId }];
          const { data, error: lookupError } = await dbSelect({
            table: 'students',
            select: 'id, name, phone, parent_phone, subject, fee, student_number',
            filters,
            single: true,
          });
          if (!lookupError && data) student = data as Student;

          if (!student && /^\d{10,11}$/.test(code.trim())) {
            const normalizedPhone = code.trim().startsWith('0') ? '+2' + code.trim() : '+' + code.trim();
            const { data: phoneData, error: phoneError } = await dbSelect({
              table: 'students',
              select: 'id, name, phone, parent_phone, subject, fee, student_number',
              filters: [
                { column: 'phone', op: 'eq', value: normalizedPhone },
                { column: 'center_id', op: 'eq', value: centerId },
              ],
              single: true,
            });
            if (!phoneError && phoneData) student = phoneData as Student;
          }
        } catch (networkErr) {
          // Network error: fall back to IndexedDB
          usedOffline = true;
          student = (await getStudentOffline(value) as Student | undefined) || null;
        }
      } else {
        // OFFLINE: Use IndexedDB directly
        usedOffline = true;
        student = (await getStudentOffline(value) as Student | undefined) || null;
      }

      // When online and found from API (not IndexedDB fallback), fetch groups
      if (student && navigator.onLine && !usedOffline) {
        try {
          const { data: membersData } = await dbSelect({
            table: 'student_group_members',
            select: 'group_id',
            filters: [{ column: 'student_id', op: 'eq', value: student.id }],
          });
          if (membersData && Array.isArray(membersData) && membersData.length > 0) {
            const grpIds = (membersData as { group_id: string }[]).map((m) => m.group_id);
            const { data: groupsData } = await dbSelect({
              table: 'student_groups',
              select: 'id, name, fee',
              filters: [{ column: 'id', op: 'in', value: grpIds }],
            });
            if (groupsData && Array.isArray(groupsData)) {
              student.groups = (groupsData as { id: string; name: string; fee?: number }[]).map((g) => ({
                id: g.id,
                name: g.name,
                fee: g.fee ?? 0,
              }));
              const primaryGroup = student.groups[0];
              if (primaryGroup && !student.fee) {
                student.fee = primaryGroup.fee;
                student.subject = primaryGroup.name;
              }
            }
          }
        } catch {
          // Keep student.groups from IndexedDB if any
        }
      }

      if (!student) {
        setError(t('studentNotFound'));
        playBeep(false);
        vibrate([100, 50, 100]);
        setScanFrameState('error');
        if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
        resultTimeoutRef.current = setTimeout(() => {
          setScanFrameState('idle');
          resultTimeoutRef.current = null;
        }, 2000);
        setScanHistory((prev) =>
          [
            {
              id: Date.now().toString(),
              studentName: ts('scan_error'),
              time: new Date(),
              status: 'error' as const,
            },
            ...prev,
          ].slice(0, 10)
        );
        isProcessingRef.current = false;
        setTimeout(() => setError(''), 3000);
        return;
      }

      const groups = student.groups ?? [];
      const hasMultipleGroups = groups.length >= 2;

      // If 2+ groups: show group selector BEFORE checking payment (works offline if groups cached)
      if (hasMultipleGroups) {
        setSelectedGroup(null);
        setNeedGroupSelection(true);
        setScannedStudent({ ...student, payment_status: '', last_payment_method: null });
        isProcessingRef.current = false;
        if (modeRef.current === 'manual') setManualIdInput('');
        return;
      }

      // Single group (or offline): use first group or null
      const grp = groups[0] ?? null;
      setSelectedGroup(grp);
      setNeedGroupSelection(false);

      // Per-session payment: check if paid TODAY for THIS GROUP (payments table is source of truth)
      let paidToday = false;
      let lastPaymentMethod: string | null = null;
      if (navigator.onLine) {
        paidToday = await hasPaidToday(student.id, centerId, grp?.id ?? null);
        if (paidToday) {
          const today = new Date().toISOString().split('T')[0];
          const payFilters: { column: string; op: 'eq' | 'gte' | 'lte'; value: string }[] = [
            { column: 'student_id', op: 'eq', value: student.id },
            { column: 'center_id', op: 'eq', value: centerId },
            { column: 'paid_at', op: 'gte', value: today + 'T00:00:00' },
            { column: 'paid_at', op: 'lte', value: today + 'T23:59:59' },
          ];
          if (grp?.id) payFilters.push({ column: 'group_id', op: 'eq', value: grp.id });
          const { data: todayPay } = await dbSelect({
            table: 'payments',
            select: 'method',
            filters: payFilters,
            order: { column: 'paid_at', ascending: false },
            limit: 1,
          });
          const pay = Array.isArray(todayPay) ? todayPay[0] : todayPay;
          lastPaymentMethod = (pay as { method?: string })?.method ?? null;
        }
      } else {
        paidToday = await hasPaidTodayOffline(centerId, student.id);
      }

      const displayStatus = paidToday ? (lastPaymentMethod && lastPaymentMethod !== 'cash' ? 'pending' : 'paid') : 'unpaid';
      const studentForDisplay: Student = {
        ...student,
        fee: grp?.fee ?? student.fee ?? 0,
        subject: grp?.name ?? student.subject ?? '',
        payment_status: displayStatus,
        last_payment_method: lastPaymentMethod,
      };
      setScannedStudent(studentForDisplay);
      const scannedAt = new Date().toISOString();

      if (paidToday) {
        // Already paid today: record attendance only
        if (navigator.onLine) {
          const { error: attendErr } = await dbInsert({
            table: 'attendance_scans',
            data: {
              student_id: student.id,
              center_id: centerId,
              scanned_by: userId,
              scanned_at: scannedAt,
              payment_status_at_scan: 'paid',
              session_date: scannedAt.split('T')[0],
              payment_recorded: false,
              group_id: grp?.id ?? null,
            },
            select: false,
          });
          if (attendErr) console.error('Attendance scan insert FAILED:', attendErr);
          else notifyParentScan(student.id, 'attended');
        } else {
          await queueScan({
            student_id: student.id,
            center_id: centerId,
            scanned_by: userId,
            scanned_at: scannedAt,
          });
          const count = await getUnsyncedCount();
          setPendingCount(count);
        }
        setLastSuccessStudentName(studentForDisplay.name);
        playBeep(true);
        vibrate(100);
        if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
        resultTimeoutRef.current = setTimeout(() => {
          setScanFrameState('idle');
          setLastSuccessStudentName('');
          resultTimeoutRef.current = null;
        }, 2500);
        setScanFrameState('success');
        setScanHistory((prev) =>
          [
            {
              id: Date.now().toString(),
              studentName: studentForDisplay.name,
              time: new Date(),
              status: 'success' as const,
            },
            ...prev,
          ].slice(0, 10)
        );
        dismissTimerRef.current = setTimeout(() => {
          setScannedStudent(null);
          setSelectedGroup(null);
          isProcessingRef.current = false;
          if (modeRef.current === 'manual') {
            setManualIdInput('');
            manualInputRef.current?.focus();
          }
        }, 3000);
      }
      if (modeRef.current === 'manual' && !paidToday) {
        setManualIdInput('');
        manualInputRef.current?.focus();
      }
    } catch {
      setError(t('scanError'));
      playBeep(false);
      vibrate([100, 50, 100]);
      setScanFrameState('error');
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
      resultTimeoutRef.current = setTimeout(() => {
        setScanFrameState('idle');
        resultTimeoutRef.current = null;
      }, 2000);
      setScanHistory((prev) =>
        [
          {
            id: Date.now().toString(),
            studentName: ts('scan_error'),
            time: new Date(),
            status: 'error' as const,
          },
          ...prev,
        ].slice(0, 10)
      );
      isProcessingRef.current = false;
    }
  }, [centerId, userId, t, ts, playBeep, vibrate]);

  const handleGroupSelect = useCallback(async (group: { id: string; name: string; fee: number }) => {
    if (!scannedStudent || !centerId || !userId) return;
    setSelectedGroup(group);
    setNeedGroupSelection(false);

    const student = scannedStudent;
    let paidToday = false;
    let lastPaymentMethod: string | null = null;

    if (navigator.onLine) {
      try {
        paidToday = await hasPaidToday(student.id, centerId, group.id);
        if (paidToday) {
          const today = new Date().toISOString().split('T')[0];
          const { data: todayPay } = await dbSelect({
            table: 'payments',
            select: 'method',
            filters: [
              { column: 'student_id', op: 'eq', value: student.id },
              { column: 'center_id', op: 'eq', value: centerId },
              { column: 'group_id', op: 'eq', value: group.id },
              { column: 'paid_at', op: 'gte', value: today + 'T00:00:00' },
              { column: 'paid_at', op: 'lte', value: today + 'T23:59:59' },
            ],
            order: { column: 'paid_at', ascending: false },
            limit: 1,
          });
          const pay = Array.isArray(todayPay) ? todayPay[0] : todayPay;
          lastPaymentMethod = (pay as { method?: string })?.method ?? null;
        }
      } catch {
        paidToday = await hasPaidTodayOffline(centerId, student.id);
      }
    } else {
      paidToday = await hasPaidTodayOffline(centerId, student.id);
    }

    const displayStatus = paidToday ? (lastPaymentMethod && lastPaymentMethod !== 'cash' ? 'pending' : 'paid') : 'unpaid';
    const studentForDisplay: Student = {
      ...student,
      fee: group.fee,
      subject: group.name,
      payment_status: displayStatus,
      last_payment_method: lastPaymentMethod,
    };
    setScannedStudent(studentForDisplay);
    const scannedAt = new Date().toISOString();

    if (paidToday) {
      if (navigator.onLine) {
        const { error: attendErr } = await dbInsert({
          table: 'attendance_scans',
          data: {
            student_id: student.id,
            center_id: centerId,
            scanned_by: userId,
            scanned_at: scannedAt,
            payment_status_at_scan: 'paid',
            session_date: scannedAt.split('T')[0],
            payment_recorded: false,
            group_id: group.id,
          },
          select: false,
        });
        if (attendErr) console.error('Attendance scan insert FAILED:', attendErr);
        else notifyParentScan(student.id, 'attended');
      } else {
        await queueScan({
          student_id: student.id,
          center_id: centerId,
          scanned_by: userId,
          scanned_at: scannedAt,
        });
        const count = await getUnsyncedCount();
        setPendingCount(count);
      }
      setLastSuccessStudentName(studentForDisplay.name);
      playBeep(true);
      vibrate(100);
      if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
      resultTimeoutRef.current = setTimeout(() => {
        setScanFrameState('idle');
        setLastSuccessStudentName('');
        resultTimeoutRef.current = null;
      }, 2500);
      setScanFrameState('success');
      setScanHistory((prev) =>
        [
          {
            id: Date.now().toString(),
            studentName: studentForDisplay.name,
            time: new Date(),
            status: 'success' as const,
          },
          ...prev,
        ].slice(0, 10)
      );
      dismissTimerRef.current = setTimeout(() => {
        setScannedStudent(null);
        setSelectedGroup(null);
        isProcessingRef.current = false;
        if (mode === 'manual') {
          setManualIdInput('');
          manualInputRef.current?.focus();
        }
      }, 3000);
    } else if (!paidToday && mode === 'manual') {
      setManualIdInput('');
      manualInputRef.current?.focus();
    }
  }, [scannedStudent, centerId, userId, mode, playBeep, vibrate]);

  const handleAllowLateEntry = async () => {
    if (!scannedStudent || !centerId || !userId || !canAllowLateEntry) return;
    setIsProcessing(true);
    const grp = selectedGroup ?? scannedStudent.groups?.[0];
    const fee = grp?.fee ?? scannedStudent.fee ?? 0;
    const scannedAt = new Date().toISOString();
    const sessionDate = scannedAt.split('T')[0];

    try {
      if (navigator.onLine) {
        const { error: scanErrLate } = await dbInsert({
          table: 'attendance_scans',
          data: {
            student_id: scannedStudent.id,
            center_id: centerId,
            scanned_by: userId,
            scanned_at: scannedAt,
            payment_status_at_scan: 'unpaid',
            session_date: sessionDate,
            payment_recorded: false,
            group_id: grp?.id ?? null,
          },
          select: false,
        });
        if (!scanErrLate) notifyParentScan(scannedStudent.id, 'pending_payment');
        const { data: lateData, error: lateErr } = await dbInsert({
          table: 'payments',
          data: {
            student_id: scannedStudent.id,
            center_id: centerId,
            amount: fee,
            method: 'late_entry',
            recorded_by: userId,
            paid_at: scannedAt,
            status: 'late',
            confirmed: false,
            group_id: grp?.id ?? null,
          },
          select: false,
        });
      }
      setAddedAmountToBalance(fee);
      setScannedStudent({
        ...scannedStudent,
        payment_status: 'late_entry_granted',
        last_payment_method: null,
      });
    } catch {
      setError(t('scanError'));
    } finally {
      setIsProcessing(false);
      dismissTimerRef.current = setTimeout(() => {
        setScannedStudent(null);
        setSelectedGroup(null);
        isProcessingRef.current = false;
        if (mode === 'manual') {
          setManualIdInput('');
          setTimeout(() => manualInputRef.current?.focus(), 100);
        }
      }, 3000);
    }
  };

  const handlePaymentSelect = async (method: string, groupId?: string, amount?: number) => {
    if (!scannedStudent || !centerId || !userId) return;
    setIsProcessing(true);

    const scannedAt = new Date().toISOString();
    const sessionDate = scannedAt.split('T')[0];
    const isCash = method === 'cash' || method === 'نقدي';
    const paymentAmount = amount ?? scannedStudent.fee ?? 0;
    const effectiveGroupId = groupId ?? selectedGroup?.id ?? scannedStudent.groups?.[0]?.id ?? null;

    try {
      if (navigator.onLine) {
        const paymentData: Record<string, unknown> = {
          student_id: scannedStudent.id,
          center_id: centerId,
          amount: paymentAmount,
          method: method === 'نقدي' ? 'cash' : method,
          recorded_by: userId,
          paid_at: scannedAt,
          status: isCash ? 'confirmed' : 'pending',
          confirmed: isCash,
          ...(isCash && { confirmed_at: scannedAt }),
          group_id: effectiveGroupId,
        };

        const { error: payErr } = await dbInsert({
          table: 'payments',
          data: paymentData,
          select: false,
        });
        if (payErr) {
          console.error('Payment insert FAILED:', payErr);
          if (typeof alert !== 'undefined') alert('Payment error: ' + (payErr instanceof Error ? payErr.message : String(payErr)));
        }

        const scanData: Record<string, unknown> = {
          student_id: scannedStudent.id,
          center_id: centerId,
          scanned_by: userId,
          scanned_at: scannedAt,
          payment_status_at_scan: 'unpaid',
          payment_method: method,
          session_date: sessionDate,
          payment_recorded: true,
          group_id: effectiveGroupId,
        };

        const { error: scanErr } = await dbInsert({
          table: 'attendance_scans',
          data: scanData,
          select: false,
        });
        if (scanErr) console.error('Attendance scan insert FAILED:', scanErr);
        else notifyParentScan(scannedStudent.id, isCash ? 'attended' : 'pending_payment');
        await dbInsert({
          table: 'audit_log',
          data: {
            center_id: centerId,
            user_id: userId,
            action: 'payment_on_scan',
            entity_type: 'payment',
            entity_id: scannedStudent.id,
            details: { method, amount: paymentAmount, group_id: effectiveGroupId, status: method === 'cash' ? 'confirmed' : 'pending' },
          },
          select: false,
        });
      } else {
        await queueScan({
          student_id: scannedStudent.id,
          center_id: centerId,
          scanned_by: userId,
          scanned_at: scannedAt,
          payment_action: { method, amount: paymentAmount, isPending: !isCash, group_id: effectiveGroupId ?? undefined },
        });
        await markPaidTodayOffline(centerId, scannedStudent.id);
        const count = await getUnsyncedCount();
        setPendingCount(count);
      }

      setAddedAmountToBalance(isCash ? 0 : paymentAmount);
      setScannedStudent({ ...scannedStudent, payment_status: isCash ? 'paid' : 'pending', last_payment_method: method });
      setIsProcessing(false);

      dismissTimerRef.current = setTimeout(() => {
        setScannedStudent(null);
        isProcessingRef.current = false;
        if (mode === 'manual') {
          setManualIdInput('');
          setTimeout(() => manualInputRef.current?.focus(), 100);
        }
      }, 3000);
    } catch {
      setError(t('scanError'));
      setIsProcessing(false);
    }
  };

  const handleDismiss = () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    if (resultTimeoutRef.current) clearTimeout(resultTimeoutRef.current);
    resultTimeoutRef.current = null;
    setScanFrameState('idle');
    setLastSuccessStudentName('');
    setScannedStudent(null);
    setNeedGroupSelection(false);
    setSelectedGroup(null);
    setAddedAmountToBalance(0);
    isProcessingRef.current = false;
    if (mode === 'manual') {
      setManualIdInput('');
      setTimeout(() => manualInputRef.current?.focus(), 100);
    }
  };

  if (!mounted) return null;

  const scannerFrameTone =
    scanFrameState === 'success' ? 'success' : scanFrameState === 'error' ? 'error' : 'scanning';

  return (
    <>
      <div className="bg-[var(--color-surface-0)] min-h-screen flex flex-col animate-fade-in pb-[calc(56px_+_env(safe-area-inset-bottom,0px))] md:pb-0">
        {!isOnline && (
          <div className="bg-[var(--color-warning)] text-white text-xs font-medium px-4 py-2 flex items-center gap-2 justify-center">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.56 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
            </svg>
            {ts('offline_banner')}
          </div>
        )}

        <div className="flex flex-col gap-3 px-4 pt-4 pb-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{ts('title')}</h1>
            <p className="text-xs text-[var(--color-text-secondary)]">{ts('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => {
                const next = !soundEnabled;
                setSoundEnabled(next);
                localStorage.setItem('chq-scanner-sound', String(next));
              }}
              aria-label={soundEnabled ? ts('sound_on') : ts('sound_off')}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-badge border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-strong)] transition-colors duration-fast ease-out"
            >
              {soundEnabled ? (
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              ) : (
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              )}
              {soundEnabled ? ts('sound_on') : ts('sound_off')}
            </button>
            {pendingCount > 0 && (
              <span className="text-xs text-[var(--color-warning)] font-medium">
                ({Number(pendingCount).toLocaleString('en-US')} {t('pending')})
              </span>
            )}
            {isSyncing ? (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] shadow-sm"
                title={tSync('syncing')}
              >
                <span className="w-2 h-2 rounded-full bg-[var(--color-warning)] animate-pulse" />
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">{tSync('syncing')}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-surface-1)] border border-[var(--color-border-subtle)] shadow-sm">
                <span
                  className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[var(--color-success)] animate-pulse' : 'bg-[var(--color-danger)]'}`}
                />
                <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {isOnline ? ts('connected') : ts('disconnected')}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col px-4 gap-4 max-w-lg mx-auto w-full pb-4">
          <div
            className="flex gap-1 bg-[var(--color-surface-2)] p-1 rounded-xl"
            role="tablist"
            aria-label={ts('tab_bar_label')}
          >
            {[
              { key: 'camera' as const, label: ts('tab_camera'), Icon: Camera },
              { key: 'bluetooth' as const, label: ts('tab_bluetooth'), Icon: Bluetooth },
              { key: 'manual' as const, label: ts('tab_manual'), Icon: Hash },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => {
                  setMode(key);
                  if (key === 'manual') {
                    setManualIdInput('');
                    setTimeout(() => manualInputRef.current?.focus(), 100);
                  } else if (key === 'bluetooth') {
                    setTimeout(() => {
                      const btInput = document.querySelector('[data-bluetooth-scanner-input]') as HTMLInputElement | null;
                      btInput?.focus();
                    }, 100);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm transition-all ${mode === key ? 'bg-[var(--color-surface-1)] shadow-sm font-semibold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
              >
                <Icon className={mode === key && key === 'camera' ? 'w-4 h-4 text-brand-400' : 'w-4 h-4'} />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          {error && (
            <div className="p-3 rounded-lg text-center text-sm border border-[var(--color-danger)] bg-[rgba(239,68,68,0.08)] text-[var(--color-danger)]">
              {error}
            </div>
          )}

          <div className="flex flex-col items-center gap-4 flex-1">
            <div
              className={`scanner-frame w-full max-w-sm aspect-square bg-[var(--color-surface-2)] ${scannerFrameTone} ${mode !== 'camera' ? 'hidden' : ''}`}
              aria-hidden={mode !== 'camera'}
            >
              <div className="absolute inset-0 z-0 min-h-0">
                <CameraScanner
                  key={scannedStudent ? 'camera-hidden' : 'camera-active'}
                  onScan={handleScan}
                  isActive={mode === 'camera' && !scannedStudent}
                  fillContainer
                />
              </div>
              <div className="scan-corner scan-corner-tl z-10 pointer-events-none" />
              <div className="scan-corner scan-corner-tr z-10 pointer-events-none" />
              <div className="scan-corner scan-corner-bl z-10 pointer-events-none" />
              <div className="scan-corner scan-corner-br z-10 pointer-events-none" />
              {scanFrameState !== 'success' && scanFrameState !== 'error' && (
                <div className="scan-line z-20 pointer-events-none" />
              )}
              {scanFrameState === 'success' && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[rgba(16,185,129,0.08)] scan-result">
                  <div
                    className="w-16 h-16 rounded-full bg-[var(--color-success)] flex items-center justify-center"
                  >
                    <svg width="32" height="32" fill="none" stroke="white" strokeWidth="3" viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-[var(--color-success)]">{ts('scan_success')}</p>
                  <p className="text-base font-bold text-[var(--color-text-primary)] px-4 text-center truncate max-w-full">
                    {lastSuccessStudentName}
                  </p>
                </div>
              )}
              {scanFrameState === 'error' && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[rgba(239,68,68,0.08)] scan-result">
                  <div
                    className="w-16 h-16 rounded-full bg-[var(--color-danger)] flex items-center justify-center"
                  >
                    <svg width="32" height="32" fill="none" stroke="white" strokeWidth="3" viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-[var(--color-danger)]">{ts('scan_error')}</p>
                </div>
              )}
            </div>

            {mode === 'bluetooth' && (
              <div className="w-full max-w-sm">
                <BluetoothScanner
                  key={scannedStudent ? 'bt-hidden' : 'bt-active'}
                  onScan={handleScan}
                  isActive={!scannedStudent}
                />
              </div>
            )}

            {mode === 'manual' && !scannedStudent && (
              <div className="space-y-3 w-full max-w-sm">
                <input
                  ref={manualInputRef}
                  type="text"
                  inputMode="text"
                  value={manualIdInput}
                  onChange={(e) => setManualIdInput(e.target.value)}
                  placeholder={t('manualIdPlaceholder')}
                  className="w-full px-4 py-3 border border-[var(--color-border-default)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 bg-[var(--color-surface-1)] font-mono text-center text-lg tracking-widest text-[var(--color-text-primary)]"
                  dir="ltr"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualIdInput.trim()) {
                      e.preventDefault();
                      handleScan(manualIdInput.trim());
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = manualIdInput.trim();
                    if (!trimmed) return;
                    handleScan(trimmed);
                  }}
                  disabled={!manualIdInput.trim()}
                  className="w-full py-3 bg-brand-500 hover:opacity-90 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('checkIn')}
                </button>
              </div>
            )}

            <div className="w-full max-w-sm mt-2">
              <h2
                className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2"
              >
                {ts('history_title')}
              </h2>
              {scanHistory.length === 0 ? (
                <p className="text-sm text-[var(--color-text-tertiary)] text-center py-6">{ts('history_empty')}</p>
              ) : (
                <div className="card overflow-hidden">
                  {scanHistory.map((scan) => (
                    <div
                      key={scan.id}
                      className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] last:border-b-0"
                    >
                      <div
                        className={`w-2 h-2 rounded-full shrink-0 ${scan.status === 'success' || scan.status === 'duplicate' ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                          {scan.studentName}
                        </p>
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          {scan.time.toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <span className={`badge text-xs shrink-0 ${scan.status === 'success' || scan.status === 'duplicate' ? 'badge-success' : 'badge-danger'}`}>
                        {scan.status === 'error' ? '✗' : '✓'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Group Selector sheet */}
      {needGroupSelection && scannedStudent && scannedStudent.groups && scannedStudent.groups.length >= 2 && (() => {
        const q = groupSearchQuery.trim().toLowerCase();
        const filteredGroupsForSheet = q
          ? scannedStudent.groups.filter((g) =>
              g.name.toLowerCase().includes(q) ||
              ((g as { subject?: string | null }).subject ?? '').toLowerCase().includes(q)
            )
          : scannedStudent.groups;
        return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col">
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-12 h-1 rounded-full bg-slate-300" aria-hidden />
            </div>
            <div className="p-4 pb-2 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">{t('selectGroupTitle')}</h2>
              <p className="text-sm text-slate-500 mt-1">{t('selectGroupDesc')}</p>
              {/* Search */}
              <div className="relative mt-3">
                <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
                <input
                  type="search"
                  placeholder={tCommon('search')}
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>
            </div>
            <div className="p-4 overflow-y-auto flex-1 divide-y divide-slate-200">
              {filteredGroupsForSheet.map((g) => (
                <button
                  key={g.id}
                  onClick={() => handleGroupSelect(g)}
                  className="w-full flex items-center gap-3 min-h-[56px] py-4 px-4 rounded-xl hover:bg-slate-50 transition-all text-start first:pt-0"
                >
                  <div className="p-2 bg-teal-100 rounded-lg flex-shrink-0">
                    <BookOpen className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm">{g.name}</p>
                    {(g as { subject?: string | null }).subject && (
                      <p className="text-xs text-slate-500 mt-0.5">{(g as { subject?: string | null }).subject}</p>
                    )}
                    <p className="text-xs font-medium text-teal-600 mt-1">{t('perLesson')} · {tCommon('egp')} {g.fee}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>
        );
      })()}

      {scannedStudent && !needGroupSelection && (
        <ScanResultScreen
          student={scannedStudent}
          selectedGroup={selectedGroup ?? scannedStudent.groups?.[0]}
          onPaymentSelect={handlePaymentSelect}
          onAllowLateEntry={handleAllowLateEntry}
          onDismiss={handleDismiss}
          isProcessing={isProcessing}
          canAllowLateEntry={canAllowLateEntry}
          balanceDue={addedAmountToBalance}
          addedAmount={addedAmountToBalance}
        />
      )}
    </>
  );
}
