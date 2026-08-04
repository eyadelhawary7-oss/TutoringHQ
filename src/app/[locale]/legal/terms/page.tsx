import { getProcessingFeeConfig } from '@/lib/pricingConfig';
import { resolveProcessingFeeAmount } from '@/lib/processingFee';
import LegalDoc from '../LegalDoc';

export const metadata = { title: 'Terms and Conditions - TutoringHQ' };

/**
 * F1 — the processing-fee disclosure the retired `/[locale]/terms` route used to
 * render lives here now, inside the design's single Terms document. Same source
 * (`getProcessingFeeConfig` → `resolveProcessingFeeAmount`) and the same
 * `amount > 0` gate, so turning the fee off still removes the paragraph exactly
 * as it removes the line from checkout and invoices.
 */
export default async function LegalTermsPage() {
  const feeAmount = resolveProcessingFeeAmount(await getProcessingFeeConfig());
  return <LegalDoc slug="terms" processingFeeAmount={feeAmount} />;
}
