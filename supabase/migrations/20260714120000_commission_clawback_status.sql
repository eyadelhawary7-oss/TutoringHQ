-- Commission money fix: allow 'clawed_back' on the T2 (second-half) and loyalty tiers.
--
-- WHY: a GENUINE payment chargeback (finalizeInvoiceChargeback → clawbackCommissionsForOwner)
-- must reverse ALL THREE tiers — the first half (T1), the second half (T2), AND the loyalty
-- bonus. `t1_status` already permits 'clawed_back', but `t2_status` and `loyalty_bonus_status`
-- did NOT — so the full-tier clawback UPDATE would fail the CHECK constraint and (being
-- swallowed by the non-blocking chargeback handler) reverse nothing. This adds 'clawed_back'
-- as a valid terminal status on those two tiers, alongside the existing 'forfeited'
-- (staff-termination) and 'reassigned' (rep hand-off) terminals.
--
-- REPO-ONLY / HELD — this is a REQUIRES-SIGN-OFF money change and is NOT applied to production
-- from the coding session. It is idempotent (DROP ... IF EXISTS) and safe on the current live
-- DB (0 commission rows). Apply it BEFORE the chargeback-clawback code serves traffic.

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_t2_status_check;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_t2_status_check
  CHECK (t2_status = ANY (ARRAY[
    'locked'::text, 'eligible'::text, 'paid'::text,
    'forfeited'::text, 'reassigned'::text, 'clawed_back'::text
  ]));

ALTER TABLE public.commissions DROP CONSTRAINT IF EXISTS commissions_loyalty_bonus_status_check;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_loyalty_bonus_status_check
  CHECK (loyalty_bonus_status = ANY (ARRAY[
    'locked'::text, 'eligible'::text, 'paid'::text,
    'forfeited'::text, 'reassigned'::text, 'clawed_back'::text
  ]));

NOTIFY pgrst, 'reload schema';
