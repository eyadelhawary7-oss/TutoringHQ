'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';
import { dbSelect, dbInsert, dbUpdate, dbDelete, auditLog } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import { PageHeader } from '@/components/shared';
import { BookOpen, ChevronRight, X } from 'lucide-react';
import { DirectionalIcon } from '@/components/icons/DirectionalIcon';

interface Subject {
  id: string;
  name: string;
  monthly_fee?: number;
}

export default function SubjectsSettingsPage() {
  const t = useTranslations('settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const locale = useLocale();
  const { user: currentUser, hasPermission } = useUser();
  const isRTL = locale === 'ar';

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [editingSubject, setEditingSubject] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    if (currentUser && (currentUser.role === 'assistant' || currentUser.role === 'teacher') && !hasPermission('can_view_settings')) {
      router.replace('/dashboard');
    }
  }, [currentUser, hasPermission, router]);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setIsLoading(false);
        return;
      }
      setUserId(session.user.id);
      const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) {
        setIsLoading(false);
        return;
      }
      const userCenterId = meData.user.center_id;
      setCenterId(userCenterId);

      const { data: subjectsData } = await dbSelect({
        table: 'subjects',
        select: '*',
        filters: [{ column: 'center_id', op: 'eq', value: userCenterId }],
        order: { column: 'name' },
      });
      if (subjectsData) setSubjects(subjectsData as Subject[]);
      setIsLoading(false);
    };
    load();
  }, []);

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !userId || !newSubjectName.trim()) return;
    const { data, error } = await dbInsert({ table: 'subjects', data: { center_id: centerId, name: newSubjectName.trim() }, single: true });
    if (!error && data) {
      const subject = data as Subject;
      await auditLog({ centerId, userId, action: 'subject_create', entityType: 'subjects', entityId: subject.id, details: { name: subject.name } });
      setSubjects((prev) => [...prev, { ...subject, monthly_fee: 0 }]);
      setNewSubjectName('');
    }
  };

  const handleUpdateSubject = async (id: string) => {
    if (!centerId || !userId) return;
    const { error } = await dbUpdate({ table: 'subjects', data: { name: editName.trim() }, filters: [{ column: 'id', op: 'eq', value: id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'subject_update', entityType: 'subjects', entityId: id, details: { name: editName.trim() } });
      setSubjects((prev) => prev.map((s) => (s.id === id ? { ...s, name: editName.trim() } : s)));
      setEditingSubject(null);
    }
  };

  const handleDeleteSubject = async (id: string) => {
    if (!confirm(t('deleteConfirm')) || !centerId || !userId) return;
    const subj = subjects.find((s) => s.id === id);
    const { data: studentsWithSubject } = await dbSelect({
      table: 'students',
      select: 'id',
      filters: [{ column: 'subject', op: 'eq', value: subj?.name ?? '' }],
      limit: 1,
    });
    if (studentsWithSubject && (studentsWithSubject as unknown[]).length > 0) {
      alert(t('subjectInUse'));
      return;
    }
    const { error } = await dbDelete({ table: 'subjects', filters: [{ column: 'id', op: 'eq', value: id }] });
    if (!error) {
      await auditLog({ centerId, userId, action: 'subject_delete', entityType: 'subjects', entityId: id, details: { name: subj?.name } });
      setSubjects((prev) => prev.filter((s) => s.id !== id));
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4" aria-busy>
          <div className="skeleton h-8 rounded-xl w-48" />
          <div className="skeleton h-40 rounded-2xl w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)] page-enter" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader title={t('subjects')} />
        <div className="mb-6">
          <Link
            href="/settings/general"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <DirectionalIcon icon={ChevronRight} className="w-4 h-4 rotate-180" />
            {t('title')}
          </Link>
        </div>

        <div className="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border-subtle)] card-shadow">
          <div className="flex items-center gap-4 p-6 border-b border-[var(--color-border-subtle)]">
            <div className="p-2 bg-teal-100 rounded-xl shrink-0">
              <BookOpen className="w-4 h-4 text-teal-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--color-text-primary)]">{t('subjects')}</h3>
              <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('subjectName')}</p>
            </div>
          </div>
          <div className="p-6">
            {currentUser?.role === 'owner' || currentUser?.role === 'super_admin' ? (
              <>
                <div className="flex flex-wrap gap-2 mb-4">
                  {subjects.map((subject) =>
                    editingSubject === subject.id ? (
                      <div key={subject.id} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="px-3 py-1.5 border border-[var(--color-border-subtle)] rounded-lg text-sm bg-[var(--color-surface-1)]"
                        />
                        <button type="button" onClick={() => handleUpdateSubject(subject.id)} className="text-teal-600 text-sm font-medium hover:underline">
                          {tCommon('save')}
                        </button>
                        <button type="button" onClick={() => setEditingSubject(null)} className="text-[var(--color-text-secondary)] text-sm hover:underline">
                          {tCommon('cancel')}
                        </button>
                      </div>
                    ) : (
                      <span key={subject.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] rounded-full text-sm font-medium">
                        {subject.name}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSubject(subject.id);
                            setEditName(subject.name);
                          }}
                          className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        >
                          {tCommon('edit')}
                        </button>
                        <button type="button" onClick={() => handleDeleteSubject(subject.id)} className="hover:text-[var(--color-danger)] transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ),
                  )}
                </div>
                <form onSubmit={handleAddSubject} className="flex gap-2">
                  <input
                    type="text"
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    placeholder={t('subjectName')}
                    className="flex-1 px-3 py-2 border border-[var(--color-border-subtle)] rounded-lg text-sm bg-[var(--color-surface-1)] focus:outline-none focus:ring-2 focus:ring-teal-500"
                    required
                  />
                  <button type="submit" className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg transition-colors">
                    {t('addSubject')}
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 mb-4">
                  {subjects.map((subject) => (
                    <span key={subject.id} className="inline-flex items-center px-3 py-1.5 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] rounded-full text-sm font-medium">
                      {subject.name}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {t('subjectManagement.ownerOnlyMessage')}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
