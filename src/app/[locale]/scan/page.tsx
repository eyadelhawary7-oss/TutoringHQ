'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate } from '@/lib/db-proxy';
import Navbar from '@/components/Navbar';
import CameraScanner from '@/components/CameraScanner';
import BluetoothScanner from '@/components/BluetoothScanner';
import ScanResultScreen from '@/components/ScanResultScreen';

type ScanMode = 'camera' | 'bluetooth';

interface Student {
  id: string;
  name: string;
  payment_status: string;
  monthly_fee: number;
  subject_name: string;
}

export default function ScanPage() {
  const t = useTranslations('scan');

  const [mode, setMode] = useState<ScanMode>('camera');
  const [scannedStudent, setScannedStudent] = useState<Student | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingRef = useRef(false);

  useEffect(() => {
    const loadUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setUserId(session.user.id);

      // Use /api/me to bypass RLS on users table
      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (meData?.user?.center_id) {
        setCenterId(meData.user.center_id);
      }
    };
    loadUser();

    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handleScan = useCallback(async (code: string) => {
    // Prevent duplicate scans while processing
    if (isProcessingRef.current || !centerId || !userId) return;
    isProcessingRef.current = true;
    setError('');

    try {
      // Lookup student by ID (QR encodes the UUID)
      const { data: student, error: lookupError } = await dbSelect({
        table: 'students',
        select: '*',
        filters: [{ column: 'id', op: 'eq', value: code }, { column: 'center_id', op: 'eq', value: centerId }],
        single: true,
      });

      if (lookupError || !student) {
        setError(t('studentNotFound'));
        isProcessingRef.current = false;
        setTimeout(() => setError(''), 3000);
        return;
      }

      setScannedStudent(student);

      // Record attendance
      await dbInsert({
        table: 'attendance_scans',
        data: {
          student_id: student.id,
          center_id: centerId,
          scanned_by: userId,
          scanned_at: new Date().toISOString(),
        },
        select: false,
      });

      // Auto-dismiss for paid students after 3 seconds
      if (student.payment_status === 'paid') {
        dismissTimerRef.current = setTimeout(() => {
          setScannedStudent(null);
          isProcessingRef.current = false;
        }, 3000);
      }
    } catch {
      setError(t('scanError'));
      isProcessingRef.current = false;
    }
  }, [centerId, userId, t]);

  const handlePaymentSelect = async (method: string) => {
    if (!scannedStudent || !centerId || !userId) return;
    setIsProcessing(true);

    try {
      // Update student payment status
      await dbUpdate({
        table: 'students',
        data: {
          payment_status: 'paid',
          last_paid_date: new Date().toISOString(),
        },
        filters: [{ column: 'id', op: 'eq', value: scannedStudent.id }],
      });

      // Create payment record
      await dbInsert({
        table: 'payments',
        data: {
          student_id: scannedStudent.id,
          center_id: centerId,
          amount: scannedStudent.monthly_fee,
          payment_method: method,
          payment_date: new Date().toISOString(),
          created_by: userId,
        },
        select: false,
      });

      // Log to audit
      await dbInsert({
        table: 'audit_log',
        data: {
          center_id: centerId,
          user_id: userId,
          action: 'payment_on_scan',
          entity_type: 'payment',
          entity_id: scannedStudent.id,
          details: { method, amount: scannedStudent.monthly_fee },
        },
        select: false,
      });

      // Show green screen then dismiss
      setScannedStudent({ ...scannedStudent, payment_status: 'paid' });
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
  };

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('title')}
            </h1>
          </div>

          {/* Mode Toggle */}
          <div className="flex bg-white dark:bg-gray-800 rounded-xl shadow p-1 mb-6 max-w-sm mx-auto">
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
          </div>

          {/* Error */}
          {error && (
            <div className="max-w-md mx-auto mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-lg text-center text-sm">
              {error}
            </div>
          )}

          {/* Scanner */}
          <CameraScanner onScan={handleScan} isActive={mode === 'camera' && !scannedStudent} />
          <BluetoothScanner onScan={handleScan} isActive={mode === 'bluetooth' && !scannedStudent} />
        </div>
      </div>

      {/* Full Screen Result Overlay */}
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
