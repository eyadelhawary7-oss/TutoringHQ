'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatPlainInteger } from '@/lib/formatNumber';
import { supabase } from '@/lib/supabase';
import { dbInsert, dbUpdate, auditLog, dbSelect } from '@/lib/db-proxy';
import { Link } from '@/i18n/routing';
import { parseFile, autoDetectMapping, type ParsedData, type ColumnMapping } from '@/lib/excel-parser';
import { normalizePhone } from '@/lib/utils/phone';
import QRCode from 'qrcode';
import { ArrowRight, Check, ChevronDown, ChevronLeft, Download, Info, Upload, X } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';

/**
 * Merged-Center-Students §04 draws a THREE-step wizard: upload → match columns →
 * review. The `resolveGroups` step it had no place for is gone, together with
 * the progress bar (replaced by the three-dot indicator).
 *
 * CONSEQUENCE, FLAGGED FOR EYAD: with no group step, every imported student
 * lands with NO group membership — and `attendance_scans.charged_fee` is
 * snapshotted from the group's fee, so those students are attended but never
 * charged. That is a money consequence of a layout decision.
 */
type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'success';

/** Merged-Center-Students §04 upload copy: "CSV or Excel, up to 500 rows". Live parsed any size until now. */
const MAX_IMPORT_ROWS = 500;

type ColumnMapValue = 'name' | 'phone' | 'parentPhone' | 'group' | 'skip';

type CenterGroup = { id: string; name: string; subject: string | null };

/**
 * A CSV group value still resolves to a center group when the names match
 * EXACTLY — the automatic half of the step §04 removes. What is gone is the
 * manual reconciliation screen, not the mapping itself: an exact-name match
 * still attaches the student (and so still bills them), and anything that does
 * not match is simply left unattached, exactly as choosing "skip" did before.
 */
function findMatch(csvName: string, groups: CenterGroup[]): string | null {
  return groups.find((g) => g.name.toLowerCase().trim() === csvName.toLowerCase().trim())?.id ?? null;
}

type PreviewRow = {
  name: string;
  phone: string | null;
  parent_phone: string | null;
};

