'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import MyTeachersPanel, { type MyTeachersPanelHandle } from '@/components/teachers/MyTeachersPanel';
import AddTeacherPanel from '@/components/teachers/AddTeacherPanel';
import GroupProposalsTab from '@/components/teachers/GroupProposalsTab';

type Tab = 'myTeachers' | 'addTeacher' | 'requests';

/**
 * Center-side Teachers section (/my-teachers). One home for: My teachers
 * (view-only money + groups), Add teacher (by dedicated code), and Requests
 * (the two-sided new-group / attach-existing negotiation). Clean route - does
 * not touch /teachers, which redirects to the teacher portal.
 */
export default function MyTeachersPage() {
  const t = useTranslations('teachersSection');
  const locale = useLocale();
  const isRTL = locale === 'ar' || locale.startsWith('ar-');
  const [tab, setTab] = useState<Tab>('myTeachers');
  const monitorRef = useRef<MyTeachersPanelHandle>(null);

  // A group created/attached on accept, or a new link, changes the monitor -
  // refresh it so the owner sees it immediately when they switch back.
  const refreshMonitor = () => monitorRef.current?.reload();

  const tabs: { key: Tab; label: string }[] = [
    { key: 'myTeachers', label: t('tabMyTeachers') },
    { key: 'addTeacher', label: t('tabAddTeacher') },
    { key: 'requests', label: t('tabRequests') },
  ];

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className="min-h-screen w-full space-y-6 bg-[var(--color-surface-0)] animate-fade-in"
    >
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{t('subtitle')}</p>
      </div>

      <div className="flex w-fit gap-1 rounded-lg bg-[var(--color-surface-2)] p-1">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === tb.key
                ? 'bg-[var(--color-surface-1)] text-[var(--color-text-primary)] shadow'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'myTeachers' && <MyTeachersPanel panelRef={monitorRef} />}
      {tab === 'addTeacher' && <AddTeacherPanel onChanged={refreshMonitor} />}
      {tab === 'requests' && <GroupProposalsTab onChanged={refreshMonitor} />}
    </div>
  );
}
