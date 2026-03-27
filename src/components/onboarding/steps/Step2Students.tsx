'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Users, Plus, FileSpreadsheet, UserPlus } from 'lucide-react';

interface StudentRow {
  id?: string;
  name: string;
  phone: string;
  groupId: string;
}

interface Group {
  id: string;
  name: string;
}

interface Step2StudentsProps {
  students: StudentRow[];
  groups: Group[];
  onAdd: (name: string, phone: string, groupId: string) => Promise<void>;
  canProceed: boolean;
  onSkip: () => void | Promise<void>;
}

export default function Step2Students({ students, groups, onAdd, canProceed, onSkip }: Step2StudentsProps) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [groupId, setGroupId] = useState('');
  const [adding, setAdding] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const handleAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await onAdd(name.trim(), phone.trim(), groupId || groups[0]?.id || '');
      setName('');
      setPhone('');
      setGroupId('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[rgba(13,148,136,0.12)] flex items-center justify-center">
          <Users className="w-6 h-6 text-[var(--color-brand-500)]" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{t('step2Title')}</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">{t('step2Desc')}</p>
        </div>
      </div>

      {!canProceed && (
        <p className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/20 px-4 py-2 rounded-lg">
          {t('step2MinStudents')}
        </p>
      )}

      <Link
        href="/students/import"
        className="block rounded-2xl border-2 border-teal-500 bg-[rgba(13,148,136,0.06)] p-5 transition-colors hover:bg-[rgba(13,148,136,0.1)]"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-500/15 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-7 h-7 text-teal-600" />
          </div>
          <div className="min-w-0 text-start">
            <h3 className="text-lg font-bold text-[var(--color-text-primary)]">{t('importCSV')}</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('importCSVSub')}</p>
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={() => setShowManual((v) => !v)}
        className="w-full rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-0)] p-4 text-start transition-colors hover:border-[var(--color-border-strong)]"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--color-surface-2)] flex items-center justify-center shrink-0">
            <UserPlus className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </div>
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('addManually')}</span>
        </div>
      </button>

      {showManual && (
        <div className="space-y-3 pt-1">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tCommon('name')}
            className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={tCommon('phone')}
            dir="ltr"
            className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]"
          />
          {groups.length > 0 && (
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-[var(--color-border-default)] bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)]"
            >
              <option value="">{tCommon('select')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={adding || !name.trim() || students.length >= 3}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Plus size={18} /> {tCommon('add')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => void onSkip()}
        className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-teal-600 underline-offset-2 hover:underline w-full text-center py-1"
      >
        {t('skipStudents')}
      </button>

      {students.length > 0 && (
        <div className="space-y-2">
          {students.map((s, i) => (
            <div
              key={s.id ?? i}
              className="flex items-center justify-between px-4 py-2 rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border-default)]"
            >
              <div>
                <div className="font-medium text-[var(--color-text-primary)] text-sm">{s.name}</div>
                <div className="text-xs text-[var(--color-text-secondary)] font-mono" dir="ltr">
                  {s.phone || '—'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
