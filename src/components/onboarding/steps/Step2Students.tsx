'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Plus } from 'lucide-react';

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
}

export default function Step2Students({ students, groups, onAdd, canProceed }: Step2StudentsProps) {
  const t = useTranslations('onboarding');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [groupId, setGroupId] = useState('');
  const [adding, setAdding] = useState(false);

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
        <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
          <Users className="w-6 h-6 text-teal-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">{t('step2Title')}</h2>
          <p className="text-sm text-slate-500">{t('step2Desc')}</p>
        </div>
      </div>

      {!canProceed && (
        <p className="text-sm text-amber-600 bg-amber-50 px-4 py-2 rounded-lg">{t('step2MinStudents')}</p>
      )}

      <div className="space-y-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tCommon('name')}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder={tCommon('phone')}
          dir="ltr"
          className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        {groups.length > 0 && (
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">{tCommon('select')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={handleAdd}
          disabled={adding || !name.trim() || students.length >= 3}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Plus size={18} /> {tCommon('add')}
        </button>
      </div>

      {students.length > 0 && (
        <div className="space-y-2">
          {students.map((s, i) => (
            <div key={s.id ?? i} className="flex items-center justify-between px-4 py-2 rounded-lg bg-slate-50 border border-slate-100">
              <div>
                <div className="font-medium text-foreground text-sm">{s.name}</div>
                <div className="text-xs text-slate-500 font-mono" dir="ltr">{s.phone || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
