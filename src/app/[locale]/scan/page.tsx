'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate } from '@/lib/db-proxy';
import {
  syncStudentsToLocal,
  getStudentOffline,
  queueScan,
  getUnsyncedCount,
  hasPaidTodayOffline,
  markPaidTodayOffline,
} from '@/lib/db';
import { syncQueuedScans } from '@/lib/sync';
import Navbar from '@/components/Navbar';
import CameraScanner from '@/components/CameraScanner';
import BluetoothScanner from '@/components/BluetoothScanner';
import ScanResultScreen from '@/components/ScanResultScreen';
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
  const { user, hasPermission } = useUser();

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
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);

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
    if (isProcessingRef.current || !centerId || !userId) return;
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
    isProcessingRef.current = false;
    if (mode === 'manual') {
      setManualIdInput('');
      setTimeout(() => manualInputRef.current?.focus(), 100);
    }
  };

  const syncIndicatorColor = isSyncing
    ? 'bg-yellow-500 animate-pulse'
    : isOnline
      ? 'bg-green-500'
      : 'bg-red-500';

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('title')}
            </h1>
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${syncIndicatorColor}`} />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {isOnline ? tSync('online') : tSync('offline')}
              </span>
              {pendingCount > 0 && (
                <span className="text-xs text-orange-600 dark:text-orange-400">
                  ({pendingCount} {t('pending')})
                </span>
              )}
            </div>
          </div>

          <div className="flex bg-white dark:bg-gray-800 rounded-xl shadow p-1 mb-6 max-w-lg mx-auto">
            <button
              onClick={() => setMode('camera')}
              className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'camera'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {t('cameraMode')}
            </button>
            <button
              onClick={() => setMode('bluetooth')}
              className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'bluetooth'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {t('bluetoothMode')}
            </button>
            <button
              onClick={() => { setMode('manual'); setManualIdInput(''); setTimeout(() => manualInputRef.current?.focus(), 100); }}
              className={`flex-1 py-3 px-4 rounded-lg text-sm font-medium transition-colors ${
                mode === 'manual'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              {t('manualIdMode')}
            </button>
          </div>

          {error && (
            <div className="max-w-md mx-auto mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-center text-sm">
              {error}
            </div>
          )}

          {mode === 'manual' && !scannedStudent && (
            <div className="max-w-md mx-auto p-6 bg-white dark:bg-gray-800 rounded-xl shadow space-y-4">
              <div>
                <label htmlFor="manual-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('manualIdPlaceholder')}
                </label>
                <input
                  ref={manualInputRef}
                  id="manual-id"
                  type="text"
                  value={manualIdInput}
                  onChange={(e) => setManualIdInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualIdInput.trim()) {
                      e.preventDefault();
                      handleScan(manualIdInput.trim());
                    }
                  }}
                  placeholder="STU-00042 or 42"
                  className="w-full px-4 py-3 text-lg border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  dir="ltr"
                  autoFocus
                />
              </div>
              <button
                onClick={() => manualIdInput.trim() && handleScan(manualIdInput.trim())}
                disabled={!manualIdInput.trim()}
                className="w-full py-4 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-xl text-lg transition-colors"
              >
                {t('checkIn')}
              </button>
            </div>
          )}
          <CameraScanner key={scannedStudent ? 'camera-hidden' : 'camera-active'} onScan={handleScan} isActive={mode === 'camera' && !scannedStudent} />
          <BluetoothScanner key={scannedStudent ? 'bt-hidden' : 'bt-active'} onScan={handleScan} isActive={mode === 'bluetooth' && !scannedStudent} />
        </div>
      </div>

      {/* Group Selector - show when student has 2+ groups, before green/red */}
      {needGroupSelection && scannedStudent && scannedStudent.groups && scannedStudent.groups.length >= 2 && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-800 dark:bg-slate-900 min-h-screen w-full"
          dir="rtl"
        >
          <h1 className="text-4xl sm:text-6xl font-bold text-white text-center px-4 mb-2">
            {scannedStudent.name}
          </h1>
          <p className="text-xl text-white/90 text-center mb-6">
            {t('chooseLesson')}
          </p>
          <div className="w-full max-w-md px-4 grid grid-cols-1 gap-4">
            {scannedStudent.groups.map((g) => (
              <button
                key={g.id}
                onClick={() => handleGroupSelect(g)}
                className="py-5 px-6 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white font-bold rounded-xl border-2 border-white/30 transition-all text-lg text-center"
              >
                <div>{g.name}</div>
                <div className="text-base font-normal opacity-90 mt-1">
                  {g.fee} EGP {t('perLesson')}
                </div>
              </button>
            ))}
          </div>
          <button
            onClick={handleDismiss}
            className="mt-8 px-6 py-2 text-white/80 hover:text-white text-sm"
          >
            {tCommon('cancel')}
          </button>
        </div>
      )}

      {scannedStudent && !needGroupSelection && (
        <ScanResultScreen
          student={scannedStudent}
          selectedGroup={selectedGroup ?? scannedStudent.groups?.[0]}
          onPaymentSelect={handlePaymentSelect}
          onDismiss={handleDismiss}
          isProcessing={isProcessing}
        />
      )}
    </>
  );
}
