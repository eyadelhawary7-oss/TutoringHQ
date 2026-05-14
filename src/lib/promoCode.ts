/**
 * Server-side promo-code validation shared between the public /api/promo/validate
 * endpoint and the /api/signup route (server-side re-validation before payment).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPlanPrice, isPlanKey, normalizeBillingPeriod } from '@/lib/pricing';
import type { BillingPeriod, PlanKey } from '@/lib/pricing';

export type PromoValidationError =
  | 'code_not_found'
  | 'code_expired'
  | 'code_exhausted'
  | 'already_used';

export interface PromoCodeRow {
  id: string;
  code: string;
  discount_pct: number;
  max_uses_total: number | null;
  uses_count: number;
  expires_at: string | null;
  is_active: boolean;
}

export interface PromoValidationSuccess {
  valid: true;
  promoCodeId: string;
  code: string;
  discountPct: number;
  originalAmountEgp: number;
  discountedAmountEgp: number;
  savingsEgp: number;
  appliesTo: 'first_billing_cycle_only';
}

export interface PromoValidationFailure {
  valid: false;
  error: PromoValidationError;
}

export type PromoValidationResult = PromoValidationSuccess | PromoValidationFailure;

export async function validatePromoCodeServerSide(
  supabase: SupabaseClient,
  opts: {
    code: string;
    planKey: string;
    billingInterval: string;
    userId?: string | null;
    centerId?: string | null;
  },
): Promise<PromoValidationResult> {
  const upperCode = opts.code.trim().toUpperCase();
  if (!upperCode) return { valid: false, error: 'code_not_found' };

  const { data: row } = await supabase
    .from('promo_codes')
    .select('id, code, discount_pct, max_uses_total, uses_count, expires_at, is_active')
    .eq('code', upperCode)
    .maybeSingle();

  if (!row || !(row as PromoCodeRow).is_active) {
    return { valid: false, error: 'code_not_found' };
  }

  const pc = row as PromoCodeRow;

  if (pc.expires_at) {
    const exp = new Date(pc.expires_at).getTime();
    if (!Number.isNaN(exp) && exp < Date.now()) {
      return { valid: false, error: 'code_expired' };
    }
  }

  if (pc.max_uses_total !== null && pc.uses_count >= pc.max_uses_total) {
    return { valid: false, error: 'code_exhausted' };
  }

  if (opts.userId) {
    const { data: existing } = await supabase
      .from('promo_code_redemptions')
      .select('id')
      .eq('promo_code_id', pc.id)
      .eq('user_id', opts.userId)
      .maybeSingle();
    if (existing) return { valid: false, error: 'already_used' };
  }

  if (opts.centerId) {
    const { data: existingCenter } = await supabase
      .from('promo_code_redemptions')
      .select('id')
      .eq('promo_code_id', pc.id)
      .eq('center_id', opts.centerId)
      .maybeSingle();
    if (existingCenter) return { valid: false, error: 'already_used' };
  }

  const period = normalizeBillingPeriod(opts.billingInterval) as BillingPeriod;
  const planKeyLower = opts.planKey.toLowerCase();
  if (!isPlanKey(planKeyLower)) {
    return { valid: false, error: 'code_not_found' };
  }
  const originalAmountEgp = getPlanPrice(planKeyLower as PlanKey, period);
  const savingsEgp = Math.floor(originalAmountEgp * (pc.discount_pct / 100));
  const discountedAmountEgp = Math.max(1, originalAmountEgp - savingsEgp);

  return {
    valid: true,
    promoCodeId: pc.id,
    code: pc.code,
    discountPct: pc.discount_pct,
    originalAmountEgp,
    discountedAmountEgp,
    savingsEgp,
    appliesTo: 'first_billing_cycle_only',
  };
}
