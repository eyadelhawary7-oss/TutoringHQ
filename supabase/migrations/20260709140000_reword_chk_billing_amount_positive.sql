-- Reword chk_billing_amount_positive on public.centers to drop the dead
-- billing_type = 'payg' disjunct. PAYG is fully removed and billing_type is now
-- constrained to 'fixed' (centers_billing_type_check), so that clause can never
-- be true. The rest is kept exactly: billing_amount must be > 0 unless status is
-- pending, rejected, or cancelled. Same constraint name.
--
-- Verified against live prod before authoring: 0 existing centers violate the
-- reworded constraint.

alter table public.centers drop constraint if exists chk_billing_amount_positive;

alter table public.centers add constraint chk_billing_amount_positive check (
  (status = any (array['pending'::text, 'rejected'::text, 'cancelled'::text]))
  or (billing_amount > (0)::numeric)
);

notify pgrst, 'reload schema';
