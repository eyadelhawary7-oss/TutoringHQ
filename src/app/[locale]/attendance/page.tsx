'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { QrCode, ListChecks } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import ScanTab from '@/components/attendance/ScanTab';
import ChecklistTab from '@/components/attendance/ChecklistTab';
import { RejectedScansBanner } from '@/components/scanner/RejectedScansBanner';

type AttendanceTab = 'scan' | 'checklist';

/**
 * Single Attendance surface: QR scan + Checklist tabs, both ALWAYS available for
 * every group and mixable within one session (both feed the same queueScan /
 * scan_outbox / sync pipeline). Reachable from the sidebar/mobile bar and from a
 * tapped session in the Schedule (which deep-links ?group=&date=&tab=).
 */
function AttendanceSurface() {
  const t = useTranslations('attendance');
  const params = useSearchParams();

  const groupId = params?.get('group') ?? null;
  const initialTab: AttendanceTab = params?.get('tab') === 'checklist' ? 'checklist' : 'scan';
  const [tab, setTab] = useState<AttendanceTab>(initialTab);
  const [groupName, setGroupName] = useState<string | null>(null);

  // Resolve the scoped class name for the context banner (RLS-scoped read).
  useEffect(() => {
    let cancelled = false;
    if (!groupId) {
      setGroupName(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('student_groups')
        .select('name')
        .eq('id', groupId)
        .single();
      if (!cancelled) setGroupName((data as { name?: string } | null)?.name ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const TABS: { key: AttendanceTab; label: string; Icon: typeof QrCode }[] = [
    { key: 'scan', label: t('tabScan'), Icon: QrCode },
    { key: 'checklist', label: t('tabChecklist'), Icon: ListChecks },
  ];

  return (
    <div className="min-h-screen w-full bg-[var(--color-surface-0)]">
      <div className="sticky top-0 z-[11] border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-0)]/95 px-4 pt-[max(12px,env(safe-area-inset-top,0px))] pb-2 backdrop-blur">
        <div
          className="mx-auto flex w-full max-w-lg gap-1 rounded-xl bg-[var(--color-surface-2)] p-1"
          role="tablist"
          aria-label={t('captureTitle')}
        >
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className={`min-h-[44px] flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm transition-all ${
                  active
                    ? 'bg-[var(--color-surface-1)] shadow-sm font-semibold text-[var(--color-text-primary)]'
                    : 'font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <RejectedScansBanner />

      {tab === 'scan' ? (
        <ScanTab contextGroupName={groupName} />
      ) : (
        <ChecklistTab initialGroupId={groupId} />
      )}
    </div>
  );
}

export default function AttendancePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-0)]">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
        </div>
      }
    >
      <AttendanceSurface />
    </Suspense>
  );
}
