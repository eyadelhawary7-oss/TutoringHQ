import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { parseBostaShippingRatesJson } from '@/lib/bostaShipping';

/** Loads `platform_config.bosta_shipping_rates` for server-side fee calculation. */
export async function loadBostaShippingRates(): Promise<Record<string, number> | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from('platform_config')
    .select('value')
    .eq('key', 'bosta_shipping_rates')
    .maybeSingle();

  if (error) {
    Sentry.captureMessage(`platform_config bosta_shipping_rates read failed: ${error.message}`, {
      level: 'warning',
    });
    return null;
  }

  const raw = (data as { value?: unknown } | null)?.value;
  if (raw === undefined || raw === null) {
    Sentry.captureMessage('platform_config bosta_shipping_rates key missing', { level: 'warning' });
    return null;
  }

  const parsed = parseBostaShippingRatesJson(raw);
  if (!parsed) {
    Sentry.captureMessage('platform_config bosta_shipping_rates invalid JSON', { level: 'warning' });
    return null;
  }

  return parsed;
}
