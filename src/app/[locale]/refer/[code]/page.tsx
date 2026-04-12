'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { Link } from '@/i18n/routing';
import { Gift, Loader2 } from 'lucide-react';

const APP_URL = typeof window !== 'undefined' ? window.location.origin : 'https://centerhq.app';

export default function ReferPage() {
  const params = useParams();
  const router = useRouter();
  const code = typeof params?.code === 'string' ? params.code.trim().toUpperCase() : '';
  const [referrerName, setReferrerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!code) {
      setLoading(false);
      setError(true);
      return;
    }
    localStorage.setItem('referral_code', code);
    const url = new URL(window.location.href);
    url.searchParams.set('ref', code);
    window.history.replaceState({}, '', url.toString());

    fetch('/api/referral/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data?.valid && data?.referrerName) {
          setReferrerName(data.referrerName);
        } else {
          setError(true);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [code]);

  const signupUrl = `${APP_URL}/ar/signup?ref=${encodeURIComponent(code)}`;

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-br from-teal-50 to-slate-50" dir="rtl">
        <Loader2 className="w-10 h-10 animate-spin text-teal-600 mb-4" />
        <p className="text-[var(--color-text-secondary)]">جاري التحميل...</p>
      </div>
    );
  }

  if (error || !code) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-br from-teal-50 to-slate-50" dir="rtl">
        <div className="text-center max-w-md">
          <p className="text-[var(--color-text-secondary)] mb-4">رابط غير صالح أو منتهي الصلاحية.</p>
          <Link href="/" className="text-teal-600 font-medium hover:underline">
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-gradient-to-br from-teal-50 to-slate-50" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-1)] shadow-xl p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-teal-100 flex items-center justify-center mx-auto mb-6">
          <Gift className="w-8 h-8 text-teal-600" />
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">مرحباً بك!</h1>
        <p className="text-[var(--color-text-secondary)] mb-6">
          تمت دعوتك من قبل <span className="font-semibold text-teal-700">{referrerName ?? 'سنتر'}</span> لتجربة CenterHQ
        </p>
        <Link
          href={signupUrl}
          className="inline-flex items-center justify-center w-full py-4 px-6 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-lg transition-colors"
        >
          احجز عرضك التجريبي
        </Link>
        <p className="text-xs text-[var(--color-text-secondary)] mt-6">
          كود الإحالة <span className="font-mono font-medium">{code}</span> سيُطبّق تلقائياً عند التسجيل
        </p>
      </div>
    </div>
  );
}
