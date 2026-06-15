'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Legacy route. The checklist is now the "Checklist" tab of the unified
// Attendance page (/[locale]/attendance). Kept as a redirect so old links keep
// working, landing directly on the checklist tab.
export default function ChecklistRedirect() {
  const params = useParams();
  const router = useRouter();
  const locale = (params?.locale as string) || 'ar';

  useEffect(() => {
    router.replace(`/${locale}/attendance?tab=checklist`);
  }, [locale, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--color-surface-0)]">
      <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
