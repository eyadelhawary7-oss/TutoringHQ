-- ============================================================================
-- Align referral_commissions with the code that writes/reads it.
-- ----------------------------------------------------------------------------
-- The table (0 rows; referrals are off at launch) was out of sync with both
-- insert paths (api/cron/referral-automation, api/referrals/process-commission)
-- and every reader:
--
--   * referred_center_id did not exist, though both inserts set it and the admin
--     commissions view expects a referred center id  -> add the column, mirroring
--     referrer_center_id (FK to centers(id) + supporting index).
--
--   * period_month was `date NOT NULL`, but all writers pass 'YYYY-MM' text and
--     all readers (generateInvoicePdf, settings/referrals, admin pages) treat it
--     as 'YYYY-MM'. '2026-06'::date errors (22007). The sibling table
--     referral_reward_records.period_month is already text  -> switch to text.
--
-- months_since_activation stays NOT NULL and is now populated by both inserts
-- (it is the commission's month number), so it is intentionally left in place.
-- ============================================================================

ALTER TABLE public.referral_commissions
  ADD COLUMN IF NOT EXISTS referred_center_id uuid;

ALTER TABLE public.referral_commissions
  ALTER COLUMN period_month TYPE text USING to_char(period_month, 'YYYY-MM');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'referral_commissions_referred_center_id_fkey'
      AND conrelid = 'public.referral_commissions'::regclass
  ) THEN
    ALTER TABLE public.referral_commissions
      ADD CONSTRAINT referral_commissions_referred_center_id_fkey
      FOREIGN KEY (referred_center_id) REFERENCES public.centers(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referred
  ON public.referral_commissions (referred_center_id);

notify pgrst, 'reload schema';