export default function ImportStudentsPage() {
  const locale = useLocale();
  const t = useTranslations('import');
  const tCommon = useTranslations('common');
  const tsStudents = useTranslations('students');
  const tConsent = useTranslations('guardianConsent');

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
  const [guardianConsent, setGuardianConsent] = useState(false);
  /** Which flagged row's Fix input is open — §04 reveals one at a time. */
  const [openFixRow, setOpenFixRow] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedExtensions = ['.csv', '.xlsx', '.xls'];

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
    setNameFixes({});
    setOpenFixRow(null);
    try {
      const buffer = await file.arrayBuffer();
      const data = await parseFile(buffer, file.name);
      if (data.rows.length === 0) {
        setError(t('error'));
        return;
      }
      if (data.rows.length > MAX_IMPORT_ROWS) {
        setError(t('errorTooManyRows', { count: data.rows.length, max: MAX_IMPORT_ROWS }));
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
    const headers = 'name,phone,parent_phone,group\n';
    const example = 'محمد أحمد,01012345678,01098765432,الرياضيات\n';
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

  /**
   * Per-row name correction, keyed by the row's index in `parsedData.rows`.
   *
   * Design (Merged-Center-Students §04) draws a per-row "Fix" affordance on the
   * Review step's flagged rows, letting staff correct a problem in place before
   * import instead of re-uploading the whole file. Missing name is the only
   * skip reason that exists live (see skippedRows below), so this is scoped to
   * that one field - typing a name here reclassifies the row from "needs a fix"
   * to "ready to add" without touching the source file.
   */
  const [nameFixes, setNameFixes] = useState<Record<number, string>>({});

  const effectiveName = useCallback(
    (row: Record<string, unknown>, index: number): string => {
      const fixed = nameFixes[index]?.trim();
      if (fixed) return fixed;
      return nameHeader ? String(row[nameHeader] ?? '').trim() : '';
    },
    [nameHeader, nameFixes],
  );

  const previewRows = useMemo((): PreviewRow[] => {
    if (!parsedData || !centerId || !nameHeader) return [];
    const rows: PreviewRow[] = [];
    parsedData.rows.forEach((row, i) => {
      const name = effectiveName(row, i);
      if (!name) return;
      const phone = phoneHeader ? String(row[phoneHeader] ?? '').trim() || null : null;
      let parent_phone: string | null = null;
      if (parentPhoneHeader) {
        const raw = String(row[parentPhoneHeader] ?? '').trim();
        parent_phone = raw ? (normalizePhone(raw) || null) : null;
      }
      rows.push({ name, phone, parent_phone });
    });
    return rows;
  }, [parsedData, centerId, nameHeader, phoneHeader, parentPhoneHeader, effectiveName]);

  /**
   * Rows the import will DROP, and why.
   *
   * Design (Merged-Center-Students §04) splits Review into "40 ready to add /
   * 2 need a fix" and names each bad row, because a spreadsheet that silently
   * loses two students is worse than one that refuses to import.
   *
   * Live already skipped these rows — `previewRows` does `if (!name) continue`
   * — but reported only the survivors, so a 42-row file with two blank names
   * showed "40 students" and the two were never mentioned. This surfaces them.
   *
   * Missing name is the ONLY reason live skips a row. The design's other
   * example, "Grade not recognised", has no live equivalent: grade is not an
   * import field. Not invented here. `index` threads through to the inline
   * "Fix" input below.
   */
  const skippedRows = useMemo((): { index: number; row: number; reason: string }[] => {
    if (!parsedData || !nameHeader) return [];
    const out: { index: number; row: number; reason: string }[] = [];
    parsedData.rows.forEach((row, i) => {
      const name = effectiveName(row, i);
      // +2: spreadsheet rows are 1-based and row 1 is the header, so the first
      // data row is row 2 in the file the center is looking at.
      if (!name) out.push({ index: i, row: i + 2, reason: t('reasonMissingName') });
    });
    return out;
  }, [parsedData, nameHeader, t, effectiveName]);

  const importPayloadAndMembers = useMemo(() => {
    if (!parsedData || !centerId || !nameHeader) {
      return { inserts: [] as Record<string, unknown>[], memberGroupIds: [] as (string | null)[] };
    }
    const inserts: Record<string, unknown>[] = [];
    const memberGroupIds: (string | null)[] = [];
    parsedData.rows.forEach((row, i) => {
      const name = effectiveName(row, i);
      if (!name) return;
      const phone = phoneHeader ? String(row[phoneHeader] ?? '').trim() || null : null;
      let parent_phone: string | null = null;
      if (parentPhoneHeader) {
        const raw = String(row[parentPhoneHeader] ?? '').trim();
        parent_phone = raw ? (normalizePhone(raw) || null) : null;
      }
      const csvG = groupHeader ? String(row[groupHeader] ?? '').trim() : '';
      const groupUuid = csvG ? groupMapping[csvG] ?? null : null;
      const subject =
        groupUuid ? (centerGroups.find((x) => x.id === groupUuid)?.subject?.trim() || null) : null;
      // group_id is NOT a students column (group membership is a separate
      // student_group_members insert below); groupUuid is only threaded
      // through memberGroupIds for that insert, never onto this row.
      inserts.push({
        center_id: centerId,
        name,
        phone,
        parent_phone,
        subject,
        payment_status: 'unpaid',
      });
      memberGroupIds.push(groupUuid);
    });
    return { inserts, memberGroupIds };
  }, [parsedData, centerId, nameHeader, phoneHeader, parentPhoneHeader, groupHeader, groupMapping, centerGroups, effectiveName]);

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

      // Exact-name auto-match only — §04 removes the manual reconciliation
      // screen, not the mapping. Anything unmatched stays unattached.
      const unique: string[] = groupHeader
        ? [...new Set(parsedData.rows.map((r) => String(r[groupHeader] ?? '').trim()).filter(Boolean))]
        : [];
      const initial: Record<string, string | null> = {};
      for (const u of unique) {
        initial[u] = findMatch(u, list);
      }
      setGroupMapping(initial);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleImport = async () => {
    const { inserts, memberGroupIds } = importPayloadAndMembers;
    if (!centerId || !userId || inserts.length === 0) return;
    if (!guardianConsent) {
      setError(tConsent('required'));
      return;
    }
    setIsLoading(true);
    setError('');
    setStep('importing');
    try {
      let insertedTotal = 0;
      const batchSize = 50;
      for (let i = 0; i < inserts.length; i += batchSize) {
        // Server verifies this per row and stamps guardian_consent_confirmed_at/_by.
        const batch = inserts
          .slice(i, i + batchSize)
          .map((row) => ({ ...row, guardian_consent_confirmed: true }));
        const batchMembers = memberGroupIds.slice(i, i + batchSize);
        const { data: inserted, error: insertError } = await dbInsert({
          table: 'students',
          data: batch,
          select: 'id, student_number, name, phone, parent_phone, is_active, created_at',
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

  const skipCount = Object.values(columnMap).filter((v) => v === 'skip').length;
  const stepIndex = step === 'upload' ? 0 : step === 'map' ? 1 : 2;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-surface-0)]">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        {/* §04 `.topbar` — an X on step 1 (leave the wizard), a back chevron on
            steps 2-3 (the ONLY back path now; the inline Back buttons are gone),
            the title, and a three-dot step indicator with the active dot
            stretched into a 20px pill. */}
        <div className="flex items-center gap-3 px-4 pb-2 pt-2">
          {step === 'upload' ? (
            <Link
              href="/students"
              aria-label={tCommon('back')}
              className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[#3A3F3A] btn-press chq-focus"
            >
              <X size={22} aria-hidden />
            </Link>
          ) : (
            <button
              type="button"
              aria-label={tCommon('back')}
              onClick={() => setStep(step === 'map' ? 'upload' : 'map')}
              className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] text-[#3A3F3A] btn-press chq-focus"
            >
              <DirectionalIcon icon={ChevronLeft} className="h-[22px] w-[22px]" />
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-[17px] font-semibold text-[var(--color-text-primary)]">
            {t('title')}
          </h1>
        </div>
        {step !== 'success' ? (
          <div className="flex justify-center gap-1 py-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-[7px] rounded-full ${
                  i === stepIndex ? 'w-5 bg-[#0E6B61]' : 'w-[7px] bg-[#D8D3C6]'
                }`}
              />
            ))}
          </div>
        ) : null}

        <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-2">
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {step === 'upload' && (
            <>
              {/* §04 heading block — all three frames lead the body with an
                  `.h2` (17px/600) over a `.sub` (13px, #5D635C). */}
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">
                  {t('stepUpload')}
                </h2>
                <p className="mt-[3px] text-[13px] leading-normal text-[#5D635C]">
                  {t('stepUploadSub')}
                </p>
              </div>
              {/* §04 inverts the order: the drop card leads, the template link
                  follows it as a `.btn-text` with a download glyph. */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => !isLoading && fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!isLoading) fileInputRef.current?.click();
                  }
                }}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#D8D3C6] bg-[var(--color-surface-1)] px-6 py-8 text-center transition-colors hover:border-teal-500/50 ${
                  isLoading ? 'cursor-not-allowed opacity-50' : ''
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = '';
                  }}
                  className="hidden"
                />
                <span className="grid h-[52px] w-[52px] place-items-center rounded-2xl bg-[var(--color-mint)] text-[var(--color-accent-deep)]">
                  <Upload size={26} aria-hidden />
                </span>
                <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                  {t('dragDrop')}
                </p>
                {/* The stated cap matches MAX_IMPORT_ROWS, which is what the
                    parser actually enforces. */}
                <p className="text-[13px] text-[#5D635C]">{t('acceptedFormats')}</p>
              </div>

              <button
                type="button"
                onClick={downloadTemplate}
                className="mx-auto inline-flex items-center gap-1 text-[13px] font-semibold text-[#0A514A] btn-press chq-focus"
              >
                <Download size={15} aria-hidden /> {tsStudents('downloadTemplate')}
              </button>

              {/* The parent-phone rationale moves here from the map step — §04
                  draws it on upload, where it can still change what the center
                  puts in the file. */}
              <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3">
                <Info size={18} className="shrink-0 text-[var(--color-mid)]" aria-hidden />
                <p className="text-xs leading-relaxed text-[#5D635C]">{t('parentPhoneHint')}</p>
              </div>

              {fileName && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--color-tile)] p-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {fileName}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                    {parsedData ? t('rowsFound', { count: parsedData.rows.length }) : ''}
                  </span>
                </div>
              )}
              {fileName && isLoading && !parsedData && (
                <p className="text-center text-sm text-[var(--color-text-secondary)]">{t('importing')}</p>
              )}
            </>
          )}

          {step === 'map' && parsedData && (
            <>
              {/* §04 heading block, map frame. */}
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">
                  {t('stepMap')}
                </h2>
                <p className="mt-[3px] text-[13px] leading-normal text-[#5D635C]">
                  {t('stepMapSub')}
                </p>
              </div>
              {/* §04 replaces the horizontally scrolling table with a VERTICAL
                  card of rows: source header over target field, a green check
                  when matched, a "Choose field…" affordance when not. The native
                  <select> is kept (visually hidden, overlaid) so the row stays
                  operable by keyboard and screen reader. */}
              <div className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
                {parsedData.headers.map((header) => {
                  const value = columnMap[header] ?? 'skip';
                  const matched = value !== 'skip';
                  return (
                    <div
                      key={header}
                      className="relative flex items-center gap-3 border-t border-[#F0ECE2] px-4 py-3 first:border-t-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[13px] font-semibold text-[#5D635C]" dir="auto">
                          {header}
                        </p>
                        <p className="truncate text-[13px] font-semibold text-[var(--color-text-primary)]">
                          {matched
                            ? t(
                                value === 'name'
                                  ? 'mapToName'
                                  : value === 'phone'
                                    ? 'mapToPhone'
                                    : value === 'parentPhone'
                                      ? 'mapToParentPhone'
                                      : 'mapToGroup',
                              )
                            : t('chooseField')}
                        </p>
                      </div>
                      {matched ? (
                        <Check size={18} className="shrink-0 text-[#1A6D4D]" aria-hidden />
                      ) : (
                        <ChevronDown size={18} className="shrink-0 text-[#A09A8E]" aria-hidden />
                      )}
                      <select
                        aria-label={header}
                        value={value}
                        onChange={(e) =>
                          setColumnMap((m) => ({ ...m, [header]: e.target.value as ColumnMapValue }))
                        }
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      >
                        <option value="name">{t('mapToName')}</option>
                        <option value="phone">{t('mapToPhone')}</option>
                        <option value="parentPhone">{t('mapToParentPhone')}</option>
                        <option value="group">{t('mapToGroup')}</option>
                        <option value="skip">{t('skipColumn')}</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              {skipCount > 0 ? (
                <p className="mx-1 text-xs text-[#80827A]">
                  {t('columnsLeftToMatch', { count: formatPlainInteger(skipCount, locale) })}
                </p>
              ) : null}
            </>
          )}

          {step === 'preview' && parsedData && (
            <>
              {/* §04 heading block, review frame — the sub carries the file's
                  TOTAL row count ("42 rows found in your file."), the one
                  figure the two tiles below split into ready/needs-fix.
                  `rowsFound` already holds that exact copy in both locales. */}
              <div>
                <h2 className="text-[17px] font-semibold text-[var(--color-text-primary)]">
                  {t('stepPreview')}
                </h2>
                <p className="mt-[3px] text-[13px] leading-normal text-[#5D635C]">
                  {t('rowsFound', { count: formatPlainInteger(parsedData.rows.length, locale) })}
                </p>
              </div>
              {/* §04 Review: two bordered count tiles side by side. */}
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col items-start gap-0.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3">
                  <span className="text-[22px] font-bold leading-none tabular-nums text-[#1A6D4D]">
                    {formatPlainInteger(previewRows.length, locale)}
                  </span>
                  <span className="text-xs text-[#80827A]">{t('readyToAdd')}</span>
                </div>
                <div className="flex flex-1 flex-col items-start gap-0.5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] px-4 py-3">
                  <span className="text-[22px] font-bold leading-none tabular-nums text-[#9A6B1F]">
                    {formatPlainInteger(skippedRows.length, locale)}
                  </span>
                  <span className="text-xs text-[#80827A]">{t('needFix')}</span>
                </div>
              </div>

              {skippedRows.length > 0 && (
                <>
                  <p className="mx-1 text-xs font-semibold tracking-wide text-[#80827A]">
                    {t('needsFixTitle')}
                  </p>
                  <div className="overflow-hidden rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)]">
                    {skippedRows.map((s) => (
                      <div
                        key={s.row}
                        className="border-t border-[#F0ECE2] px-4 py-3 first:border-t-0"
                      >
                        <div className="flex items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#F4EBD7] text-[15px] font-semibold text-[#9A6B1F]">
                            ?
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                              {t('rowLabel', { n: formatPlainInteger(s.row, locale) })}
                            </p>
                            <p className="truncate text-xs text-[#80827A]">{s.reason}</p>
                          </div>
                          {/* The always-visible inline input moves behind a Fix
                              button — one row at a time, as drawn. */}
                          <button
                            type="button"
                            onClick={() =>
                              setOpenFixRow((cur) => (cur === s.index ? null : s.index))
                            }
                            className="shrink-0 text-[13px] font-semibold text-[#0A514A] btn-press chq-focus"
                          >
                            {t('fixAction')}
                          </button>
                        </div>
                        {openFixRow === s.index ? (
                          <input
                            type="text"
                            autoFocus
                            value={nameFixes[s.index] ?? ''}
                            onChange={(e) =>
                              setNameFixes((prev) => ({ ...prev, [s.index]: e.target.value }))
                            }
                            placeholder={t('fixNamePlaceholder')}
                            dir="auto"
                            className="mt-2 w-full rounded-lg border border-amber-300 bg-[var(--color-surface-0)] px-2.5 py-1.5 text-sm text-[var(--color-text-primary)]"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p className="mx-1 text-xs text-[#80827A]">{t('skippedNote')}</p>
                </>
              )}

              {/* NOT DRAWN, DELIBERATELY KEPT: guardian consent is a legal
                  control for minors' data and hard-gates handleImport. Deleting
                  it because the design omits it would remove a safety rail, not
                  chrome. */}
              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] p-3">
                <input
                  type="checkbox"
                  checked={guardianConsent}
                  onChange={(e) => setGuardianConsent(e.target.checked)}
                  className="mt-0.5 rounded accent-teal-600"
                />
                <span className="text-sm text-[var(--color-text-primary)]">{tConsent('checkboxLabel')}</span>
              </label>
            </>
          )}

          {step === 'importing' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
              <p className="text-lg text-[var(--color-text-primary)]">{t('importing')}</p>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
              <span
                className="grid h-16 w-16 place-items-center rounded-full"
                style={{ background: 'color-mix(in srgb, var(--color-success) 14%, transparent)' }}
              >
                <Check size={32} className="text-[var(--color-success)]" aria-hidden />
              </span>
              <h2 className="text-lg font-bold text-[var(--color-text-primary)]">
                {t('success', { count: importedCount })}
              </h2>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link href="/students" className="text-sm font-semibold text-[#0A514A] hover:underline">
                  {t('viewStudents')}
                </Link>
                <Link href="/students/print" className="text-sm font-semibold text-[#0A514A] hover:underline">
                  {t('generateQR')}
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* §04 `.footer` — ONE full-width primary per step. */}
        {step === 'upload' && fileName && parsedData ? (
          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 pb-4 pt-3">
            <button
              type="button"
              onClick={() => setStep('map')}
              className="btn-lift flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#0E6B61] text-[15px] font-semibold text-[#FFFDF8] shadow-sm btn-press chq-focus"
            >
              {tCommon('next')}
            </button>
          </div>
        ) : null}
        {step === 'map' ? (
          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 pb-4 pt-3">
            <button
              type="button"
              onClick={handleMapNext}
              disabled={!hasNameMapping || !centerId || isLoading}
              className="btn-lift flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#0E6B61] text-[15px] font-semibold text-[#FFFDF8] shadow-sm disabled:opacity-50 btn-press chq-focus"
            >
              {tCommon('next')}
              {/* §04 draws this step's Continue with a trailing forward arrow;
                  DirectionalIcon flips it in RTL. */}
              <DirectionalIcon icon={ArrowRight} className="h-[18px] w-[18px]" />
            </button>
          </div>
        ) : null}
        {step === 'preview' ? (
          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-0)] px-4 pb-4 pt-3">
            <button
              type="button"
              onClick={handleImport}
              disabled={previewRows.length === 0 || isLoading || !guardianConsent}
              className="btn-lift flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#0E6B61] text-[15px] font-semibold text-[#FFFDF8] shadow-sm disabled:opacity-50 btn-press chq-focus"
            >
              <Check size={18} aria-hidden />
              {t('addNStudents', { count: formatPlainInteger(previewRows.length, locale) })}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
