/** Shared admin types used across multiple admin pages. */

export interface CenterRow {
  id: string;
  name: string;
  phone?: string;
  email?: string | null;
  plan?: string;
  status?: string;
  created_at: string;
  students_count?: number;
  owner?: { name?: string; phone?: string } | null;
  last_payment?: string | null;
  next_due?: string | null;
  billing_period?: string;
  billing_status?: string;
  owner_name?: string | null;
  referral_code?: string | null;
  referral_code_used?: string | null;
  referring_center_name?: string | null;
  last_active?: string;
  usage_scans?: number;
  is_blacklisted?: boolean;
  blacklist_reason?: string | null;
  /**
   * `Merged-Admin-Platform` §01 draws each centre row as "Nasr City · 180
   * students". Both columns are real on `centers` (verified in
   * `information_schema.columns`, 4 August 2026) and `/api/admin/centers`
   * already selects `*`, so both arrive without an API change. Both are
   * nullable and currently unset on every live row — the sub-line simply does
   * not render rather than showing a placeholder location.
   */
  district?: string | null;
  city?: string | null;
}
