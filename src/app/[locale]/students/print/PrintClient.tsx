'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';

export interface PrintStudentRow {
  id: string;
  name: string;
  subject: string;
  student_number?: string | null;
  qr_code: string | null;
}

interface PrintClientProps {
  students: PrintStudentRow[];
  centerName: string;
  centerPhone: string;
  academicYear: string;
  studentGroupMap: Record<string, string>;
}

interface StudentWithQR extends PrintStudentRow {
  qrDataUrl: string;
}

export default function PrintClient({
  students,
  centerName,
  centerPhone,
  academicYear,
  studentGroupMap,
}: PrintClientProps) {
  const t = useTranslations('print');
  const tStudents = useTranslations('students');
  const initializedSubjectsRef = useRef(false);

  const [subjects, setSubjects] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showGroup, setShowGroup] = useState(false);
  const [readyStudents, setReadyStudents] = useState<StudentWithQR[]>([]);

  useEffect(() => {
    if (initializedSubjectsRef.current || students.length === 0) return;
    initializedSubjectsRef.current = true;
    const uniqueSubjects = [
      ...new Set(students.map((s) => s.subject).filter(Boolean)),
    ] as string[];
    setSubjects(uniqueSubjects);
  }, [students]);

  const filteredStudents =
    selectedSubject === 'all' ? students : students.filter((s) => s.subject === selectedSubject);

  const studentsWithQR = useMemo(() => {
    return filteredStudents.map((s) => ({
      ...s,
      qrDataUrl: s.qr_code || '',
    }));
  }, [filteredStudents]);

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
    void load();
    return () => {
      cancelled = true;
    };
  }, [studentsWithQR]);

  const selectableStudents = readyStudents;
  const selectedStudents = selectableStudents.filter((s) => selectedIds.has(s.id));
  const allSelected = selectableStudents.length > 0 && selectedIds.size === selectableStudents.length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(selectableStudents.map((s) => s.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  return (
    <>
      <div className="bg-[var(--color-surface-0)] min-h-screen p-4 print-page print:min-h-0 print:bg-[var(--color-surface-1)] print:p-0">
        <div className="print-hide">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                {tStudents('print_card_count', {
                  count: selectedStudents.length.toLocaleString('en-US'),
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={selectedStudents.length === 0}
              className="btn btn-primary gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
              {tStudents('print_cards')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-4">
            <button
              type="button"
              onClick={allSelected ? deselectAll : selectAll}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-[var(--color-border-default)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
            >
              {allSelected ? t('deselectAll') : t('selectAll')}
            </button>
            <span className="text-sm text-[var(--color-text-secondary)]">
              {t('selectedCount', { count: selectedStudents.length })}
            </span>
            <select
              value={selectedSubject}
              onChange={(e) => {
                setSelectedSubject(e.target.value);
                setSelectedIds(new Set());
              }}
              className="px-3 py-2 border border-[var(--color-border-default)] rounded-xl text-sm bg-[var(--color-surface-1)] text-[var(--color-text-primary)]"
            >
              <option value="all">{t('allSubjects')}</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showGroup}
                onChange={(e) => setShowGroup(e.target.checked)}
                className="rounded accent-teal-600 w-4 h-4"
              />
              {tStudents('printShowGroup')}
            </label>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{t('cardsPerPage')}</p>

          {selectableStudents.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-[var(--color-text-secondary)]">{t('noCards')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-8">
              {selectableStudents.map((student) => (
                <label
                  key={student.id}
                  className="flex items-center gap-3 p-3 rounded-xl cursor-pointer border border-[var(--color-border-default)] bg-[var(--color-surface-1)] hover:bg-[var(--color-surface-2)] transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(student.id)}
                    onChange={() => toggleSelect(student.id)}
                    className="rounded accent-teal-600 w-4 h-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--color-text-primary)] truncate">{student.name}</div>
                    <div className="text-xs font-mono text-[var(--color-text-secondary)] truncate" dir="ltr">
                      {student.student_number ? `#${student.student_number}` : '-'}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <div
          className={`print-cards-only ${selectedStudents.length === 0 ? 'hidden' : 'block'} print:!block`}
        >
          {selectedStudents.length > 0 && (
            <div className="qr-cards-grid grid grid-cols-2 md:grid-cols-3 gap-4 max-w-[210mm] mx-auto print:max-w-none">
              {selectedStudents.map((student) => {
                const sn = student.student_number;
                const groupName = studentGroupMap[student.id];
                return (
                  <div key={student.id} className="qr-card">
                    <div className="relative z-[1] flex items-center justify-between">
                      <span className="qr-card-logo truncate max-w-[70%]">{centerName}</span>
                      <div className="w-6 h-6 rounded-md bg-[var(--color-surface-1)]/10 flex items-center justify-center shrink-0">
                        <svg
                          width="12"
                          height="12"
                          fill="none"
                          stroke="white"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                          <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                          <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                          <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                          <line x1="7" y1="12" x2="17" y2="12" />
                        </svg>
                      </div>
                    </div>

                    <div className="relative z-[1] flex justify-center">
                      <div className="bg-[var(--color-surface-1)] rounded-lg p-1.5">
                        {student.qrDataUrl ? (
                          <img
                            src={student.qrDataUrl}
                            alt=""
                            width={88}
                            height={88}
                            className="size-[88px] object-contain"
                          />
                        ) : null}
                      </div>
                    </div>

                    <div className="relative z-[1] flex flex-col items-center gap-0.5 text-center">
                      <p className="qr-card-name">{student.name}</p>
                      {sn ? (
                        <p className="qr-card-number" dir="ltr">
                          #{sn}
                        </p>
                      ) : null}
                      <p className="text-[9px] opacity-75" dir="ltr">
                        {tStudents('academicYear')} {academicYear}
                      </p>
                      {centerPhone ? (
                        <p className="text-[9px] opacity-60" dir="ltr">
                          {centerPhone}
                        </p>
                      ) : null}
                      {showGroup && groupName ? (
                        <span className="text-xs text-[var(--color-text-tertiary)]">{groupName}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @media print {
          nav,
          header,
          footer,
          .sidebar,
          .bottom-nav,
          .top-bar,
          .no-print,
          .print-hide,
          input[type='checkbox'],
          select {
            display: none !important;
          }

          .print-cards-only {
            display: block !important;
          }

          .app-mode-main,
          main {
            padding-inline-start: 0 !important;
          }

          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </>
  );
}
