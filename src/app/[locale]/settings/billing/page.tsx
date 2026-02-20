'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';

export default function BillingRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=billing');
  }, [router]);
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-teal-500 border-t-transparent rounded-full" />
    </div>
  );
}
