'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'centerhq_card_order_cart';

export function useCardOrderCart() {
  const [cart, setCart] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setCart(parsed.filter((x): x is string => typeof x === 'string'));
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  const addToCart = useCallback((studentId: string) => {
    setCart((prev) => {
      if (prev.includes(studentId)) return prev;
      const next = [...prev, studentId];
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const removeFromCart = useCallback((studentId: string) => {
    setCart((prev) => {
      const next = prev.filter((id) => id !== studentId);
      if (typeof window !== 'undefined') {
        if (next.length === 0) localStorage.removeItem(STORAGE_KEY);
        else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const isInCart = useCallback((studentId: string) => cart.includes(studentId), [cart]);

  return {
    cart,
    addToCart,
    removeFromCart,
    clearCart,
    isInCart,
    cartCount: cart.length,
  };
}
