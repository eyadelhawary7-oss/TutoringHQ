import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Defense-in-depth gate for card-order mutation routes.
 *
 * Card ordering is opt-in per center (`centers.card_orders_enabled`, default
 * false). The dashboard nav + /orders page already hide the flow, but these
 * routes run on the service-role client (RLS bypassed), so the flag must also
 * be enforced here — UI hiding is not a security boundary (house rule:
 * service-role-reachable routes need a TS gate).
 *
 * Fails CLOSED: a missing row or a read error is treated as disabled.
 *
 * @returns a clean 403 NextResponse when card ordering is disabled, or `null`
 *          to let the request proceed.
 */
export async function cardOrdersDisabledResponse(
  supabaseAdmin: SupabaseClient,
  centerId: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabaseAdmin
    .from('centers')
    .select('card_orders_enabled')
    .eq('id', centerId)
    .maybeSingle();

  const enabled =
    !error &&
    (data as { card_orders_enabled?: boolean | null } | null)?.card_orders_enabled === true;

  if (enabled) return null;

  return NextResponse.json(
    { error: 'Card ordering is disabled for this center', code: 'card_orders_disabled' },
    { status: 403 },
  );
}
