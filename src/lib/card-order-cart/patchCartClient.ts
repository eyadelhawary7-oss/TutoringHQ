import { supabase } from '@/lib/supabase';
import type { CartPayload } from '@/lib/card-order-cart/server';

export async function patchCardOrderCart(body: Record<string, unknown>): Promise<CartPayload> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const res = await fetch('/api/card-order-cart', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? res.statusText);
  }

  return (await res.json()) as CartPayload;
}
