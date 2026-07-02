-- Teacher Scale overage (steady state) — Scale plan ONLY.
--
-- Scale bills its base (up to 100 active students) on the subscription cycle, but
-- the +20 EGP / active-student-above-100 overage is a MONTHLY true-up that runs on
-- its own cadence — even when the base is on an annual cycle. Two additive,
-- summer-safe schema changes:
--
--   1. teacher_subscriptions.overage_next_at — the next monthly overage assessment
--      date, INDEPENDENT of next_billing_at (which advances +12 months for annual).
--      NULL for everyone except active Scale subscribers; set/advanced by the
--      billing engine. Existing rows (and the summer-held path) are untouched.
--
--   2. invoices.invoice_type gains 'teacher_overage' so an overage invoice is its
--      own line (with its own processing fee), distinct from the base 'subscription'.
alter table public.teacher_subscriptions
  add column if not exists overage_next_at timestamptz;

alter table public.invoices drop constraint if exists invoices_invoice_type_check;
alter table public.invoices
  add constraint invoices_invoice_type_check
  check (invoice_type = any (array[
    'base_subscription'::text,
    'subscription'::text,
    'whatsapp_addon'::text,
    'setup_fee'::text,
    'payment_proof'::text,
    'announcement_settlement'::text,
    'announcement_cap'::text,
    'plan_upgrade_difference'::text,
    'pack_billing'::text,
    'signup_first_payment'::text,
    'late_payment_fee'::text,
    'referral_payout'::text,
    'teacher_overage'::text
  ]));

notify pgrst, 'reload schema';
