'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocale } from 'next-intl';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import type { CartPayload, HydratedCartItem } from '@/lib/card-order-cart/server';
import { computeCardCartTotals } from '@/lib/card-order-cart/totals';

export type CardOrderCartContextValue = {
  cart: CartPayload['cart'];
  items: HydratedCartItem[];
  activeItems: HydratedCartItem[];
  savedForLater: HydratedCartItem[];
  totals: ReturnType<typeof computeCardCartTotals>;
  minimumQuantity: number;
  loading: boolean;
  error: string | null;
  concurrencyConflict: boolean;
  activeItemCount: number;
  refresh: () => Promise<void>;
  acknowledgeConcurrency: () => void;
  addItem: (body: { kind: 'student'; student_id: string } | { kind: 'blank'; quantity: number }) => Promise<void>;
  addItemsBatch: (
    items: Array<{ kind: 'student'; student_id: string } | { kind: 'blank'; quantity: number }>,
  ) => Promise<void>;
  updateItem: (itemId: string, patch: { quantity?: number; saved_for_later?: boolean }) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  toggleSaveForLater: (itemId: string, saved: boolean) => Promise<void>;
  abandonCart: () => Promise<void>;
  createCart: () => Promise<void>;
  isStudentInCart: (studentId: string) => boolean;
};

const CardOrderCartContext = createContext<CardOrderCartContextValue | null>(null);

async function bearerToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function CardOrderCartProvider({ children }: { children: ReactNode }) {
  const { user } = useUser();
  const locale = useLocale();
  const localeShort: 'en' | 'ar' = locale.startsWith('ar') ? 'ar' : 'en';

  const [payload, setPayload] = useState<CartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [concurrencyConflict, setConcurrencyConflict] = useState(false);

  const mutatingRef = useRef(false);
  const lastSyncedUpdatedAtRef = useRef<string | null>(null);
  const payloadRef = useRef<CartPayload | null>(null);
  payloadRef.current = payload;

  const fetchCart = useCallback(async () => {
    const token = await bearerToken();
    if (!token || !user?.center_id) {
      setPayload(null);
      setLoading(false);
      setError(null);
      return;
    }

    setError(null);
    try {
      const res = await fetch('/api/card-order-cart', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      const data = (await res.json()) as CartPayload;

      if (!mutatingRef.current && data.cart && user?.id) {
        const prevU = lastSyncedUpdatedAtRef.current;
        const curU = data.cart.updated_at;
        const curActor = data.cart.last_modified_by;
        if (prevU != null && curU !== prevU && curActor && curActor !== user.id) {
          setConcurrencyConflict(true);
        }
      }

      lastSyncedUpdatedAtRef.current = data.cart?.updated_at ?? null;
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cart');
    } finally {
      setLoading(false);
      mutatingRef.current = false;
    }
  }, [user?.center_id, user?.id]);

  useEffect(() => {
    setLoading(true);
    void fetchCart();
  }, [fetchCart]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') void fetchCart();
    };
    const onFocus = () => void fetchCart();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchCart]);

  const mutateJson = useCallback(async (exec: (token: string) => Promise<Response>) => {
    const token = await bearerToken();
    if (!token) throw new Error('Not authenticated');
    const snapshot = payloadRef.current;
    mutatingRef.current = true;
    try {
      const res = await exec(token);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? res.statusText);
      }
      const data = (await res.json()) as CartPayload;
      lastSyncedUpdatedAtRef.current = data.cart?.updated_at ?? null;
      setPayload(data);
      setConcurrencyConflict(false);
    } catch (e) {
      setPayload(snapshot);
      throw e;
    } finally {
      mutatingRef.current = false;
    }
  }, []);

  const addItem = useCallback(
    async (body: { kind: 'student'; student_id: string } | { kind: 'blank'; quantity: number }) => {
      await mutateJson((token) =>
        fetch('/api/card-order-cart/items', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );
    },
    [mutateJson],
  );

  const addItemsBatch = useCallback(
    async (items: Array<{ kind: 'student'; student_id: string } | { kind: 'blank'; quantity: number }>) => {
      await mutateJson((token) =>
        fetch('/api/card-order-cart/items', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ items }),
        }),
      );
    },
    [mutateJson],
  );

  const updateItem = useCallback(
    async (itemId: string, patch: { quantity?: number; saved_for_later?: boolean }) => {
      await mutateJson((token) =>
        fetch(`/api/card-order-cart/items/${encodeURIComponent(itemId)}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patch),
        }),
      );
    },
    [mutateJson],
  );

  const removeItem = useCallback(
    async (itemId: string) => {
      await mutateJson((token) =>
        fetch(`/api/card-order-cart/items/${encodeURIComponent(itemId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
    },
    [mutateJson],
  );

  const toggleSaveForLater = useCallback(
    async (itemId: string, saved: boolean) => {
      await updateItem(itemId, { saved_for_later: saved });
    },
    [updateItem],
  );

  const abandonCart = useCallback(async () => {
    await mutateJson((token) =>
      fetch('/api/card-order-cart', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }, [mutateJson]);

  const createCart = useCallback(async () => {
    await mutateJson((token) =>
      fetch('/api/card-order-cart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }, [mutateJson]);

  const acknowledgeConcurrency = useCallback(() => {
    setConcurrencyConflict(false);
    void fetchCart();
  }, [fetchCart]);

  const items = payload?.items ?? [];
  const minimumQuantity = payload?.minimumQuantity ?? 1;

  const activeItems = useMemo(() => items.filter((i) => !i.saved_for_later), [items]);
  const savedForLater = useMemo(() => items.filter((i) => i.saved_for_later), [items]);

  const totals = useMemo(() => computeCardCartTotals(activeItems, localeShort), [activeItems, localeShort]);

  const activeItemCount = totals.activeCardCount;

  const studentIdsInCart = useMemo(() => {
    const s = new Set<string>();
    for (const i of items) {
      if (i.kind === 'student' && i.student_id) s.add(i.student_id);
    }
    return s;
  }, [items]);

  const isStudentInCart = useCallback((studentId: string) => studentIdsInCart.has(studentId), [studentIdsInCart]);

  const value = useMemo<CardOrderCartContextValue>(
    () => ({
      cart: payload?.cart ?? null,
      items,
      activeItems,
      savedForLater,
      totals,
      minimumQuantity,
      loading,
      error,
      concurrencyConflict,
      activeItemCount,
      refresh: fetchCart,
      acknowledgeConcurrency,
      addItem,
      addItemsBatch,
      updateItem,
      removeItem,
      toggleSaveForLater,
      abandonCart,
      createCart,
      isStudentInCart,
    }),
    [
      payload?.cart,
      items,
      activeItems,
      savedForLater,
      totals,
      minimumQuantity,
      loading,
      error,
      concurrencyConflict,
      activeItemCount,
      fetchCart,
      acknowledgeConcurrency,
      addItem,
      addItemsBatch,
      updateItem,
      removeItem,
      toggleSaveForLater,
      abandonCart,
      createCart,
      isStudentInCart,
    ],
  );

  return <CardOrderCartContext.Provider value={value}>{children}</CardOrderCartContext.Provider>;
}

export function useCardOrderCart(): CardOrderCartContextValue {
  const ctx = useContext(CardOrderCartContext);
  if (!ctx) {
    throw new Error('useCardOrderCart must be used within CardOrderCartProvider');
  }
  return ctx;
}

export function useCardOrderCartOptional(): CardOrderCartContextValue | null {
  return useContext(CardOrderCartContext);
}
