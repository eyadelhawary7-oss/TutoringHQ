import { getPaymobAuthToken } from '@/lib/paymob';

const PAYMOB_BASE = 'https://accept.paymob.com/api';

export type PaymobOrderInquiryResult =
  | { state: 'paid'; transactionId: string | null }
  | { state: 'failed' }
  | { state: 'pending' };

/**
 * Best-effort Paymob order inquiry for public payment polling.
 * Falls back to pending if the API shape is unknown or the call fails.
 */
export async function inquirePaymobCardOrder(paymobOrderId: string): Promise<PaymobOrderInquiryResult> {
  try {
    const token = await getPaymobAuthToken();
    const res = await fetch(`${PAYMOB_BASE}/ecommerce/orders/${encodeURIComponent(paymobOrderId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { state: 'pending' };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const paidCents = Number(data.paid_amount_cents ?? 0);
    const amountCents = Number(data.amount_cents ?? data.original_amount_cents ?? 0);
    if (amountCents > 0 && paidCents >= amountCents) {
      const txs = data.transactions;
      let transactionId: string | null = null;
      if (Array.isArray(txs) && txs.length > 0) {
        const last = txs[txs.length - 1] as Record<string, unknown>;
        if (last.id != null) transactionId = String(last.id);
        if (last.success === false && last.pending === false) {
          return { state: 'failed' };
        }
      }
      return { state: 'paid', transactionId };
    }
    const txs = data.transactions;
    if (Array.isArray(txs) && txs.length > 0) {
      const last = txs[txs.length - 1] as Record<string, unknown>;
      if (last.success === true) {
        const tid = last.id != null ? String(last.id) : null;
        return { state: 'paid', transactionId: tid };
      }
      if (last.success === false && last.pending === false) {
        return { state: 'failed' };
      }
    }
    return { state: 'pending' };
  } catch {
    return { state: 'pending' };
  }
}
