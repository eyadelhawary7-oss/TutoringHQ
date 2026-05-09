'use client';

import { useEffect, useState, use } from 'react';
import { useRouter, Link } from '@/i18n/routing';
import { useTranslations } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { dbSelect } from '@/lib/db-proxy';
import { useCardOrderCart } from '@/hooks/useCardOrderCart';
import { useToast } from '@/components/ui/ToastProvider';
import { ArrowLeft } from 'lucide-react';
import { pushRecentlyViewedStudent } from '@/lib/recentlyViewedStudents';

type StudentRow = { id: string; name: string; student_number?: string | null };

export default function StudentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const tCart = useTranslations('cart');
  const tDetail = useTranslations('cart.studentDetail');
  const tToast = useTranslations('toasts');
  const ts = useTranslations('students');
  const { toast } = useToast();
  const { addItem, isStudentInCart } = useCardOrderCart();

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<StudentRow | null>(null);
  const [delivered, setDelivered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session || cancelled) return;
        const meRes = await fetch('/api/me', { headers: { Authorization: `Bearer ${session.access_token}` } });
        const meData = await meRes.json();
        const cid = meData?.user?.center_id as string | undefined;
        if (!cid) return;

        const sel = await dbSelect({
          table: 'students',
          select: 'id, name, student_number',
          filters: [
            { column: 'id', op: 'eq', value: id },
            { column: 'center_id', op: 'eq', value: cid },
          ],
        });
        const row =
          Array.isArray(sel.data) && sel.data[0]
            ? ({
                id: String((sel.data[0] as Record<string, unknown>).id),
                name: String((sel.data[0] as Record<string, unknown>).name ?? ''),
                student_number: (sel.data[0] as Record<string, unknown>).student_number as string | null | undefined,
              } satisfies StudentRow)
            : null;
        if (cancelled) return;
        setStudent(row);

        if (row && cid) {
          pushRecentlyViewedStudent(cid, { id: row.id, name: row.name });
        }

        if (row && session.access_token) {
          const stRes = await fetch('/api/card-order-cart/student-card-status', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: [row.id] }),
          });
          if (stRes.ok && !cancelled) {
            const j = (await stRes.json()) as { statusByStudentId?: Record<string, string> };
            setDelivered(j.statusByStudentId?.[row.id] === 'delivered');
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onOrderCard = async () => {
    if (!student || delivered || isStudentInCart(student.id)) return;
    try {
      await addItem({ kind: 'student', student_id: student.id });
      toast.success(tCart('toast.added'), tCart('toast.viewCart'));
    } catch {
      toast.error(tToast('error'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-surface-0)]">
        <p className="text-sm text-[var(--color-text-secondary)]">{ts('loading')}</p>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen px-4 py-8 max-w-lg mx-auto">
        <button type="button" className="text-sm text-teal-600 mb-4 flex items-center gap-1" onClick={() => router.back()}>
          <ArrowLeft size={16} /> {tDetail('back')}
        </button>
        <p className="text-[var(--color-text-secondary)]">{tDetail('notFound')}</p>
      </div>
    );
  }

  const inCart = isStudentInCart(student.id);

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto bg-[var(--color-surface-0)] pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-8">
      <button type="button" className="text-sm text-teal-600 mb-6 flex items-center gap-1" onClick={() => router.back()}>
        <ArrowLeft size={16} /> {tDetail('back')}
      </button>
      <h1 className="text-xl font-bold text-[var(--color-text-primary)]">{student.name}</h1>
      {student.student_number ? (
        <p className="text-sm font-mono text-[var(--color-text-tertiary)] mt-1" dir="ltr">
          <bdi>#{student.student_number}</bdi>
        </p>
      ) : null}

      <div className="mt-8 flex flex-col gap-3">
        {!delivered ? (
          inCart ? (
            <div className="space-y-2">
              <button type="button" disabled className="w-full py-3 rounded-xl bg-[var(--color-surface-2)] text-sm font-semibold text-[var(--color-text-muted)]">
                {tDetail('inCart')}
              </button>
              <Link href="/orders" className="block text-center text-sm font-semibold text-teal-600 underline">
                {tCart('toast.viewCart')}
              </Link>
            </div>
          ) : (
            <button
              type="button"
              className="w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold"
              onClick={() => void onOrderCard()}
            >
              {tDetail('orderCard')}
            </button>
          )
        ) : null}
      </div>
    </div>
  );
}
