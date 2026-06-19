// src/lib/digitalStudentFeeCollection.ts
//
// THE SINGLE SWITCH for digital STUDENT-FEE collection.
//
// "Digital student-fee collection" = collecting STUDENT session fees through
// Paymob: the markup, the customer/teacher commission, the 90/10 split, and the
// Paymob payment links sent to parents/students. When the switch is off, that
// whole feature is dormant — hidden from the UI, no active billing writes, no
// errors, no "coming soon" buttons. Flipping it back on restores the full
// feature with no rebuild.
//
// This is DELIBERATELY independent of PAYMOB_ENABLED (src/lib/features.ts).
// PAYMOB_ENABLED gates the teacher's OWN subscription billing (the tier fee
// charged to the teacher's card/wallet) and the card-order checkout — those stay
// fully working. This flag governs ONLY student-fee collection.
//
// Backing store: platform_config key 'digital_student_fee_collection.enabled'
// (see supabase/migrations/20260620120000_digital_student_fee_collection_flag.sql).
// Default is false (dormant). Reads fail closed: any error → false.

import { createClient } from '@supabase/supabase-js';

export const DIGITAL_STUDENT_FEE_COLLECTION_KEY =
  'digital_student_fee_collection.enabled';

/** Read-only service-role client; null when env is missing (fail closed). */
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Whether digital student-fee collection is currently switched on.
 *
 * Always false unless the platform_config flag is explicitly the JSON boolean
 * true. Missing key, missing env, query error, or any non-true value → false,
 * so the feature stays dormant by default and on any failure.
 */
export async function isDigitalStudentFeeCollectionEnabled(): Promise<boolean> {
  const client = svc();
  if (!client) return false;
  try {
    const { data, error } = await client
      .from('platform_config')
      .select('value')
      .eq('key', DIGITAL_STUDENT_FEE_COLLECTION_KEY)
      .maybeSingle();
    if (error) return false;
    return (data as { value: unknown } | null)?.value === true;
  } catch {
    return false;
  }
}
