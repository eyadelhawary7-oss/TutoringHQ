import type { ReactNode } from 'react';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { loadBostaShippingRates } from '@/lib/loadBostaShippingRates';
import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';
import { CheckoutShell } from './CheckoutShell';

export default async function CheckoutLayout({ children }: { children: ReactNode }) {
  const rates = supabaseAdmin ? await loadBostaShippingRates() : null;
  const processingFee = resolveProcessingFeeAmount(await getProcessingFeeConfig());
  return (
    <CheckoutShell shippingRates={rates} processingFee={processingFee}>
      {children}
    </CheckoutShell>
  );
}
