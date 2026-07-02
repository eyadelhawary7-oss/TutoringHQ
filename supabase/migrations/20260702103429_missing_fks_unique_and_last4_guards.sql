-- ============================================================================
-- M7 + M3 + L3 — Missing FKs on invoice/payout links, upgrade_log uniqueness,
--                card_last4 format guard
-- ----------------------------------------------------------------------------
-- Live-data audit (2026-07-02): zero orphan rows on every link below, zero
-- duplicate (center_id, paymob_order_id) pairs in upgrade_log, zero
-- recurring_charge_declines rows — everything validates cleanly.
-- Polymorphic owner_type/owner_id columns stay FK-less by design.
-- ============================================================================

-- M7 — invoice links
ALTER TABLE public.billing_reconciliation_reports
  ADD CONSTRAINT billing_reconciliation_reports_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;

ALTER TABLE public.recurring_charge_declines
  ADD CONSTRAINT recurring_charge_declines_invoice_id_fkey
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;

ALTER TABLE public.centers
  ADD CONSTRAINT centers_summer_first_invoice_id_fkey
  FOREIGN KEY (summer_first_invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;

ALTER TABLE public.teacher_subscriptions
  ADD CONSTRAINT teacher_subscriptions_summer_first_invoice_id_fkey
  FOREIGN KEY (summer_first_invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;

-- M7 — payout links
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_loyalty_payout_id_fkey
  FOREIGN KEY (loyalty_payout_id) REFERENCES commission_payouts(id) ON DELETE RESTRICT;

ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_t1_payout_id_fkey
  FOREIGN KEY (t1_payout_id) REFERENCES commission_payouts(id) ON DELETE RESTRICT;

ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_t2_payout_id_fkey
  FOREIGN KEY (t2_payout_id) REFERENCES commission_payouts(id) ON DELETE RESTRICT;

-- M7 — teacher note author (teacher feature: same target as invoices.teacher_id)
ALTER TABLE public.student_group_notes
  ADD CONSTRAINT student_group_notes_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT;

-- M3 — one upgrade audit row per (center, Paymob order); NULL paymob_order_id
-- rows (non-Paymob upgrades) are unaffected (NULLS DISTINCT semantics).
ALTER TABLE public.upgrade_log
  ADD CONSTRAINT upgrade_log_center_id_paymob_order_id_key
  UNIQUE (center_id, paymob_order_id);

-- L3 — match saved_cards.card_last4 format guard
ALTER TABLE public.recurring_charge_declines
  ADD CONSTRAINT recurring_charge_declines_card_last4_format
  CHECK (card_last4 ~ '^[0-9]{4}$');

NOTIFY pgrst, 'reload schema';
