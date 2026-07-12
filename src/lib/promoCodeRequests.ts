// src/lib/promoCodeRequests.ts
//
// Guardrail caps for the Manager promo-code REQUEST flow (Phase 4c).
//
// A sales_manager requests a promo code; the CEO (super_admin) approves/rejects it. To
// stop anyone from requesting a 100%-off / unlimited code, every request is validated
// against caps: a max discount % and a max total-uses. The defaults live here as
// constants and can be overridden per-deployment via platform_config keys
// `promo_request.max_discount_pct` and `promo_request.max_uses` (JSON numbers). Reads
// fail SAFE: on any error or absent/invalid value we fall back to the tighter default.

import type { SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_MAX_DISCOUNT_PCT = 30;
export const DEFAULT_MAX_USES = 500;

export const PROMO_REQUEST_MAX_DISCOUNT_KEY = 'promo_request.max_discount_pct';
export const PROMO_REQUEST_MAX_USES_KEY = 'promo_request.max_uses';

export interface PromoRequestCaps {
  maxDiscountPct: number;
  maxUses: number;
}

/** Coerce a platform_config JSON value to a positive integer, else null. */
function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Load the request caps, preferring platform_config overrides and falling back to the
 * built-in defaults. Never throws — any failure yields the defaults so the guardrail
 * always holds.
 */
export async function loadPromoRequestCaps(
  supabaseAdmin: SupabaseClient,
): Promise<PromoRequestCaps> {
  const caps: PromoRequestCaps = {
    maxDiscountPct: DEFAULT_MAX_DISCOUNT_PCT,
    maxUses: DEFAULT_MAX_USES,
  };
  try {
    const { data, error } = await supabaseAdmin
      .from('platform_config')
      .select('key, value')
      .in('key', [PROMO_REQUEST_MAX_DISCOUNT_KEY, PROMO_REQUEST_MAX_USES_KEY]);
    if (error || !Array.isArray(data)) return caps;
    for (const row of data as { key: string; value: unknown }[]) {
      const n = toPositiveInt(row.value);
      if (n === null) continue;
      if (row.key === PROMO_REQUEST_MAX_DISCOUNT_KEY) {
        caps.maxDiscountPct = Math.min(n, 100);
      } else if (row.key === PROMO_REQUEST_MAX_USES_KEY) {
        caps.maxUses = n;
      }
    }
  } catch {
    return caps;
  }
  return caps;
}

export type PromoRequestValidation =
  | { ok: true; code: string | null; discountPct: number; maxUsesTotal: number | null; expiresAt: string | null; targetType: 'center' | 'teacher' | 'all' }
  | { ok: false; error: string };

/**
 * Validate a manager's promo-code request body against format rules and the caps.
 * `code` is optional (the CEO may fill it in at approval time); when present it must
 * match the same shape the real promo_codes create route enforces.
 */
export function validatePromoRequestInput(
  body: {
    code?: unknown;
    discountPct?: unknown;
    maxUsesTotal?: unknown;
    expiresAt?: unknown;
    targetType?: unknown;
  },
  caps: PromoRequestCaps,
): PromoRequestValidation {
  // code (optional)
  let code: string | null = null;
  if (body.code !== undefined && body.code !== null && body.code !== '') {
    if (typeof body.code !== 'string') {
      return { ok: false, error: 'code must be a string' };
    }
    const raw = body.code.trim().toUpperCase();
    if (raw && !/^[A-Z0-9_-]{2,32}$/.test(raw)) {
      return { ok: false, error: 'code must be 2-32 uppercase alphanumeric characters (A-Z, 0-9, _, -)' };
    }
    code = raw || null;
  }

  // discountPct (required)
  const discountPct = typeof body.discountPct === 'number' ? body.discountPct : Number(body.discountPct);
  if (!Number.isFinite(discountPct) || discountPct < 1 || discountPct > 100) {
    return { ok: false, error: 'discountPct must be an integer between 1 and 100' };
  }
  const roundedDiscount = Math.round(discountPct);
  if (roundedDiscount > caps.maxDiscountPct) {
    return { ok: false, error: `discountPct exceeds the allowed maximum of ${caps.maxDiscountPct}%` };
  }

  // maxUsesTotal (optional; null = unlimited, but unlimited is above the cap so it is rejected)
  let maxUsesTotal: number | null = null;
  if (body.maxUsesTotal !== undefined && body.maxUsesTotal !== null && body.maxUsesTotal !== '') {
    const n = Number(body.maxUsesTotal);
    if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
      return { ok: false, error: 'maxUsesTotal must be a positive integer' };
    }
    if (n > caps.maxUses) {
      return { ok: false, error: `maxUsesTotal exceeds the allowed maximum of ${caps.maxUses}` };
    }
    maxUsesTotal = n;
  } else {
    // Managers may not request an unlimited code — that would exceed the uses cap.
    return { ok: false, error: `maxUsesTotal is required and must be at most ${caps.maxUses}` };
  }

  // expiresAt (optional)
  let expiresAt: string | null = null;
  if (typeof body.expiresAt === 'string' && body.expiresAt.trim()) {
    const d = new Date(body.expiresAt.trim());
    if (Number.isNaN(d.getTime())) {
      return { ok: false, error: 'expiresAt must be a valid ISO date string' };
    }
    expiresAt = d.toISOString();
  }

  // targetType (optional, default 'all')
  let targetType: 'center' | 'teacher' | 'all' = 'all';
  if (body.targetType !== undefined && body.targetType !== null && body.targetType !== '') {
    if (body.targetType !== 'center' && body.targetType !== 'teacher' && body.targetType !== 'all') {
      return { ok: false, error: 'targetType must be one of center, teacher, all' };
    }
    targetType = body.targetType;
  }

  return { ok: true, code, discountPct: roundedDiscount, maxUsesTotal, expiresAt, targetType };
}
