'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import FileUploadZone from '@/components/FileUploadZone';
import ColumnMapper from '@/components/ColumnMapper';
import { parseFile, autoDetectMapping, type ParsedData, type ColumnMapping } from '@/lib/excel-parser';
import { dbSelect } from '@/lib/db-proxy';
import QRCode from 'qrcode';

type ImportStep = 'upload' | 'preview' | 'mapping' | 'importing' | 'success';

interface Group { id: string; name: string; fee?: number }

export default function ImportStudentsPage() {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');

  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    studentName: null,
    phone: null,
    parentPhone: null,
    subject: null,
    group: null,
    monthlyFee: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    const loadCenterId = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Use /api/me to bypass RLS on users table
      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();
      if (meData?.user?.center_id) {
        setCenterId(meData.user.center_id);
        const { data: groupsData } = await dbSelect({
          table: 'student_groups',
          select: 'id, name, fee',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        });
        if (groupsData) setGroups(groupsData as Group[]);
      }
      if (meData?.user?.id) setUserId(meData.user.id);
    };
    loadCenterId();
  }, []);

  const handleFileSelected = async (file: File) => {
    setIsLoading(true);
    setError('');

    try {
      const buffer = await file.arrayBuffer();
      const data = parseFile(buffer, file.name);

      if (data.rows.length === 0) {
        setError(t('error'));
        return;
      }

      setParsedData(data);
      const detectedMapping = autoDetectMapping(data.headers);
      setMapping(detectedMapping);
      setStep('preview');
    } catch {
      setError(t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parsedData || !centerId || !userId || !mapping.studentName) return;

    setIsLoading(true);
    setError('');
    setStep('importing');

    try {
      const students = parsedData.rows.map((row) => {
        let monthlyFee = 0;
        if (mapping.monthlyFee) {
          monthlyFee = Number(row[mapping.monthlyFee]) || 0;
        } else if (mapping.group) {
          const groupName = String(row[mapping.group] || '').trim();
          const g = groups.find((gr) => gr.name === groupName);
          monthlyFee = g?.fee ?? 0;
        }
        return {
          center_id: centerId,
          name: String(row[mapping.studentName!] || '').trim(),
          phone: mapping.phone ? String(row[mapping.phone] || '').trim() : null,
          parent_phone: mapping.parentPhone ? String(row[mapping.parentPhone] || '').trim() : null,
          subject: mapping.subject ? String(row[mapping.subject] || '').trim() : null,
          fee: monthlyFee,
          payment_status: 'unpaid',
        };
      });

      // Filter out empty rows
      const validStudents = students.filter(s => s.name.length > 0);

      // Insert in batches of 50
      let insertedTotal = 0;
      for (let i = 0; i < validStudents.length; i += 50) {
        const batch = validStudents.slice(i, i + 50);
        const { data: inserted, error: insertError } = await dbInsert({ table: 'students', data: batch, select: '*' });

        if (insertError) throw insertError;

        // Generate QR codes for inserted students
        const insertedList = (inserted || []) as { id: string }[];
        if (insertedList.length > 0) {
          for (const student of insertedList) {
            try {
              const qrDataURL = await QRCode.toDataURL(student.id, {
                width: 300,
                margin: 2,
                errorCorrectionLevel: 'H',
              });

              await dbUpdate({ table: 'students', data: { qr_code: qrDataURL }, filters: [{ column: 'id', op: 'eq', value: student.id }] });
            } catch {
              // QR generation failure is non-critical
            }
          }
          insertedTotal += insertedList.length;
        }
      }

      setImportedCount(insertedTotal);

      await auditLog({
        centerId,
        userId,
        action: 'student_import',
        entityType: 'students',
        details: { count: insertedTotal, source: 'file_import' },
      });

      setStep('success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setStep('mapping');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold text-text-primary">
              {t('title')}
            </h1>
            <Link
              href="/students"
              className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {tCommon('back')}
            </Link>
          </div>

          {/* Step: Upload */}
          {step === 'upload' && (
            <FileUploadZone onFileSelected={handleFileSelected} isLoading={isLoading} />
          )}

          {/* Step: Preview */}
          {step === 'preview' && parsedData && (
            <div className="space-y-6">
              <div className="bg-bg-primary rounded-xl shadow p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-text-primary">
                    {t('preview')}
                  </h2>
                  <span className="text-sm text-text-secondary">
                    {t('rowsFound', { count: parsedData.rows.length })}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm" dir="auto">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        {parsedData.headers.map((header) => (
                          <th key={header} className="px-3 py-2 text-start text-sm font-medium italic text-text-secondary">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsedData.rows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-b border-gray-100 dark:border-gray-700/50">
                          {parsedData.headers.map((header) => (
                            <td key={header} className="px-3 py-2 text-text-primary">
                              {String(row[header] || '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {parsedData.rows.length > 10 && (
                  <p className="text-sm text-text-secondary mt-2 text-center">
                    +{parsedData.rows.length - 10} ...
                  </p>
                )}
              </div>

              <button
                onClick={() => setStep('mapping')}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors"
              >
                {tCommon('next')}
              </button>
            </div>
          )}

          {/* Step: Column Mapping */}
          {step === 'mapping' && parsedData && (
            <div className="space-y-6">
              <div className="bg-bg-primary rounded-xl shadow p-6">
                <ColumnMapper
                  headers={parsedData.headers}
                  mapping={mapping}
                  onMappingChange={setMapping}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('preview')}
                  className="flex-1 py-3 px-4 border border-gray-300 dark:border-gray-600 text-text-primary font-medium rounded-lg hover:bg-bg-secondary transition-colors"
                >
                  {tCommon('back')}
                </button>
                <button
                  onClick={handleConfirmImport}
                  disabled={!mapping.studentName || isLoading}
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('confirm')}
                </button>
              </div>
            </div>
          )}

          {/* Step: Importing */}
          {step === 'importing' && (
            <div className="text-center py-16">
              <svg className="animate-spin h-12 w-12 text-indigo-600 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-lg text-text-primary">{t('importing')}</p>
            </div>
          )}

          {/* Step: Success */}
          {step === 'success' && (
            <div className="text-center py-16">
              <div className="w-20 h-20 mx-auto bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center mb-6">
                <svg className="w-10 h-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-text-primary mb-2">
                {t('success', { count: importedCount })}
              </h2>
              <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
                <Link
                  href="/students"
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                >
                  {t('viewStudents')}
                </Link>
                <Link
                  href="/students/print"
                  className="px-6 py-3 border border-indigo-600 text-indigo-600 dark:text-indigo-400 font-medium rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-colors"
                >
                  {t('generateQR')}
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
  );
}
