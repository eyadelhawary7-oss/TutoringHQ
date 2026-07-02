-- ============================================================================
-- H3 — Stop delete from wiping money/audit history
-- ----------------------------------------------------------------------------
-- Before: the FKs below were ON DELETE CASCADE, so hard-deleting a center /
--         student / card order / commission silently destroyed financial and
--         audit history.
-- After:  RESTRICT (a hard delete of the parent is refused while history
--         exists), except parent_pack_billing.student_id which becomes
--         SET NULL so the dormant-center purge can still remove student PII
--         while the de-identified billing row is preserved.
--
-- Companion code changes (same commit):
--   * admin "delete center" becomes deactivate (status=suspended, users
--     deactivated, history preserved) — the manual child-table hard-deletes
--     are removed.
--   * card-order checkout rollback and the dormant purge delete
--     card_order_events explicitly before deleting the aborted/purged order.
-- ============================================================================

-- centers ---------------------------------------------------------------------
ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_center_id_fkey;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.commissions DROP CONSTRAINT commissions_center_id_fkey;
ALTER TABLE public.commissions ADD CONSTRAINT commissions_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.invoices DROP CONSTRAINT invoices_center_id_fkey;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.payments DROP CONSTRAINT payments_center_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.credit_ledger DROP CONSTRAINT credit_ledger_center_id_fkey;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.renewal_history DROP CONSTRAINT renewal_history_center_id_fkey;
ALTER TABLE public.renewal_history ADD CONSTRAINT renewal_history_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.upgrade_log DROP CONSTRAINT upgrade_log_center_id_fkey;
ALTER TABLE public.upgrade_log ADD CONSTRAINT upgrade_log_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.combined_payment_sessions DROP CONSTRAINT combined_payment_sessions_center_id_fkey;
ALTER TABLE public.combined_payment_sessions ADD CONSTRAINT combined_payment_sessions_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

ALTER TABLE public.parent_pack_billing DROP CONSTRAINT parent_pack_billing_center_id_fkey;
ALTER TABLE public.parent_pack_billing ADD CONSTRAINT parent_pack_billing_center_id_fkey
  FOREIGN KEY (center_id) REFERENCES centers(id) ON DELETE RESTRICT;

-- students --------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT payments_student_id_fkey;
ALTER TABLE public.payments ADD CONSTRAINT payments_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;

-- The dormant-center purge deletes students while their pack-billing money
-- rows must survive: keep the row, drop the identity link.
ALTER TABLE public.parent_pack_billing ALTER COLUMN student_id DROP NOT NULL;
ALTER TABLE public.parent_pack_billing DROP CONSTRAINT parent_pack_billing_student_id_fkey;
ALTER TABLE public.parent_pack_billing ADD CONSTRAINT parent_pack_billing_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;

-- teacher_profiles --------------------------------------------------------------
ALTER TABLE public.invoices DROP CONSTRAINT invoices_teacher_id_fkey;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_teacher_id_fkey
  FOREIGN KEY (teacher_id) REFERENCES teacher_profiles(user_id) ON DELETE RESTRICT;

-- commissions / payouts -----------------------------------------------------------
ALTER TABLE public.commission_audit_log DROP CONSTRAINT commission_audit_log_commission_id_fkey;
ALTER TABLE public.commission_audit_log ADD CONSTRAINT commission_audit_log_commission_id_fkey
  FOREIGN KEY (commission_id) REFERENCES commissions(id) ON DELETE RESTRICT;

ALTER TABLE public.commission_audit_log DROP CONSTRAINT commission_audit_log_payout_id_fkey;
ALTER TABLE public.commission_audit_log ADD CONSTRAINT commission_audit_log_payout_id_fkey
  FOREIGN KEY (payout_id) REFERENCES commission_payouts(id) ON DELETE RESTRICT;

-- card orders -----------------------------------------------------------------------
ALTER TABLE public.card_order_events DROP CONSTRAINT card_order_events_card_order_id_fkey;
ALTER TABLE public.card_order_events ADD CONSTRAINT card_order_events_card_order_id_fkey
  FOREIGN KEY (card_order_id) REFERENCES card_orders(id) ON DELETE RESTRICT;

-- Voiding a draft payout used to be a row DELETE (admin/payouts/[id] DELETE);
-- with commission_audit_log frozen and the payout FKs RESTRICTed that would
-- always fail, and it destroyed history anyway. Add a terminal 'void' status
-- so a draft is voided in place. The enforce_payout_status_transition trigger
-- already blocks void-from-paid and any change away from paid.
ALTER TABLE public.commission_payouts DROP CONSTRAINT commission_payouts_status_check;
ALTER TABLE public.commission_payouts ADD CONSTRAINT commission_payouts_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'paid'::text, 'void'::text]));

-- Voiding writes its own audit entry: extend the action vocabulary.
ALTER TABLE public.commission_audit_log DROP CONSTRAINT commission_audit_log_action_check;
ALTER TABLE public.commission_audit_log ADD CONSTRAINT commission_audit_log_action_check
  CHECK (action = ANY (ARRAY['t1_eligible_set'::text, 't1_clawback'::text, 't2_auto_unlock'::text, 't2_manual_unlock'::text, 't2_forfeited'::text, 'clock_pause'::text, 'clock_resume'::text, 'dispute_opened'::text, 'dispute_resolved'::text, 'payout_confirmed'::text, 'payout_paid'::text, 'payout_adjusted'::text, 'payout_voided'::text, 'loyalty_eligible_set'::text, 'loyalty_paid'::text, 'commission_created'::text, 'commission_created_eyad'::text]));

NOTIFY pgrst, 'reload schema';
