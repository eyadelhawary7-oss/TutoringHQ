'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbInsert, dbUpdate, auditLog, dbSelect } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import { parseFile, autoDetectMapping, type ParsedData, type ColumnMapping } from '@/lib/excel-parser';
import { normalizePhone } from '@/lib/utils/phone';
import QRCode from 'qrcode';
import { Upload, Check, ArrowLeft } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';
import { Progress } from '@/components/ui/progress';

type ImportStep = 'upload' | 'map' | 'resolveGroups' | 'preview' | 'importing' | 'success';

type ColumnMapValue = 'name' | 'phone' | 'parentPhone' | 'group' | 'notes' | 'skip';

type CenterGroup = { id: string; name: string; subject: string | null };

function findMatch(csvName: string, groups: CenterGroup[]): string | null {
  return groups.find((g) => g.name.toLowerCase().trim() === csvName.toLowerCase().trim())?.id ?? null;
}

function groupOptionLabel(g: CenterGroup): string {
  const sub = (g.subject ?? '').trim();
  return sub ? `${g.name} - ${sub}` : g.name;
}

type PreviewRow = {
  name: string;
  phone: string | null;
  parent_phone: string | null;
  notes: string | null;
  groupLabel: string | null;
};

export default function ImportStudentsPage() {
  const t = useTranslations('import');
  const tCommon = useTranslations('common');
  const tsStudents = useTranslations('students');

  const [step, setStep] = useState<ImportStep>('upload');
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [fileName, setFileName] = useState('');
  const [columnMap, setColumnMap] = useState<Record<string, ColumnMapValue>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [importedCount, setImportedCount] = useState(0);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [centerGroups, setCenterGroups] = useState<CenterGroup[]>([]);
  const [groupMapping, setGroupMapping] = useState<Record<string, string | null>>({});
  const [csvGroupOrder, setCsvGroupOrder] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedExtensions = ['.csv', '.xlsx', '.xls'];
  const progress =
    step === 'upload'
      ? 20
      : step === 'map'
        ? 40
        : step === 'resolveGroups'
          ? 60
          : step === 'preview' || step === 'importing'
            ? 85
            : step === 'success'
              ? 100
              : 0;

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const meRes = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (meData?.user?.center_id) {
        setCenterId(meData.user.center_id);
      }
      if (meData?.user?.id) setUserId(meData.user.id);
    };
    load();
  }, []);

  const convertToColumnMap = useCallback((mapping: ColumnMapping): Record<string, ColumnMapValue> => {
    const result: Record<string, ColumnMapValue> = {};
    if (mapping.studentName) result[mapping.studentName] = 'name';
    if (mapping.phone) result[mapping.phone] = 'phone';
    if (mapping.parentPhone) result[mapping.parentPhone] = 'parentPhone';
    if (mapping.notes) result[mapping.notes] = 'notes';
    if (mapping.group) result[mapping.group] = 'group';
    return result;
  }, []);

  const handleFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedExtensions.includes(ext)) {
      setError(t('error'));
      return;
    }
    setError('');
    setFileName(file.name);
    setIsLoading(true);
    setCenterGroups([]);
    setGroupMapping({});
    setCsvGroupOrder([]);
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

  const downloadTemplate = () => {
    const headers = 'name,phone,parent_phone,group,notes\n';
    const example = 'محمد أحمد,01012345678,01098765432,الرياضيات,\n';
    const csv = '\uFEFF' + headers + example;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const nameHeader = useMemo(
    () => Object.keys(columnMap).find((k) => columnMap[k] === 'name'),
    [columnMap],
  );
  const phoneHeader = useMemo(
    () => Object.keys(columnMap).find((k) => columnMap[k] === 'phone'),
    [columnMap],
  );
  const parentPhoneHeader = useMemo(
    () => Object.keys(columnMap).find((k) => columnMap[k] === 'parentPhone'),
    [columnMap],
  );
  const groupHeader = useMemo(
    () => Object.keys(columnMap).find((k) => columnMap[k] === 'group'),
    [columnMap],
  );
  const notesHeader = useMemo(
    () => Object.keys(columnMap).find((k) => columnMap[k] === 'notes'),
    [columnMap],
  );

  const previewRows = useMemo((): PreviewRow[] => {
    if (!parsedData || !centerId || !nameHeader) return [];
    const rows: PreviewRow[] = [];
    for (const row of parsedData.rows) {
      const name = String(row[nameHeader] ?? '').trim();
      if (!name) continue;
      const phone = phoneHeader ? String(row[phoneHeader] ?? '').trim() || null : null;
      let parent_phone: string | null = null;
      if (parentPhoneHeader) {
        const raw = String(row[parentPhoneHeader] ?? '').trim();
        parent_phone = raw ? (normalizePhone(raw) || null) : null;
      }
      const notes = notesHeader ? String(row[notesHeader] ?? '').trim() || null : null;
      let groupLabel: string | null = null;
      if (groupHeader) {
        const csvG = String(row[groupHeader] ?? '').trim();
        if (csvG) {
          const gid = groupMapping[csvG] ?? null;
          if (gid) {
            const g = centerGroups.find((x) => x.id === gid);
            groupLabel = g ? groupOptionLabel(g) : null;
          } else {
            groupLabel = t('skipGroup');
          }
        }
      }
      rows.push({ name, phone, parent_phone, notes, groupLabel });
    }
    return rows;
  }, [parsedData, centerId, nameHeader, phoneHeader, parentPhoneHeader, groupHeader, notesHeader, groupMapping, centerGroups, t]);

  const importPayloadAndMembers = useMemo(() => {
    if (!parsedData || !centerId || !nameHeader) {
      return { inserts: [] as Record<string, unknown>[], memberGroupIds: [] as (string | null)[] };
    }
    const inserts: Record<string, unknown>[] = [];
    const memberGroupIds: (string | null)[] = [];
    for (const row of parsedData.rows) {
      const name = String(row[nameHeader] ?? '').trim();
      if (!name) continue;
      const phone = phoneHeader ? String(row[phoneHeader] ?? '').trim() || null : null;
      let parent_phone: string | null = null;
      if (parentPhoneHeader) {
        const raw = String(row[parentPhoneHeader] ?? '').trim();
        parent_phone = raw ? (normalizePhone(raw) || null) : null;
      }
      let notes: string | null = null;
      if (notesHeader) {
        const n = String(row[notesHeader] ?? '').trim();
        notes = n ? n.slice(0, 5000) : null;
      }
      const csvG = groupHeader ? String(row[groupHeader] ?? '').trim() : '';
      const groupUuid = csvG ? groupMapping[csvG] ?? null : null;
      const subject =
        groupUuid ? (centerGroups.find((x) => x.id === groupUuid)?.subject?.trim() || null) : null;
      inserts.push({
        center_id: centerId,
        name,
        phone,
        parent_phone,
        group_id: groupUuid,
        notes,
        subject,
        payment_status: 'unpaid',
      });
      memberGroupIds.push(groupUuid);
    }
    return { inserts, memberGroupIds };
  }, [parsedData, centerId, nameHeader, phoneHeader, parentPhoneHeader, groupHeader, notesHeader, groupMapping, centerGroups]);

  const hasNameMapping = Object.values(columnMap).includes('name');

  const handleMapNext = async () => {
    if (!parsedData || !centerId) {
      setError(t('error'));
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      // CenterHQ stores class groups in `student_groups` (same role as "groups" in the product).
      const { data, error: selErr } = await dbSelect({
        table: 'student_groups',
        select: 'id, name, subject',
        filters: [{ column: 'center_id', op: 'eq', value: centerId }],
        order: { column: 'name', ascending: true },
      });
      if (selErr) throw selErr;
      const list = (Array.isArray(data) ? data : []) as CenterGroup[];
      setCenterGroups(list);

      const unique: string[] = groupHeader
        ? [...new Set(parsedData.rows.map((r) => String(r[groupHeader] ?? '').trim()).filter(Boolean))]
        : [];
      setCsvGroupOrder(unique);

      const initial: Record<string, string | null> = {};
      for (const u of unique) {
        initial[u] = findMatch(u, list);
      }
      setGroupMapping(initial);
      setStep('resolveGroups');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    const { inserts, memberGroupIds } = importPayloadAndMembers;
    if (!centerId || !userId || inserts.length === 0) return;
    setIsLoading(true);
    setError('');
    setStep('importing');
    try {
      let insertedTotal = 0;
      const batchSize = 50;
      for (let i = 0; i < inserts.length; i += batchSize) {
        const batch = inserts.slice(i, i + batchSize);
        const batchMembers = memberGroupIds.slice(i, i + batchSize);
        const { data: inserted, error: insertError } = await dbInsert({
          table: 'students',
          data: batch,
          select: 'id, student_number, name, phone, parent_phone, group_id, notes, is_active, created_at',
        });
        if (insertError) throw insertError;
        const insertedList = (inserted || []) as { id: string }[];
        for (let j = 0; j < insertedList.length; j++) {
          const student = insertedList[j];
          const gid = batchMembers[j];
          if (gid) {
            const { error: memErr } = await dbInsert({
              table: 'student_group_members',
              data: { group_id: gid, student_id: student.id },
              select: false,
            });
            if (memErr) throw memErr;
          }
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
        <Link href="/students" className="p-1.5 rounded-lg hover:bg-muted" aria-label={tCommon('back')}>
          <DirectionalIcon icon={ArrowLeft} className="h-[18px] w-[18px]" />
        </Link>
        <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
      </div>

      <div className="max-w-2xl mx-auto">
        <Progress value={progress} className="h-2 mb-6" />

        {error && (
          <div className="mb-4 p-3 rounded-xl text-sm border border-destructive/30 bg-destructive/10 text-destructive">
            {error}
          </div>
        )}

        {step === 'upload' && (
          <div className="ch-card p-8">
            <div className="mb-3 text-center">
              <button
                type="button"
                onClick={downloadTemplate}
                className="text-[hsl(var(--primary))] underline text-sm btn-press chq-focus"
              >
                {tsStudents('downloadTemplate')}
              </button>
            </div>
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
              <Upload size={40} className="mx-auto mb-4 text-[var(--color-text-secondary)]" />
              <p className="font-semibold text-[var(--color-text-primary)] mb-1">{t('dragDrop')}</p>
              <p className="text-sm text-[var(--color-text-secondary)]">{t('acceptedFormats')}</p>
            </div>
            {fileName && (
              <div className="mt-4 p-3 rounded-lg bg-muted flex items-center justify-between gap-2">
                <span className="text-sm text-[var(--color-text-primary)] font-medium truncate min-w-0 flex-1">{fileName}</span>
                <span className="text-xs text-[var(--color-text-secondary)] shrink-0">
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
              <p className="text-sm text-[var(--color-text-secondary)] text-center mt-4">{t('importing')}</p>
            )}
          </div>
        )}

        {step === 'map' && parsedData && (
          <div className="ch-card p-5 space-y-4">
            <h3 className="font-bold text-[var(--color-text-primary)]">{t('mapColumns')}</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">{t('parentPhoneHint')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" dir="auto">
                <thead style={{ background: 'hsl(var(--muted))' }}>
                  <tr>
                    {parsedData.headers.map((header) => (
                      <th key={header} className="text-start px-3 py-2">
                        <select
                          value={columnMap[header] ?? 'skip'}
                          onChange={(e) => setColumnMap((m) => ({ ...m, [header]: e.target.value as ColumnMapValue }))}
                          className="text-xs px-2 py-1 rounded border border-input bg-[var(--color-surface-0)] max-w-[10rem] sm:max-w-none"
                        >
                          <option value="name">{t('mapToName')}</option>
                          <option value="phone">{t('mapToPhone')}</option>
                          <option value="parentPhone">{t('mapToParentPhone')}</option>
                          <option value="group">{t('mapToGroup')}</option>
                          <option value="notes">{t('mapToNotes')}</option>
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
                        <td key={header} className="px-3 py-2 text-[var(--color-text-primary)]">
                          {String(row[header] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setStep('upload')} className="px-4 py-2.5 rounded-lg text-sm border border-border">
                {tCommon('back')}
              </button>
              <button
                type="button"
                onClick={handleMapNext}
                disabled={!hasNameMapping || !centerId || isLoading}
                className="flex-1 min-w-[8rem] py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {tCommon('next')}
              </button>
            </div>
          </div>
        )}

        {step === 'resolveGroups' && parsedData && (
          <div className="ch-card p-5 space-y-4">
            <h3 className="font-bold text-[var(--color-text-primary)]">{t('groupResolution')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)]">{t('groupResolutionHint')}</p>
            {centerGroups.length === 0 && (
              <div className="p-3 rounded-xl text-sm border border-border bg-muted text-[var(--color-text-primary)] space-y-2">
                <p>{t('importWithoutGroupsBody')}</p>
                {csvGroupOrder.length > 0 ? <p className="text-[var(--color-text-secondary)]">{t('noGroupsFound')}</p> : null}
              </div>
            )}
            {csvGroupOrder.length === 0 && (
              <p className="text-sm text-[var(--color-text-secondary)]">{t('noCsvGroupValues')}</p>
            )}
            {csvGroupOrder.length > 0 && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-medium text-[var(--color-text-secondary)] px-1">
                  <span>{t('csvGroup')}</span>
                  <span className="hidden sm:inline">{t('dbGroup')}</span>
                </div>
                {csvGroupOrder.map((csvVal) => (
                  <div key={csvVal} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    <span
                      className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium bg-muted text-[var(--color-text-primary)] max-w-full break-words"
                      title={csvVal}
                    >
                      {csvVal}
                    </span>
                    <div className="flex-1 min-w-0">
                      <label className="sm:hidden text-xs text-[var(--color-text-secondary)] mb-1 block">{t('dbGroup')}</label>
                      <select
                        value={groupMapping[csvVal] ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGroupMapping((prev) => ({ ...prev, [csvVal]: v === '' ? null : v }));
                        }}
                        className="w-full text-sm px-2 py-2 rounded-lg border border-input bg-[var(--color-surface-0)] text-[var(--color-text-primary)]"
                      >
                        <option value="">{t('skipGroup')}</option>
                        {centerGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {groupOptionLabel(g)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <button type="button" onClick={() => setStep('map')} className="px-4 py-2.5 rounded-lg text-sm border border-border">
                {tCommon('back')}
              </button>
              <button
                type="button"
                onClick={() => setStep('preview')}
                disabled={isLoading}
                className="flex-1 min-w-[8rem] py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {tCommon('next')}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && parsedData && (
          <div className="ch-card p-5 space-y-4">
            <h3 className="font-bold text-[var(--color-text-primary)]">{t('importCount', { count: previewRows.length })}</h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm" dir="auto">
                <thead style={{ background: 'hsl(var(--muted))' }}>
                  <tr>
                    <th className="text-start px-3 py-2 font-medium text-[var(--color-text-secondary)]">{tCommon('name')}</th>
                    <th className="text-start px-3 py-2 font-medium text-[var(--color-text-secondary)]">{tCommon('phone')}</th>
                    <th className="text-start px-3 py-2 font-medium text-[var(--color-text-secondary)]">{t('parentPhone')}</th>
                    <th className="text-start px-3 py-2 font-medium text-[var(--color-text-secondary)]">{t('mapToGroup')}</th>
                    <th className="text-start px-3 py-2 font-medium text-[var(--color-text-secondary)]">{t('mapToNotes')}</th>
                    <th className="text-start px-3 py-2 font-medium text-[var(--color-text-secondary)]">{t('studentNumber')}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((s, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2 text-[var(--color-text-primary)]">{s.name}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">{s.phone || ''}</td>
                      <td className="px-3 py-2 font-mono text-xs text-[var(--color-text-secondary)]" dir="ltr">{s.parent_phone || ''}</td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">{s.groupLabel ?? ''}</td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)] max-w-[8rem] truncate" title={s.notes ?? ''}>{s.notes || ''}</td>
                      <td className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">{t('studentNumberPending')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setStep('resolveGroups')} className="px-4 py-2.5 rounded-lg text-sm border border-border">
                {tCommon('back')}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={previewRows.length === 0 || isLoading}
                className="flex-1 min-w-[8rem] py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {t('importReady')}
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="ch-card p-8 text-center">
            <svg className="animate-spin h-12 w-12 text-primary mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p className="text-lg text-[var(--color-text-primary)]">{t('importing')}</p>
          </div>
        )}

        {step === 'success' && (
          <div className="ch-card p-8 text-center">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-success) 14%, transparent)' }}
            >
              <Check size={32} className="text-[var(--color-success)]" />
            </div>
            <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">{t('success', { count: importedCount })}</h3>
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
