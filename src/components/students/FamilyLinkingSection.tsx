'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';

interface Family {
  id: string;
  family_name: string | null;
  parent_phone: string | null;
  parent_name: string | null;
}

interface FamilyLinkingSectionProps {
  centerId: string | null;
  studentId: string;
  currentFamilyId: string | null;
  onFamilyChange: (familyId: string | null) => void;
  onFamilyCreated?: (family: Family) => void;
}

export function FamilyLinkingSection({
  centerId,
  studentId,
  currentFamilyId,
  onFamilyChange,
  onFamilyCreated,
}: FamilyLinkingSectionProps) {
  const t = useTranslations('students');
  const tCommon = useTranslations('common');
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ family_name: '', parent_phone: '', parent_name: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!centerId) return;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/families', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setFamilies(data?.families ?? []);
      setLoading(false);
    };
    load();
  }, [centerId]);

  const handleCreateFamily = async () => {
    if (!centerId) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setCreating(true);
    try {
      const res = await fetch('/api/families', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          family_name: createForm.family_name.trim() || null,
          parent_phone: createForm.parent_phone.trim() || null,
          parent_name: createForm.parent_name.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Failed');
      const family = data.family as Family;
      setFamilies((prev) => [...prev, family]);
      onFamilyChange(family.id);
      onFamilyCreated?.(family);
      setCreateForm({ family_name: '', parent_phone: '', parent_name: '' });
      setShowCreate(false);
    } catch {
      // Error handling
    } finally {
      setCreating(false);
    }
  };

  if (!centerId) return null;

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-[var(--color-text-primary)]">
        {t('linkToFamily')}
      </label>
      {loading ? (
        <p className="text-xs text-[var(--color-text-secondary)]">{t('loading')}</p>
      ) : showCreate ? (
        <div className="space-y-2 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/30">
          <input
            value={createForm.family_name}
            onChange={(e) => setCreateForm((p) => ({ ...p, family_name: e.target.value }))}
            placeholder={t('familyNamePlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
          />
          <input
            value={createForm.parent_name}
            onChange={(e) => setCreateForm((p) => ({ ...p, parent_name: e.target.value }))}
            placeholder={t('parentNamePlaceholder')}
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
          />
          <input
            value={createForm.parent_phone}
            onChange={(e) => setCreateForm((p) => ({ ...p, parent_phone: e.target.value }))}
            placeholder={t('parentPhone')}
            type="tel"
            dir="ltr"
            className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="button"
              onClick={handleCreateFamily}
              disabled={creating}
              className="px-3 py-1.5 text-xs rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-colors font-medium disabled:opacity-50"
            >
              {creating ? '...' : t('createFamily')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <select
            value={currentFamilyId ?? ''}
            onChange={(e) => onFamilyChange(e.target.value || null)}
            className="flex-1 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-0)] text-sm"
          >
            <option value="">{t('noFamily')}</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.family_name || f.parent_name || f.parent_phone || f.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 py-2 rounded-lg border border-[var(--color-border)] text-sm font-medium hover:bg-[var(--color-surface-2)]"
          >
            {t('createNewFamily')}
          </button>
        </div>
      )}
    </div>
  );
}
