-- Phase 3 Pro tier, migration 004: blast credits on teacher_profiles.
--
-- Introspection (Step 0a) confirmed teacher_profiles has NO pre-existing
-- blast_credits column, so there is nothing to migrate/drop. We add two
-- separate buckets:
--   * blast_credits_purchased     - permanent, survives downgrade, never expires.
--   * blast_credits_subscription  - resets each Pro billing period, zeroed on
--                                   downgrade.
-- Spend order (enforced in deduct_blast_credits RPC): subscription first,
-- then purchased.

ALTER TABLE public.teacher_profiles
  ADD COLUMN IF NOT EXISTS blast_credits_purchased numeric NOT NULL DEFAULT 0
    CHECK (blast_credits_purchased >= 0),
  ADD COLUMN IF NOT EXISTS blast_credits_subscription numeric NOT NULL DEFAULT 0
    CHECK (blast_credits_subscription >= 0);

NOTIFY pgrst, 'reload schema';
