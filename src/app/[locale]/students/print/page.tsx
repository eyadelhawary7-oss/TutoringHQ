'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import { QRCard } from '@/components/QRCard';
import { QrCode } from 'lucide-react';

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
  const [centerName, setCenterName] = useState('CenterHQ');
  const [isLoading, setIsLoading] = useState(true);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadStudents = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();

      if (!meData?.user?.center_id) return;

      if (meData?.user?.center?.logo_url) {
        setCenterLogo(meData.user.center.logo_url);
      }
      if (meData?.user?.center?.name) {
        setCenterName(meData.user.center.name);
      }

      const { data, error } = await dbSelect({
        table: 'students',
        select: 'id, name, subject, qr_code, student_number',
        filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        order: { column: 'name' },
      });

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

  const selectableStudents = readyStudents;
  const selectedStudents = selectableStudents.filter(s => selectedIds.has(s.id));
  const allSelected = selectableStudents.length > 0 && selectedIds.size === selectableStudents.length;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(selectableStudents.map(s => s.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      <div className="print-page min-h-screen bg-background print:min-h-0 print:bg-transparent animate-fade-in">
        {/* Selection UI - hidden in print */}
        <div className="selection-controls no-print max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
            <div className="flex flex-wrap gap-3 items-center">
              <button
                type="button"
                onClick={allSelected ? deselectAll : selectAll}
                className="px-4 py-2 rounded-xl text-sm font-medium border border-border text-muted-foreground hover:bg-muted"
              >
                {allSelected ? t('deselectAll') : t('selectAll')}
              </button>
              <span className="text-sm text-muted-foreground">{t('selectedCount', { count: selectedStudents.length })}</span>
              <select
                value={selectedSubject}
                onChange={(e) => {
                  setSelectedSubject(e.target.value);
                  setSelectedIds(new Set());
                }}
                className="px-3 py-2 border border-border rounded-xl text-sm bg-white text-foreground"
              >
                <option value="all">{t('allSubjects')}</option>
                {subjects.map((subject) => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
              <button
                onClick={handlePrint}
                disabled={selectedStudents.length === 0}
                className="flex items-center gap-2 px-6 py-2 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'hsl(var(--primary))' }}
              >
                <QrCode size={16} /> {t('printButton')}
              </button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{t('cardsPerPage')}</p>

          {isLoading ? (
            <div className="text-center py-16">
              <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full mx-auto" />
            </div>
          ) : selectableStudents.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-muted-foreground">{t('noCards')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {selectableStudents.map((student) => (
                <label
                  key={student.id}
                  className="ch-card flex items-center gap-3 p-3 rounded-xl cursor-pointer hover:bg-muted transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(student.id)}
                    onChange={() => toggleSelect(student.id)}
                    className="rounded accent-teal-600 w-4 h-4"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground truncate">{student.name}</div>
                    <div className="text-xs font-mono text-muted-foreground truncate" dir="ltr">
                      {student.student_number || '—'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Printable cards - preview on screen, only content when printing */}
        <div className={`print-cards-only ${selectedStudents.length > 0 ? 'block' : 'hidden'} print:!block py-8 px-4`}>
          {selectedStudents.length > 0 && (
            <div className="print-cards-grid grid grid-cols-2 gap-4 max-w-[210mm] mx-auto">
              {selectedStudents.map((student) => (
                <div key={student.id} className="print-card">
                  <QRCard
                    student={student}
                    qrDataUrl={student.qrDataUrl || null}
                    centerLogo={centerLogo}
                    centerName={centerName}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          nav, header, footer, .sidebar, .bottom-nav, .top-bar, button, .no-print, .selection-controls, input[type="checkbox"], select {
            display: none !important;
            visibility: hidden !important;
          }

          /* Show ONLY the card grid */
          .print-cards-only {
            display: block !important;
            visibility: visible !important;
          }

          .print-cards-grid {
            display: grid !important;
            grid-template-columns: repeat(2, 1fr) !important;
            gap: 4mm !important;
            padding: 10mm !important;
            visibility: visible !important;
          }

          .print-card {
            width: 85.6mm !important;
            height: 54mm !important;
            min-width: 85.6mm !important;
            min-height: 54mm !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          /* Page break after every 8 cards (2 columns x 4 rows) */
          .print-card:nth-child(8n) {
            page-break-after: always !important;
          }

          @page {
            size: A4;
            margin: 10mm;
          }

          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Reset main layout for print - no sidebar offset */
          .app-mode-main,
          main {
            padding-inline-start: 0 !important;
          }
        }
      `}</style>
    </>
  );
}
