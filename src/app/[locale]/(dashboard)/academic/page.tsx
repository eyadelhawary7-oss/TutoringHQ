'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/shared';
import { Calendar, Plus, Pencil, Trash2, Loader2, X } from 'lucide-react';

type PeriodType = 'exam' | 'holiday' | 'peak' | 'normal';

interface AcademicYear {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  created_at?: string;
}

interface AcademicPeriod {
  id: string;
  academic_year_id: string;
  period_type: PeriodType;
  name: string;
  start_date: string;
  end_date: string;
  attendance_context?: string | null;
}

interface Holiday {
  id: string;
  name: string;
  date: string;
  is_recurring: boolean;
}

const PERIOD_COLORS: Record<PeriodType, string> = {
  normal: 'bg-slate-300',
  exam: 'bg-amber-400',
  holiday: 'bg-red-400',
  peak: 'bg-teal-300',
};

function formatDateAr(dateStr: string): string {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string): string {
  try {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('ar-SA', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export default function AcademicPage() {
  const t = useTranslations('academic');
  const locale = useLocale();
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [periods, setPeriods] = useState<AcademicPeriod[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [currentYear, setCurrentYear] = useState<AcademicYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [editYear, setEditYear] = useState<AcademicYear | null>(null);
  const [editYearForm, setEditYearForm] = useState({ name: '', start_date: '', end_date: '' });
  const [showNewYearModal, setShowNewYearModal] = useState(false);
  const [newYearForm, setNewYearForm] = useState({ name: '', start_date: '', end_date: '' });
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodForm, setPeriodForm] = useState<Partial<AcademicPeriod> & { id?: string }>({});
  const [showHolidayModal, setShowHolidayModal] = useState(false);
  const [holidayForm, setHolidayForm] = useState<Partial<Holiday> & { id?: string }>({});
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    try {
      const res = await fetch('/api/academic', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setYears(json.years ?? []);
        setPeriods(json.periods ?? []);
        setHolidays(json.holidays ?? []);
        setCurrentYear(json.currentYear ?? null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const saveYear = async () => {
    if (!editYear) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/academic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'update_year',
          id: editYear.id,
          name: editYearForm.name,
          start_date: editYearForm.start_date,
          end_date: editYearForm.end_date,
        }),
      });
      if (res.ok) {
        setEditYear(null);
        await loadData();
      }
    } finally {
      setSaving(false);
    }
  };

  const createYear = async () => {
    if (!newYearForm.name || !newYearForm.start_date || !newYearForm.end_date) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/academic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'create_year',
          ...newYearForm,
        }),
      });
      if (res.ok) {
        setShowNewYearModal(false);
        setNewYearForm({ name: '', start_date: '', end_date: '' });
        await loadData();
      }
    } finally {
      setSaving(false);
    }
  };

  const savePeriod = async () => {
    if (!periodForm.name || !periodForm.start_date || !periodForm.end_date || !currentYear) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const body = periodForm.id
        ? { action: 'update_period', id: periodForm.id, ...periodForm }
        : { action: 'create_period', academic_year_id: currentYear.id, ...periodForm };
      const res = await fetch('/api/academic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowPeriodModal(false);
        setPeriodForm({});
        await loadData();
      }
    } finally {
      setSaving(false);
    }
  };

  const deletePeriod = async (id: string) => {
    if (!confirm(t('confirmDeletePeriod'))) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch('/api/academic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'delete_period', id }),
    });
    await loadData();
  };

  const saveHoliday = async () => {
    if (!holidayForm.name || !holidayForm.date) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const body = holidayForm.id
        ? { action: 'update_holiday', id: holidayForm.id, ...holidayForm }
        : { action: 'create_holiday', ...holidayForm };
      const res = await fetch('/api/academic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowHolidayModal(false);
        setHolidayForm({});
        await loadData();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteHoliday = async (id: string) => {
    if (!confirm(t('confirmDeleteHoliday'))) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch('/api/academic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'delete_holiday', id }),
    });
    await loadData();
  };

  // Timeline: year range, segments, current week
  const today = new Date();
  const todayMs = today.getTime();
  const yearStart = currentYear ? new Date(currentYear.start_date + 'T12:00:00').getTime() : 0;
  const yearEnd = currentYear ? new Date(currentYear.end_date + 'T12:00:00').getTime() : 0;
  const yearDays = yearStart && yearEnd ? Math.max(1, Math.ceil((yearEnd - yearStart) / (24 * 60 * 60 * 1000))) : 0;

  const currentYearPeriods = currentYear
    ? periods.filter((p) => p.academic_year_id === currentYear.id)
    : [];

  const getSegmentStyle = (start: string, end: string, type: PeriodType) => {
    const s = new Date(start + 'T12:00:00').getTime();
    const e = new Date(end + 'T12:00:00').getTime();
    const left = yearDays > 0 ? ((Math.max(s, yearStart) - yearStart) / (yearEnd - yearStart)) * 100 : 0;
    const width = yearDays > 0 ? ((Math.min(e, yearEnd) - Math.max(s, yearStart)) / (yearEnd - yearStart)) * 100 : 0;
    return { left: `${left}%`, width: `${Math.max(0, width)}%` };
  };

  const isCurrentWeek = (start: string, end: string) => {
    const s = new Date(start + 'T12:00:00').getTime();
    const e = new Date(end + 'T12:00:00').getTime();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + (locale === 'ar' ? 6 : 0));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return todayMs >= s && todayMs <= e;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Section 1: Current year card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <h2 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-teal-600" />
          {t('currentYear')}
        </h2>
        {currentYear ? (
          editYear?.id === currentYear.id ? (
            <div className="space-y-3">
              <input
                type="text"
                value={editYearForm.name}
                onChange={(e) => setEditYearForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder={t('yearName')}
              />
              <div className="flex gap-2">
                <input
                  type="date"
                  value={editYearForm.start_date}
                  onChange={(e) => setEditYearForm((f) => ({ ...f, start_date: e.target.value }))}
                  className="flex-1 px-3 py-2 border rounded-lg"
                />
                <input
                  type="date"
                  value={editYearForm.end_date}
                  onChange={(e) => setEditYearForm((f) => ({ ...f, end_date: e.target.value }))}
                  className="flex-1 px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={saveYear}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {saving ? t('saving') : t('save')}
                </button>
                <button
                  onClick={() => {
                    setEditYear(null);
                    setEditYearForm({ name: currentYear.name, start_date: currentYear.start_date, end_date: currentYear.end_date });
                  }}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  {t('cancel')}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xl font-semibold text-slate-900">{currentYear.name}</p>
                <p className="text-slate-600 text-sm mt-1">
                  {formatDateAr(currentYear.start_date)} — {formatDateAr(currentYear.end_date)}
                </p>
              </div>
              <button
                onClick={() => {
                  setEditYear(currentYear);
                  setEditYearForm({
                    name: currentYear.name,
                    start_date: currentYear.start_date,
                    end_date: currentYear.end_date,
                  });
                }}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                <Pencil className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          )
        ) : (
          <p className="text-slate-500">{t('noYear')}</p>
        )}
      </div>

      {/* Section 2: Timeline bar */}
      {currentYear && yearDays > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
          <h2 className="font-bold text-slate-900 mb-4">{t('timeline')}</h2>
          <div className="relative h-10 rounded-lg overflow-hidden bg-slate-100">
            {currentYearPeriods.map((p) => {
              const style = getSegmentStyle(p.start_date, p.end_date, p.period_type);
              const isCurrent = isCurrentWeek(p.start_date, p.end_date);
              return (
                <div
                  key={p.id}
                  className={`absolute top-0 h-full ${PERIOD_COLORS[p.period_type]} ${isCurrent ? 'animate-pulse ring-2 ring-teal-500 ring-offset-1' : ''}`}
                  style={style}
                  title={p.name}
                />
              );
            })}
            {/* Current week indicator if not in a period */}
            {!currentYearPeriods.some((p) => isCurrentWeek(p.start_date, p.end_date)) && (
              <div
                className="absolute top-0 h-full bg-teal-400 animate-pulse"
                style={{
                  left: `${Math.max(0, ((todayMs - yearStart) / (yearEnd - yearStart)) * 100 - 1)}%`,
                  width: '2%',
                }}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-300" /> {t('normal')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" /> {t('exam')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400" /> {t('holiday')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-300" /> {t('peak')}</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-teal-400 animate-pulse" /> {t('currentWeek')}</span>
          </div>
        </div>
      )}

      {/* Section 3: Period management */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-900">{t('periods')}</h2>
          {currentYear && (
            <button
              onClick={() => {
                setPeriodForm({ period_type: 'exam', name: '', start_date: '', end_date: '' });
                setShowPeriodModal(true);
              }}
              className="flex items-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              {t('addExamPeriod')}
            </button>
          )}
        </div>
        {currentYearPeriods.length > 0 ? (
          <div className="space-y-2">
            {currentYearPeriods.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-3 h-3 rounded ${PERIOD_COLORS[p.period_type]}`} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-slate-500 text-sm">
                    {formatDateShort(p.start_date)} — {formatDateShort(p.end_date)}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setPeriodForm({ ...p });
                      setShowPeriodModal(true);
                    }}
                    className="p-1.5 rounded hover:bg-slate-200"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deletePeriod(p.id)}
                    className="p-1.5 rounded hover:bg-red-100 text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">{t('noPeriods')}</p>
        )}

        <div className="mt-6 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-800">{t('holidays')}</h3>
            <button
              onClick={() => {
                setHolidayForm({ name: '', date: '', is_recurring: false });
                setShowHolidayModal(true);
              }}
              className="flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" />
              {t('addHoliday')}
            </button>
          </div>
          {holidays.length > 0 ? (
            <div className="mt-3 space-y-2">
              {holidays.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-100"
                >
                  <span>{h.name} — {formatDateShort(h.date)}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setHolidayForm({ ...h });
                        setShowHolidayModal(true);
                      }}
                      className="p-1.5 rounded hover:bg-slate-200"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteHoliday(h.id)}
                      className="p-1.5 rounded hover:bg-red-100 text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 text-sm mt-2">{t('noHolidays')}</p>
          )}
        </div>
      </div>

      {/* Section 4: Create new year button */}
      <button
        onClick={() => {
          const nextSep = new Date(today.getFullYear(), 8, 1);
          const nextJun = new Date(today.getFullYear() + 1, 5, 30);
          setNewYearForm({
            name: `${t('academicYear')} ${nextSep.getFullYear()}-${nextJun.getFullYear()}`,
            start_date: nextSep.toISOString().slice(0, 10),
            end_date: nextJun.toISOString().slice(0, 10),
          });
          setShowNewYearModal(true);
        }}
        className="w-full py-4 px-6 rounded-xl border-2 border-dashed border-teal-400 text-teal-700 font-medium hover:bg-teal-50 flex items-center justify-center gap-2"
      >
        <Plus className="w-5 h-5" />
        {t('createNewYear')}
      </button>

      {/* Modals */}
      {showNewYearModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="font-bold text-lg mb-4">{t('createNewYear')}</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={newYearForm.name}
                onChange={(e) => setNewYearForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder={t('yearName')}
              />
              <input
                type="date"
                value={newYearForm.start_date}
                onChange={(e) => setNewYearForm((f) => ({ ...f, start_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
              />
              <input
                type="date"
                value={newYearForm.end_date}
                onChange={(e) => setNewYearForm((f) => ({ ...f, end_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={createYear}
                disabled={saving}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? t('saving') : t('create')}
              </button>
              <button
                onClick={() => setShowNewYearModal(false)}
                className="px-4 py-2 border rounded-lg"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPeriodModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="font-bold text-lg mb-4">{periodForm.id ? t('editPeriod') : t('addPeriod')}</h3>
            <div className="space-y-3">
              <select
                value={periodForm.period_type ?? 'exam'}
                onChange={(e) => setPeriodForm((f) => ({ ...f, period_type: e.target.value as PeriodType }))}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="exam">{t('exam')}</option>
                <option value="holiday">{t('holiday')}</option>
                <option value="peak">{t('peak')}</option>
                <option value="normal">{t('normal')}</option>
              </select>
              <input
                type="text"
                value={periodForm.name ?? ''}
                onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder={t('periodName')}
              />
              <input
                type="date"
                value={periodForm.start_date ?? ''}
                onChange={(e) => setPeriodForm((f) => ({ ...f, start_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
              />
              <input
                type="date"
                value={periodForm.end_date ?? ''}
                onChange={(e) => setPeriodForm((f) => ({ ...f, end_date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={savePeriod}
                disabled={saving}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </button>
              <button
                onClick={() => setShowPeriodModal(false)}
                className="px-4 py-2 border rounded-lg"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHolidayModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 max-w-md w-full">
            <h3 className="font-bold text-lg mb-4">{holidayForm.id ? t('editHoliday') : t('addHoliday')}</h3>
            <div className="space-y-3">
              <input
                type="text"
                value={holidayForm.name ?? ''}
                onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder={t('holidayName')}
              />
              <input
                type="date"
                value={holidayForm.date ?? ''}
                onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg"
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={holidayForm.is_recurring ?? false}
                  onChange={(e) => setHolidayForm((f) => ({ ...f, is_recurring: e.target.checked }))}
                />
                <span className="text-sm">{t('isRecurring')}</span>
              </label>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={saveHoliday}
                disabled={saving}
                className="flex-1 py-2 bg-teal-600 text-white rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? t('saving') : t('save')}
              </button>
              <button
                onClick={() => setShowHolidayModal(false)}
                className="px-4 py-2 border rounded-lg"
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
