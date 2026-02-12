'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { useUser } from '@/contexts/UserContext';
import Navbar from '@/components/Navbar';
import { Link } from '@/i18n/routing';

interface Group {
  id: string;
  name: string;
}

interface Student {
  id: string;
  name: string;
}

const VARIABLES = [
  { key: '{student_name}', hint: 'Student name' },
  { key: '{center_name}', hint: 'Center name' },
  { key: '{subject}', hint: 'Subject' },
  { key: '{amount}', hint: 'Monthly fee' },
  { key: '{date}', hint: 'Today date' },
];

export default function ComposePage() {
  const t = useTranslations('messages');
  const { user, hasPermission } = useUser();
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [target, setTarget] = useState<'group' | 'all' | 'students'>('group');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const meRes = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const meData = await meRes.json();
      if (!meData?.user?.center_id) return;
      setCenterId(meData.user.center_id);

      const [groupsRes, studentsRes] = await Promise.all([
        dbSelect({
          table: 'student_groups',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
        dbSelect({
          table: 'students',
          select: 'id, name',
          filters: [{ column: 'center_id', op: 'eq', value: meData.user.center_id }],
          order: { column: 'name' },
        }),
      ]);

      if (groupsRes.data) setGroups(groupsRes.data as Group[]);
      if (studentsRes.data) setStudents(studentsRes.data as Student[]);
      setIsLoading(false);
    };
    load();
  }, []);

  const insertVariable = (key: string) => {
    setMessage(prev => prev + key);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centerId || !message.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    setIsSending(true);
    setResult(null);

    try {
      const body: Record<string, unknown> = {
        centerId,
        message: message.trim(),
        target,
      };
      if (target === 'group') body.groupId = selectedGroupId;
      if (target === 'students') body.studentIds = Array.from(selectedStudentIds);

      const res = await fetch('/api/whatsapp/send-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        setResult({ sent: data.sent, failed: data.failed });
      } else {
        setResult({ sent: 0, failed: data.error ? 1 : 0 });
      }
    } catch {
      setResult({ sent: 0, failed: 1 });
    } finally {
      setIsSending(false);
    }
  };

  const toggleStudent = (id: string) => {
    setSelectedStudentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (user?.role === 'assistant' && !hasPermission('can_send_whatsapp')) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-500">No access</p>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('compose')}</h1>
            <Link href="/messages" className="text-sm text-indigo-600 dark:text-indigo-400">
              {t('backToMessages')}
            </Link>
          </div>

          {isLoading ? (
            <div className="text-center py-16">
              <svg className="animate-spin h-8 w-8 text-indigo-600 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
          ) : (
            <form onSubmit={handleSend} className="space-y-6 bg-white dark:bg-gray-800 rounded-xl shadow p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('target')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="target" checked={target === 'group'} onChange={() => setTarget('group')} />
                    {t('targetGroup')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="target" checked={target === 'all'} onChange={() => setTarget('all')} />
                    {t('targetAll')}
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="target" checked={target === 'students'} onChange={() => setTarget('students')} />
                    {t('targetStudents')}
                  </label>
                </div>
              </div>

              {target === 'group' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('selectGroup')}</label>
                  <select
                    value={selectedGroupId}
                    onChange={(e) => setSelectedGroupId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                    required={target === 'group'}
                  >
                    <option value="">—</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {target === 'students' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('selectStudents')}</label>
                  <div className="max-h-40 overflow-y-auto space-y-2 p-2 border border-gray-200 dark:border-gray-600 rounded-lg">
                    {students.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedStudentIds.has(s.id)}
                          onChange={() => toggleStudent(s.id)}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('message')}</label>
                <div className="mb-2 flex flex-wrap gap-1">
                  {VARIABLES.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => insertVariable(v.key)}
                      className="px-2 py-1 text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded hover:bg-indigo-200"
                    >
                      {v.key}
                    </button>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  placeholder={t('messagePlaceholder')}
                  required
                />
              </div>

              {result && (
                <div className={`p-4 rounded-lg ${result.failed > 0 ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
                  {t('sentResult', { sent: result.sent, failed: result.failed })}
                </div>
              )}

              <button
                type="submit"
                disabled={isSending || (target === 'group' && !selectedGroupId) || (target === 'students' && selectedStudentIds.size === 0)}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSending ? t('sending') : t('send')}
              </button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
