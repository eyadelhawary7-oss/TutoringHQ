import type { ReactNode } from 'react';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { CheckoutShell } from './CheckoutShell';

export default async function CheckoutLayout({ children }: { children: ReactNode }) {
  const rates = supabaseAdmin ? await loadBostaShippingRates() : null;
  return <CheckoutShell shippingRates={rates}>{children}</CheckoutShell>;
}
