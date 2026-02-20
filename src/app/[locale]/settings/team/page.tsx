'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';

export default function TeamRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=team');
  }, [router]);
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-2 border-teal-600 border-t-transparent rounded-full" />
    </div>
  );
}
