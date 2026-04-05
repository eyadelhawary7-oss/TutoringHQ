'use client';

import { useState, useEffect } from 'react';

interface StudentData {
  name: string;
  center_name: string;
  center_phone: string | null;
  balance_due: number;
  scans_by_date: Record<string, boolean>;
  next_sessions: { day: string; time: string; group: string }[];
}

export default function ParentPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const [token, setToken] = useState<string>('');
  const [data, setData] = useState<StudentData | null>(null);
  const [expired, setExpired] = useState(false);
  const [centerPhone, setCenterPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setToken(p.token));
  }, [params]);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/parent/portal?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.expired) {
          setExpired(true);
          setCenterPhone(json.center_phone ?? null);
        } else if (json.error) {
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex items-center justify-center p-4" dir="rtl">
        <p className="text-[var(--color-text-secondary)]">جاري التحميل...</p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex flex-col items-center justify-center p-6" dir="rtl">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-2">انتهت صلاحية الرابط</h1>
        <p className="text-[var(--color-text-secondary)] text-center mb-4">رابط البوابة منتهي الصلاحية. تواصل مع السنتر للمزيد.</p>
        {centerPhone && (
          <a href={`https://wa.me/${centerPhone.replace(/^\+/, '').replace(/\D/g, '')}`} className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium">
            تواصل عبر واتساب
          </a>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[var(--color-surface-0)] flex items-center justify-center p-4" dir="rtl">
        <p className="text-[var(--color-text-secondary)]">لا يوجد بيانات</p>
      </div>
    );
  }

  const days: string[] = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] p-4 pb-8" dir="rtl">
      <div className="max-w-md mx-auto">
        <h1 className="text-xl font-bold text-[var(--color-text-primary)] mb-1">{data.name}</h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">{data.center_name}</p>

        <section className="bg-[var(--color-surface-1)] rounded-xl shadow-sm p-4 mb-4">
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-3">الحضور (٣٠ يوم)</h2>
          <div className="grid grid-cols-10 gap-1">
            {days.map((d) => (
              <div
                key={d}
                className={`aspect-square rounded-sm ${data.scans_by_date[d] ? 'bg-green-500' : 'bg-slate-200'}`}
                title={d}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-secondary)] mt-2">أخضر = حضر</p>
        </section>

        <section className="bg-[var(--color-surface-1)] rounded-xl shadow-sm p-4 mb-4">
          <h2 className="font-semibold text-[var(--color-text-primary)] mb-2">المستحق</h2>
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">{data.balance_due.toLocaleString('en-US')} ج.م</p>
        </section>

        {data.next_sessions.length > 0 && (
          <section className="bg-[var(--color-surface-1)] rounded-xl shadow-sm p-4 mb-4">
            <h2 className="font-semibold text-[var(--color-text-primary)] mb-3">الجلسات القادمة</h2>
            <ul className="space-y-2">
              {data.next_sessions.map((s, i) => (
                <li key={i} className="flex justify-between text-sm">
                  <span>{s.day} - {s.time}</span>
                  <span className="text-[var(--color-text-secondary)]">{s.group}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.center_phone && (
          <a
            href={`https://wa.me/${data.center_phone.replace(/^\+/, '').replace(/\D/g, '')}`}
            className="block w-full py-3 bg-green-600 text-white text-center rounded-xl font-medium"
          >
            تواصل مع السنتر
          </a>
        )}
      </div>
    </div>
  );
}
