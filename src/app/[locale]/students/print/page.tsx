'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import Navbar from '@/components/Navbar';
import QRCode from 'qrcode';

interface Student {
  id: string;
  name: string;
  subject: string;
  student_number?: string | null;
  qr_code: string | null;
}

interface StudentWithQR extends Student {
  qrDataUrl: string;
}

export default function PrintStudentsPage() {
  const t = useTranslations('print');
  const tStudents = useTranslations('students');

  const [students, setStudents] = useState<Student[]>([]);
  const [centerLogo, setCenterLogo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('all');

  useEffect(() => {
    const loadStudents = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;

      if (meData?.user?.center?.logo_url) {
        setCenterLogo(meData.user.center.logo_url);
      }

      // Fetch ALL students for this center (not filtered by qr_code)
      const { data, error } = await dbSelect({
        table: 'students',
        select: 'id, name, subject, qr_code, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        order: { column: 'name' },
      });

      console.log('Students fetched:', (data || []).length, error);

      if (data && Array.isArray(data)) {
        setStudents(data as Student[]);
        const uniqueSubjects = [...new Set((data as { subject: string }[]).map(s => s.subject).filter(Boolean))] as string[];
        setSubjects(uniqueSubjects);
      }
      setIsLoading(false);
    };

    loadStudents();
  }, []);

  const filteredStudents = selectedSubject === 'all'
    ? students
    : students.filter(s => s.subject === selectedSubject);

  // Generate QR on the fly for students without qr_code
  const studentsWithQR = useMemo(() => {
    return filteredStudents.map(s => ({
      ...s,
      qrDataUrl: s.qr_code || '',
    }));
  }, [filteredStudents]);

  const [readyStudents, setReadyStudents] = useState<StudentWithQR[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results: StudentWithQR[] = [];
      for (const s of studentsWithQR) {
        if (cancelled) return;
        let qrDataUrl = s.qr_code;
        if (!qrDataUrl) {
          try {
            qrDataUrl = await QRCode.toDataURL(s.id, {
              width: 200,
              margin: 2,
              color: { dark: '#000000', light: '#FFFFFF' },
            });
          } catch {
            qrDataUrl = '';
          }
        }
        results.push({ ...s, qrDataUrl: qrDataUrl || '' });
      }
      if (!cancelled) setReadyStudents(results);
    };
    load();
    return () => { cancelled = true; };
  }, [studentsWithQR]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <div className="print:hidden">
        <Navbar />
      </div>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 print:bg-white print:dark:bg-white">
        <div className="print:hidden max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('title')}
            </h1>
            <div className="flex gap-3 items-center">
              <select
                value={selectedSubject}
                onChange={(e) => setSelectedSubject(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t('allSubjects')}</option>
                {subjects.map((subject) => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
              <button
                onClick={handlePrint}
                className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
              >
                {t('printButton')}
              </button>
            </div>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t('cardsPerPage')} — {readyStudents.length} {tStudents('title')}
          </p>
        </div>

        {isLoading ? (
          <div className="text-center py-16 print:hidden">
            <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
        ) : readyStudents.length === 0 ? (
          <div className="text-center py-16 print:hidden">
            <p className="text-gray-600 dark:text-gray-400">{t('noCards')}</p>
          </div>
        ) : (
          <div className="printable-cards max-w-[210mm] mx-auto px-4 print:px-[10mm] py-8 print:py-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 print:gap-[4mm] print:grid-cols-4">
              {readyStudents.map((student) => (
                <div
                  key={student.id}
                  className="border border-gray-300 rounded-lg p-4 print:p-[3mm] print:border-gray-400 flex flex-col items-center justify-center text-center bg-white dark:bg-gray-800 print:dark:bg-white"
                  style={{
                    width: '90mm',
                    height: '55mm',
                    minWidth: '90mm',
                    minHeight: '55mm',
                    pageBreakInside: 'avoid',
                    breakInside: 'avoid',
                  }}
                >
                  {centerLogo ? (
                    <img src={centerLogo} alt="Logo" className="h-8 w-auto object-contain mb-1 print:mb-1" />
                  ) : (
                    <div className="text-xs font-bold text-indigo-600 print:text-indigo-600 mb-1">CenterHQ</div>
                  )}
                  <p className="text-base font-bold text-gray-900 print:text-gray-900 dark:text-white print:dark:text-gray-900 mb-0.5 line-clamp-1" style={{ fontSize: '16px' }}>
                    {student.name}
                  </p>
                  {student.subject && (
                    <p className="text-xs text-gray-600 print:text-gray-600 dark:text-gray-400 print:dark:text-gray-600 mb-1">
                      {student.subject}
                    </p>
                  )}
                  {student.student_number && (
                    <p className="text-xs text-gray-500 print:text-gray-600 mb-2" dir="ltr">
                      {student.student_number}
                    </p>
                  )}
                  {student.qrDataUrl && (
                    <img
                      src={student.qrDataUrl}
                      alt={`QR: ${student.name}`}
                      className="w-24 h-24 print:w-[22mm] print:h-[22mm]"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .printable-cards,
          .printable-cards * {
            visibility: visible !important;
          }
          .printable-cards {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          nav, .print\\:hidden {
            display: none !important;
          }
          @page {
            size: A4;
            margin: 10mm;
          }
          .dark\\:bg-gray-800 {
            background-color: white !important;
          }
          .dark\\:text-white {
            color: #111827 !important;
          }
        }
      `}</style>
    </>
  );
}
