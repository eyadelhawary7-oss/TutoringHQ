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
} from '@/lib/db';
import { syncQueuedScans } from '@/lib/sync';
import Navbar from '@/components/Navbar';
import CameraScanner from '@/components/CameraScanner';
import BluetoothScanner from '@/components/BluetoothScanner';
import ScanResultScreen from '@/components/ScanResultScreen';

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
}

export default function ScanPage() {
  const t = useTranslations('scan');
  const tSync = useTranslations('sync');

  const [mode, setMode] = useState<ScanMode>('camera');
  const [manualIdInput, setManualIdInput] = useState('');
  const manualInputRef = useRef<HTMLInputElement>(null);
  const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
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
        select: 'id, name, phone, parent_phone, subject, payment_status, fee, qr_code, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
      });
      if (data && Array.isArray(data)) {
        await syncStudentsToLocal(data);
      }
    } catch (err) {
      console.error('Failed to sync students:', err);
    }
  }, [centerId]);

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
          select: 'id, name, phone, parent_phone, subject, payment_status, fee, student_number',
          filters,
          single: true,
        });
        if (!lookupError && data) student = data as Student;
      }

      if (!student) {
        setError(t('studentNotFound'));
        isProcessingRef.current = false;
        setTimeout(() => setError(''), 3000);
        return;
      }

      setScannedStudent(student);
      const scannedAt = new Date().toISOString();

      if (student.payment_status === 'paid') {
        // Paid: record attendance immediately with payment_status_at_scan
        if (navigator.onLine) {
          await dbInsert({
            table: 'attendance_scans',
            data: {
              student_id: student.id,
              center_id: centerId,
              scanned_by: userId,
              scanned_at: scannedAt,
              payment_status_at_scan: 'paid',
            },
            select: false,
          });
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
          isProcessingRef.current = false;
          if (mode === 'manual') {
            setManualIdInput('');
            manualInputRef.current?.focus();
          }
        }, 3000);
      }
      if (mode === 'manual') {
        setManualIdInput('');
        manualInputRef.current?.focus();
      }
    } catch {
      setError(t('scanError'));
      isProcessingRef.current = false;
    }
  }, [centerId, userId, t, mode]);

  const handlePaymentSelect = async (method: string) => {
    if (!scannedStudent || !centerId || !userId) return;
    setIsProcessing(true);

    const scannedAt = new Date().toISOString();
    const isCash = method === 'cash';
    const paymentStatus = isCash ? 'paid' : 'pending';

    try {
      if (navigator.onLine) {
        await dbUpdate({
          table: 'students',
          data: {
            payment_status: paymentStatus,
            ...(isCash ? { last_paid_date: scannedAt } : {}),
          },
          filters: [{ column: 'id', op: 'eq', value: scannedStudent.id }],
        });
        await dbInsert({
          table: 'payments',
          data: {
            student_id: scannedStudent.id,
            center_id: centerId,
            amount: scannedStudent.fee,
            payment_method: method,
            payment_date: scannedAt,
            created_by: userId,
            status: paymentStatus,
          },
          select: false,
        });
        await dbInsert({
          table: 'attendance_scans',
          data: {
            student_id: scannedStudent.id,
            center_id: centerId,
            scanned_by: userId,
            scanned_at: scannedAt,
            payment_status_at_scan: 'unpaid',
            payment_method: method,
          },
          select: false,
        });
        await dbInsert({
          table: 'audit_log',
          data: {
            center_id: centerId,
            user_id: userId,
            action: 'payment_on_scan',
            entity_type: 'payment',
            entity_id: scannedStudent.id,
            details: { method, amount: scannedStudent.fee, status: paymentStatus },
          },
          select: false,
        });
      } else {
        await queueScan({
          student_id: scannedStudent.id,
          center_id: centerId,
          scanned_by: userId,
          scanned_at: scannedAt,
          payment_action: { method, amount: scannedStudent.fee, isPending: !isCash },
        });
        const count = await getUnsyncedCount();
        setPendingCount(count);
        const { getDB } = await import('@/lib/db');
        const db = await getDB();
        const tx = db.transaction('students', 'readwrite');
        const existing = await tx.store.get(scannedStudent.id);
        if (existing) {
          await tx.store.put({ ...existing, payment_status: paymentStatus });
        }
        await tx.done;
      }

      setScannedStudent({ ...scannedStudent, payment_status: paymentStatus, last_payment_method: method });
      setIsProcessing(false);

      dismissTimerRef.current = setTimeout(() => {
        setScannedStudent(null);
        isProcessingRef.current = false;
      }, 3000);
    } catch {
      setError(t('scanError'));
      setIsProcessing(false);
    }
  };

  const handleDismiss = () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    setScannedStudent(null);
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
          <CameraScanner onScan={handleScan} isActive={mode === 'camera' && !scannedStudent} />
          <BluetoothScanner onScan={handleScan} isActive={mode === 'bluetooth' && !scannedStudent} />
        </div>
      </div>

      {scannedStudent && (
        <ScanResultScreen
          student={scannedStudent}
          onPaymentSelect={handlePaymentSelect}
          onDismiss={handleDismiss}
          isProcessing={isProcessing}
        />
      )}
    </>
  );
}
