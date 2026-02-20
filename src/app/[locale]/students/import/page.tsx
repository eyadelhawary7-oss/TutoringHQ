'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbInsert, dbUpdate, auditLog } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import { parseFile, autoDetectMapping, type ParsedData, type ColumnMapping } from '@/lib/excel-parser';
import { dbSelect } from '@/lib/db-proxy';
import QRCode from 'qrcode';
import { Upload, Check, ArrowLeft } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'success';

type ColumnMapValue = 'name' | 'phone' | 'group' | 'skip';

interface Group {
  id: string;
  name: string;
  fee?: number;
}

export default function ImportStudentsPage() {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');

  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState('');
  const [columnMap, setColumnMap] = useState<Record<string, ColumnMapValue>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [studentCountStart, setStudentCountStart] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedExtensions = ['.csv', '.xlsx', '.xls'];
  const progress = step === 'upload' ? 33 : step === 'map' ? 66 : 100;

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (meData?.user?.center_id) {
        setCenterId(meData.user.center_id);
        const { data: groupsData } = await dbSelect({
          table: 'student_groups',
          select: 'id, name, fee',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        });
        if (groupsData) setGroups(groupsData as Group[]);
        const { data: countData } = await dbSelect({
          table: 'students',
          select: 'id',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
        });
        setStudentCountStart(Array.isArray(countData) ? countData.length : 0);
      }
      if (meData?.user?.id) setUserId(meData.user.id);
    };
    load();
  }, []);

  const convertToColumnMap = (mapping: ColumnMapping): Record<string, ColumnMapValue> => {
    const result: Record<string, ColumnMapValue> = {};
    if (mapping.studentName) result[mapping.studentName] = 'name';
    if (mapping.phone) result[mapping.phone] = 'phone';
    if (mapping.group) result[mapping.group] = 'group';
    return result;
  };

  const handleFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedExtensions.includes(ext)) {
      setError(t('error'));
      return;
    }
    setError('');
    setFileName(file.name);
    setIsLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const data = parseFile(buffer, file.name);
      if (data.rows.length === 0) {
        setError(t('error'));
        return;
      }
      setParsedData(data);
      const detected = autoDetectMapping(data.headers);
      const map = convertToColumnMap(detected);
      data.headers.forEach((h) => {
        if (!(h in map)) map[h] = 'skip';
      });
      setColumnMap(map);
    } catch {
      setError(t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const getMappedStudents = () => {
    if (!parsedData || !centerId) return [];
    const nameHeader = Object.keys(columnMap).find((k) => columnMap[k] === 'name');
    const phoneHeader = Object.keys(columnMap).find((k) => columnMap[k] === 'phone');
    const groupHeader = Object.keys(columnMap).find((k) => columnMap[k] === 'group');
    if (!nameHeader) return [];

    const base: { center_id: string; name: string; phone: string | null; fee: number; payment_status: 'unpaid' }[] = [];
    for (const row of parsedData.rows) {
      const name = String(row[nameHeader] ?? '').trim();
      if (!name) continue;
      let fee = 0;
      if (groupHeader) {
        const groupName = String(row[groupHeader] ?? '').trim();
        const g = groups.find((gr) => gr.name === groupName);
        fee = g?.fee ?? 0;
      }
      base.push({
        center_id: centerId,
        name,
        phone: phoneHeader ? String(row[phoneHeader] ?? '').trim() || null : null,
        fee,
        payment_status: 'unpaid',
      });
    }
    return base.map((s, i) => ({ ...s, student_number: `STU-${String(studentCountStart + i + 1).padStart(5, '0')}` }));
  };

  const mappedStudents = getMappedStudents();
  const hasNameMapping = Object.values(columnMap).includes('name');
  const getPreviewStudentNumber = (index: number) => `STU-${String(studentCountStart + index + 1).padStart(5, '0')}`;

  const handleImport = async () => {
    if (!centerId || !userId || mappedStudents.length === 0) return;
    setIsLoading(true);
    setError('');
    setStep('importing');
    try {
      let insertedTotal = 0;
      for (let i = 0; i < mappedStudents.length; i += 50) {
        const batch = mappedStudents.slice(i, i + 50);
        const { data: inserted, error: insertError } = await dbInsert({ table: 'students', data: batch, select: '*' });
        if (insertError) throw insertError;
        const insertedList = (inserted || []) as { id: string }[];
        for (const student of insertedList) {
          try {
            const qrDataURL = await QRCode.toDataURL(student.id, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
            await dbUpdate({ table: 'students', data: { qr_code: qrDataURL }, filters: [{ column: 'id', op: 'eq', value: student.id }] });
          } catch { /* non-critical */ }
          insertedTotal++;
        }
      }
      setImportedCount(insertedTotal);
      await auditLog({ centerId, userId, action: 'student_import', entityType: 'students', details: { count: insertedTotal, source: 'file_import' } });
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
      setStep('preview');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/students" className="p-1.5 rounded-lg hover:bg-muted">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Progress bar */}
        <Progress value={progress} className="h-2 mb-6" />

        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-xl text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="ch-card p-8">
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={() => {}}
              onClick={() => !isLoading && fileInputRef.current?.click()}
              className={`border-2 border-dashed border-border rounded-2xl p-12 text-center hover:border-primary/50 transition-colors cursor-pointer ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
                className="hidden"
              />
              <Upload size={40} className="mx-auto mb-4 text-muted-foreground" />
              <p className="font-semibold text-foreground mb-1">{t('dragDrop')}</p>
              <p className="text-sm text-muted-foreground">{t('acceptedFormats')}</p>
            </div>
            {fileName && (
              <div className="mt-4 p-3 rounded-lg bg-muted flex items-center justify-between">
                <span className="text-sm text-foreground font-medium truncate max-w-[70%]">{fileName}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {parsedData ? t('rowsFound', { count: parsedData.rows.length }) : ''}
                </span>
              </div>
            )}
            {fileName && parsedData && (
              <button
                onClick={() => setStep('map')}
                className="w-full mt-4 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {tCommon('next')}
              </button>
            )}
            {fileName && isLoading && !parsedData && (
              <p className="text-sm text-muted-foreground text-center mt-4">{t('importing')}</p>
            )}
          </div>
        )}

        {/* Step 2: Map Columns */}
        {step === 'map' && parsedData && (
          <div className="ch-card p-5 space-y-4">
            <h3 className="font-bold text-foreground">{t('mapColumns')}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" dir="auto">
                <thead style={{ background: 'hsl(var(--muted))' }}>
                  <tr>
                    {parsedData.headers.map((header) => (
                      <th key={header} className="text-start px-3 py-2">
                        <select
                          value={columnMap[header] ?? 'skip'}
                          onChange={(e) => setColumnMap((m) => ({ ...m, [header]: e.target.value as ColumnMapValue }))}
                          className="text-xs px-2 py-1 rounded border border-input bg-background"
                        >
                          <option value="name">{t('mapToName')}</option>
                          <option value="phone">{t('mapToPhone')}</option>
                          <option value="group">{t('mapToGroup')}</option>
                          <option value="skip">{t('skipColumn')}</option>
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedData.rows.slice(0, 3).map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {parsedData.headers.map((header) => (
                        <td key={header} className="px-3 py-2 text-foreground">
                          {String(row[header] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('upload')} className="px-4 py-2.5 rounded-lg text-sm border border-border">
                {tCommon('back')}
              </button>
              <button
                onClick={() => setStep('preview')}
                disabled={!hasNameMapping}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {tCommon('next')}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview & Import */}
        {step === 'preview' && parsedData && (
          <div className="ch-card p-5 space-y-4">
            <h3 className="font-bold text-foreground">{t('importCount', { count: mappedStudents.length })}</h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm" dir="auto">
                <thead style={{ background: 'hsl(var(--muted))' }}>
                  <tr>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground">{tCommon('name')}</th>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground">{tCommon('phone')}</th>
                    <th className="text-start px-3 py-2 font-medium text-muted-foreground">{t('studentNumber')}</th>
                  </tr>
                </thead>
                <tbody>
                  {mappedStudents.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-foreground">{s.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground" dir="ltr">{s.phone || ''}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{getPreviewStudentNumber(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setStep('map')} className="px-4 py-2.5 rounded-lg text-sm border border-border">
                {tCommon('back')}
              </button>
              <button
                onClick={handleImport}
                disabled={mappedStudents.length === 0 || isLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {t('importCount', { count: mappedStudents.length })}
              </button>
            </div>
          </div>
        )}

        {/* Importing state */}
        {step === 'importing' && (
          <div className="ch-card p-8 text-center">
            <svg className="animate-spin h-12 w-12 text-primary mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-lg text-foreground">{t('importing')}</p>
          </div>
        )}

        {/* Success state */}
        {step === 'success' && (
          <div className="ch-card p-8 text-center">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#16A34A18' }}>
              <Check size={32} className="text-green-600" />
            </div>
            <h3 className="text-lg font-bold text-foreground mb-2">{t('success', { count: importedCount })}</h3>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
              <Link href="/students" className="text-sm font-medium hover:underline" style={{ color: 'hsl(var(--primary))' }}>
                {t('viewStudents')}
              </Link>
              <Link href="/students/print" className="text-sm font-medium hover:underline" style={{ color: 'hsl(var(--primary))' }}>
                {t('generateQR')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
