'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Legacy route. Scanner is now the QR-scan tab of the unified Attendance page.
export default function ScannerRedirect() {
  const params = useParams();
  const router = useRouter();
  const locale = (params?.locale as string) || 'ar';

  useEffect(() => {
    router.replace(`/${locale}/attendance`);
  }, [locale, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
