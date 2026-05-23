/**
 * Promo-code redemption helper used by the Paymob webhook.
 *
 * Goes through the atomic `redeem_promo_code` RPC (see migration
 * 20260523000000_atomic_promo_redemption.sql) so that:
 *
 *  1. `is_active`, `expires_at`, and `max_uses_total` are re-checked at the
 *     moment of redemption , not just at /api/promo/validate.
 *  2. The redemption row insert and the `uses_count` increment happen in a
 *     single statement; concurrent redemptions cannot push the counter past
 *     `max_uses_total`.
 *
 * `discountPct` is taken from the `promo_codes` row, never from the request
 * body. This module is the single redemption surface; do not insert
 * `promo_code_redemptions` rows or call `increment_promo_uses` directly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type PromoRedemptionResult =
  | { redeemed: true; redemptionId: string; discountPct: number; usesCount: number }
  | { redeemed: false; reason: 'no_invoice' | 'no_promo_on_invoice' | 'code_not_found' | 'denied_or_duplicate' | 'rpc_error' };

export interface RedeemPromoOptions {
  paymobOrderId: string;
}

export async function redeemPromoCodeForPaymobOrder(
  supabase: SupabaseClient,
  opts: RedeemPromoOptions,
): Promise<PromoRedemptionResult> {
  const { paymobOrderId } = opts;

  const { data: inv } = await supabase
    .from('invoices')
    .select('id, center_id, promo_code, promo_original_amount, total_amount')
    .eq('paymob_order_id', paymobOrderId)
    .eq('invoice_type', 'signup_first_payment')
    .eq('status', 'paid')
    .maybeSingle();

  if (!inv) return { redeemed: false, reason: 'no_invoice' };

  const invRow = inv as {
    id: string;
    center_id: string;
    promo_code: string | null;
    promo_original_amount: number | null;
    total_amount: number;
  };
  if (!invRow.promo_code) return { redeemed: false, reason: 'no_promo_on_invoice' };

  // Look up by code only , the RPC re-checks is_active / expires_at / max_uses.
  const { data: pc } = await supabase
    .from('promo_codes')
    .select('id')
    .eq('code', invRow.promo_code)
    .maybeSingle();

  if (!pc) return { redeemed: false, reason: 'code_not_found' };
  const pcRow = pc as { id: string };

  const originalAmountEgp = Math.round(invRow.promo_original_amount ?? invRow.total_amount);
  const discountAmountEgp = Math.max(0, originalAmountEgp - Math.round(invRow.total_amount));

  const { data: ownerUser } = await supabase
    .from('users')
    .select('id')
    .eq('center_id', invRow.center_id)
    .eq('role', 'owner')
    .maybeSingle();
  const userId = (ownerUser as { id?: string } | null)?.id ?? null;

  // Single-statement: atomic check + redemption insert + uses_count increment.
  const { data: redeemRows, error: redeemErr } = await supabase.rpc('redeem_promo_code', {
    p_code_id: pcRow.id,
    p_user_id: userId,
    p_center_id: invRow.center_id,
    p_paymob_order_id: paymobOrderId,
    p_original_amount_egp: originalAmountEgp,
    p_discount_amount_egp: discountAmountEgp,
  });

  if (redeemErr) {
    console.error('[redeemPromoCode] redeem_promo_code RPC error', redeemErr);
    return { redeemed: false, reason: 'rpc_error' };
  }

  // Empty result = denied (inactive / expired / exhausted) OR already
  // redeemed by this centre. Webhook is idempotent: log + skip.
  if (!redeemRows || (Array.isArray(redeemRows) && redeemRows.length === 0)) {
    console.warn('[redeemPromoCode] redemption denied at increment time', {
      paymobOrderId,
      promoCode: invRow.promo_code,
    });
    return { redeemed: false, reason: 'denied_or_duplicate' };
  }

  const row = (Array.isArray(redeemRows) ? redeemRows[0] : redeemRows) as {
    redemption_id?: string;
    discount_pct?: number;
    uses_count?: number;
  };
  return {
    redeemed: true,
    redemptionId: String(row.redemption_id ?? ''),
    discountPct: Number(row.discount_pct ?? 0),
    usesCount: Number(row.uses_count ?? 0),
  };
}
