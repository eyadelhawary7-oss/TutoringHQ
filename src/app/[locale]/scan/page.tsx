'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert } from '@/lib/db-proxy';
import {
  syncStudentsToLocal,
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
import { useUser } from '@/contexts/UserContext';
import { useLayout } from '@/contexts/LayoutContext';

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
  groups?: { id: string; name: string; fee: number }[];
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

export default function ScanPage() {
  const t = useTranslations('scan');
  const tSync = useTranslations('sync');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const { user, hasPermission } = useUser();
  const { setHideShell } = useLayout();

  const [mode, setMode] = useState<ScanMode>('camera');
  const [manualIdInput, setManualIdInput] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
  const [needGroupSelection, setNeedGroupSelection] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string; fee: number } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [addedAmountToBalance, setAddedAmountToBalance] = useState(0);
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Sync students to IndexedDB when center is available
  const fetchAndSyncStudents = useCallback(async () => {
    if (!centerId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data } = await dbSelect({
        table: 'students',
        select: 'id, name, phone, parent_phone, subject, fee, qr_code, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
      });
      if (data && Array.isArray(data)) {
        await syncStudentsToLocal(data);
      }
    } catch (err) {
      console.error('Failed to sync students:', err);
    }
  }, [centerId]);

  const canAllowLateEntry = user?.role === 'owner' || user?.role === 'admin' || hasPermission('can_allow_late_entry');

  useEffect(() => {
    setHideShell(!!scannedStudent);
    return () => setHideShell(false);
  }, [scannedStudent, setHideShell]);

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

  useEffect(() => {
    if (centerId) {
      fetchAndSyncStudents();
    }
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

    try {
      // Offline-first: try IndexedDB first
      let student: Student | null = (await getStudentOffline(value) as Student | undefined) || null;

      // If not in IndexedDB and online, fetch from API
      if (!student && navigator.onLine) {
        const filters = byId
          ? [{ column: 'id', op: 'eq' as const, value }, { column: 'center_id', op: 'eq' as const, value: centerId }]
          : [{ column: 'student_number', op: 'eq' as const, value: value.toUpperCase() }, { column: 'center_id', op: 'eq' as const, value: centerId }];
        const { data, error: lookupError } = await dbSelect({
          table: 'students',
          select: 'id, name, phone, parent_phone, subject, fee, student_number',
          filters,
          single: true,
        });
        if (!lookupError && data) {
          student = data as Student;
        }
      }

      if (!student && navigator.onLine && /^\d{10,11}$/.test(code.trim())) {
        const normalizedPhone = code.trim().startsWith('0')
          ? '+2' + code.trim()
          : '+' + code.trim();
        const { data, error: phoneError } = await dbSelect({
          table: 'students',
          select: 'id, name, phone, parent_phone, subject, fee, student_number',
          filters: [
            { column: 'phone', op: 'eq', value: normalizedPhone },
            { column: 'center_id', op: 'eq', value: centerId },
          ],
          single: true,
        });
        if (!phoneError && data) student = data as Student;
      }

      // When online, ALWAYS fetch groups for the student (whether from IndexedDB or API)
      if (student && navigator.onLine) {
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
      }

      if (!student) {
        setError(t('studentNotFound'));
        isProcessingRef.current = false;
        setTimeout(() => setError(''), 3000);
        return;
      }

      const groups = student.groups ?? [];
      const hasMultipleGroups = groups.length >= 2;

      // If 2+ groups: show group selector BEFORE checking payment
      if (hasMultipleGroups && navigator.onLine) {
        setSelectedGroup(null);
        setNeedGroupSelection(true);
        setScannedStudent({ ...student, payment_status: '', last_payment_method: null });
        isProcessingRef.current = false;
        if (mode === 'manual') setManualIdInput('');
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
        dismissTimerRef.current = setTimeout(() => {
          setScannedStudent(null);
          setSelectedGroup(null);
          isProcessingRef.current = false;
          if (mode === 'manual') {
            setManualIdInput('');
            manualInputRef.current?.focus();
          }
        }, 3000);
      }
      if (mode === 'manual' && !paidToday) {
        setManualIdInput('');
        manualInputRef.current?.focus();
      }
    } catch {
      setError(t('scanError'));
      isProcessingRef.current = false;
    }
  }, [centerId, userId, t, mode]);

  const handleGroupSelect = useCallback(async (group: { id: string; name: string; fee: number }) => {
    if (!scannedStudent || !centerId || !userId) return;
    setSelectedGroup(group);
    setNeedGroupSelection(false);

    const student = scannedStudent;
    let paidToday = false;
    let lastPaymentMethod: string | null = null;

    if (navigator.onLine) {
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

    if (paidToday && navigator.onLine) {
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
  }, [scannedStudent, centerId, userId, mode]);

  const handleAllowLateEntry = async () => {
    if (!scannedStudent || !centerId || !userId || !canAllowLateEntry) return;
    setIsProcessing(true);
    const grp = selectedGroup ?? scannedStudent.groups?.[0];
    const fee = grp?.fee ?? scannedStudent.fee ?? 0;
    const scannedAt = new Date().toISOString();
    const sessionDate = scannedAt.split('T')[0];

    try {
      if (navigator.onLine) {
        await dbInsert({
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
        console.log('Late entry payment insert:', lateErr ? { error: lateErr } : { success: lateData });
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
    const isCash = method === 'cash';
    const paymentAmount = amount ?? scannedStudent.fee ?? 0;
    const effectiveGroupId = groupId ?? selectedGroup?.id ?? scannedStudent.groups?.[0]?.id ?? null;

    try {
      if (navigator.onLine) {
        const paymentData: Record<string, unknown> = {
          student_id: scannedStudent.id,
          center_id: centerId,
          amount: paymentAmount,
          method,
          recorded_by: userId,
          paid_at: scannedAt,
          status: isCash ? 'confirmed' : 'pending',
          confirmed: isCash,
          group_id: effectiveGroupId,
        };

        console.log('Recording payment:', { student_id: scannedStudent.id, center_id: centerId, amount: paymentAmount, method });
        const { data: payData, error: payErr } = await dbInsert({
          table: 'payments',
          data: paymentData,
          select: false,
        });
        if (payErr) {
          console.error('Payment insert FAILED:', payErr);
          if (typeof alert !== 'undefined') alert('Payment error: ' + (payErr instanceof Error ? payErr.message : String(payErr)));
        } else {
          console.log('Payment insert SUCCESS:', payData);
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

  return (
    <>
      {/* Main scanner UI — normal app navigation (sidebar/bottom bar) visible in idle */}
      <div className="p-4 md:p-6 space-y-5 animate-fade-in">
        {/* Top bar: title left, Online/Offline indicator top-right */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <span className="text-xs text-amber-500 font-medium">
                ({pendingCount} {t('pending')})
              </span>
            )}
            {isSyncing ? (
              <div className="flex items-center gap-1.5" title={tSync('syncing')}>
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs text-amber-500 hidden sm:inline">{tSync('syncing')}</span>
              </div>
            ) : (
              <div
                className={`flex items-center gap-1.5 ${isOnline ? 'text-green-500' : 'text-red-500'}`}
                title={isOnline ? tSync('online') : tSync('offline')}
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}
                />
                <span className="text-xs font-medium hidden sm:inline">
                  {isOnline ? tSync('online') : tSync('offline')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 3 input mode tabs — segmented control, active = teal */}
        <div className="flex gap-1 p-1 rounded-xl border border-border w-full max-w-md" style={{ background: 'hsl(var(--muted))' }}>
          {[
            { key: 'camera' as const, label: t('camera'), icon: '📷' },
            { key: 'bluetooth' as const, label: t('bluetooth'), icon: '🔗' },
            { key: 'manual' as const, label: t('manualId'), icon: '🔢' },
          ].map(({ key, label, icon }) => (
            <button
              key={key}
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
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                mode === key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground'
              }`}
            >
              <span>{icon}</span>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-center text-sm">
            {error}
          </div>
        )}

        {/* Scanner body */}
        <div className="flex flex-col items-center gap-6">
          {mode === 'camera' && (
            <CameraScanner
              key={scannedStudent ? 'camera-hidden' : 'camera-active'}
              onScan={handleScan}
              isActive={!scannedStudent}
            />
          )}

          {mode === 'bluetooth' && (
            <BluetoothScanner
              key={scannedStudent ? 'bt-hidden' : 'bt-active'}
              onScan={handleScan}
              isActive={!scannedStudent}
            />
          )}

          {mode === 'manual' && !scannedStudent && (
            <div className="w-full max-w-sm space-y-3">
              <input
                ref={manualInputRef}
                type="text"
                inputMode="text"
                value={manualIdInput}
                onChange={(e) => setManualIdInput(e.target.value)}
                placeholder={t('manualIdPlaceholder')}
                className="w-full px-4 py-3 rounded-xl border border-input bg-background text-foreground text-base focus:outline-none focus:ring-2 focus:ring-ring"
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
                onClick={() => {
                  const trimmed = manualIdInput.trim();
                  if (!trimmed) return;
                  handleScan(trimmed);
                }}
                disabled={!manualIdInput.trim()}
                className="w-full py-3 rounded-xl font-bold text-sm text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {t('checkIn')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Group Selector — Lovable-style modal */}
      {needGroupSelection && scannedStudent && scannedStudent.groups && scannedStudent.groups.length >= 2 && (
        <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border overflow-hidden bg-card shadow-xl">
            <div className="p-5 border-b border-border">
              <h2 className="font-bold text-foreground text-lg">{t('selectGroupTitle')}</h2>
              <p className="text-muted-foreground text-sm mt-1">{scannedStudent.name} — {scannedStudent.student_number ?? '—'}</p>
              <p className="text-muted-foreground text-xs mt-0.5">{t('selectGroupDesc')}</p>
            </div>
            <div className="p-3 space-y-2">
              {scannedStudent.groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => handleGroupSelect(g)}
                  className="w-full flex items-center justify-between p-4 rounded-xl border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-start"
                >
                  <div>
                    <div className="font-semibold text-foreground">{g.name}</div>
                    <div className="text-sm text-muted-foreground">{t('perLesson')}</div>
                  </div>
                  <span className="font-bold text-foreground font-mono text-sm">{g.fee} {tCommon('egp')}</span>
                </button>
              ))}
              <button
                onClick={handleDismiss}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {tCommon('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

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
