'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { supabase } from '@/lib/supabase';

export type TeacherContext = {
  state: 'center_only' | 'unified' | 'lapsed';
  centers: { id: string; name: string | null; center_code: string | null }[];
  hasPrivateAccess: boolean;
};

/**
 * Shared client loader for the teacher portal bootstrap context
 * (/api/teacher/context). Every portal page gates on it: `hasPrivateAccess`
 * decides locked vs full content, `state` decides the CTA (create vs resume),
 * and `centers` feeds the proposals form. Mirrors the auth-redirect behaviour
 * the old single-page home used.
 */
export function useTeacherContext() {
  const router = useRouter();
  const [ctx, setCtx] = useState<TeacherContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/login');
        return;
      }
      const res = await fetch('/api/teacher/context', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.status === 401 || res.status === 403) {
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setError(true);
        return;
      }
      setCtx((await res.json()) as TeacherContext);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ctx, loading, error, reload };
}
