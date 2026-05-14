// /api/promo/validate
//
// POST  : validate a promo code for a given plan + billing interval.
// Public — no auth required. Rate-limited: 10 requests / 5 min per IP.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getClientIp, rateLimit, rateLimitExceededResponse } from '@/lib/ratelimit';
import { parseBodyWithLimit } from '@/lib/validate';
import { validatePromoCodeServerSide } from '@/lib/promoCode';

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const { success } = await rateLimit(`promo_validate:${ip}`, 10, 300);
  if (!success) return rateLimitExceededResponse(300);

  let body: {
    code?: unknown;
    planKey?: unknown;
    billingInterval?: unknown;
    userId?: unknown;
  };
  try {
    body = (await parseBodyWithLimit(request, 4096)) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  const planKey = typeof body.planKey === 'string' ? body.planKey.trim() : '';
  const billingInterval =
    typeof body.billingInterval === 'string' ? body.billingInterval.trim() : '';
  const userId = typeof body.userId === 'string' ? body.userId.trim() : null;

  if (!code || !planKey || !billingInterval) {
    return NextResponse.json(
      { error: 'code, planKey, and billingInterval are required' },
      { status: 400 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const result = await validatePromoCodeServerSide(supabase, {
    code,
    planKey,
    billingInterval,
    userId,
  });

  if (!result.valid) {
    return NextResponse.json({ valid: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    valid: true,
    code: result.code,
    discountPct: result.discountPct,
    originalAmountEgp: result.originalAmountEgp,
    discountedAmountEgp: result.discountedAmountEgp,
    savingsEgp: result.savingsEgp,
    appliesTo: result.appliesTo,
  });
}
