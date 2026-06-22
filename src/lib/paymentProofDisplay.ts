/** Display split for invoice payment references vs manual grant refs (F-806). */

export type PaymentProofTypeKey = 'paymob' | 'manual' | 'record' | 'none';

export function derivePaymentProofColumns(row: {
  payment_reference?: string | null;
  source?: string;
}): { proofType: PaymentProofTypeKey; proofReference: string } {
  const ref = row.payment_reference != null ? String(row.payment_reference).trim() : '';
  const primary = ref;
  if (!primary) return { proofType: 'none', proofReference: ',' };
  if (primary.toLowerCase().startsWith('manual:')) {
    return {
      proofType: 'manual',
      proofReference: primary.replace(/^manual:/i, '').trim() || ',',
    };
  }
  if (/^https?:\/\//i.test(primary)) {
    return { proofType: 'paymob', proofReference: primary };
  }
  return {
    proofType: 'record',
    proofReference: primary.length > 160 ? `${primary.slice(0, 157)}…` : primary,
  };
}
