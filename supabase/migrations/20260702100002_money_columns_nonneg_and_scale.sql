-- ============================================================================
-- H2 + M6 — Money columns: CHECK (col >= 0) + numeric(12,2)
-- ----------------------------------------------------------------------------
-- Live-data audit (2026-07-02): every candidate column has zero negative
-- values, zero sub-cent (scale > 2) values, and max magnitude 21,299 — so both
-- the CHECKs and the type changes validate cleanly with no rounding of stored
-- data. Tables are all tiny (< 100 rows), so the rewrite locks are trivial.
--
-- Excluded from CHECK (legitimately signed, per code audit):
--   * credit_ledger.amount                (expire-credits inserts amount = -prev)
--   * commission_payouts.adjustment_amount (admin adjustment, may be negative)
--   * commission_payouts.total_amount      (absorbs signed adjustment/carryover)
--   * upgrade_log.daily_rate_difference    (billingEngine.ts:119 new-old, signed)
-- Excluded from CHECK (already guarded by a conditional business CHECK):
--   * centers.billing_amount, centers.pack_custom_invoice_minimum
-- Excluded from type change:
--   * transactions.* money family — already CHECK-guarded >= 0; it also carries
--     a strict sum-equality CHECK (lesson_fee + customer_commission_amt +
--     processing_fee_amt = amount_billed). Re-typing to numeric(12,2) would
--     round each component independently on INSERT and could make the equality
--     fail for future sub-cent writes. Needs a code-level rounding audit first;
--     parked for the follow-up database brief.
--   * student_credits.amount — CHECK (> 0) already; pinned by ar_by_student view.
--   * chargebacks.amount, teacher_subscriptions.price_* — CHECK >= 0 already;
--     left bare pending the same rounding audit as transactions.
--   * centers.early_adopter_price — already numeric(10,2).
-- Rate/percentage columns (late_fee_rate, commission_rate, reward_percentage,
-- teacher_split_pct, snap_customer_pct, snap_teacher_pct) are not money amounts
-- and keep bare numeric so sub-percent precision is preserved.
-- ============================================================================

-- --- admin_payments ---------------------------------------------------------
ALTER TABLE public.admin_payments ALTER COLUMN amount TYPE numeric(12,2);
ALTER TABLE public.admin_payments ADD CONSTRAINT admin_payments_amount_nonneg CHECK (amount >= 0);

-- --- announcement_blasts ----------------------------------------------------
ALTER TABLE public.announcement_blasts ALTER COLUMN base_amount TYPE numeric(12,2);
ALTER TABLE public.announcement_blasts ALTER COLUMN service_fee TYPE numeric(12,2);
ALTER TABLE public.announcement_blasts ALTER COLUMN total_amount TYPE numeric(12,2);
ALTER TABLE public.announcement_blasts ALTER COLUMN vat TYPE numeric(12,2);
ALTER TABLE public.announcement_blasts ADD CONSTRAINT announcement_blasts_money_nonneg
  CHECK (base_amount >= 0 AND service_fee >= 0 AND total_amount >= 0 AND vat >= 0);

-- --- billing_reconciliation_reports ----------------------------------------
ALTER TABLE public.billing_reconciliation_reports ALTER COLUMN expected_amount TYPE numeric(12,2);
ALTER TABLE public.billing_reconciliation_reports ALTER COLUMN paymob_amount TYPE numeric(12,2);
ALTER TABLE public.billing_reconciliation_reports ADD CONSTRAINT billing_reconciliation_reports_money_nonneg
  CHECK ((expected_amount IS NULL OR expected_amount >= 0) AND (paymob_amount IS NULL OR paymob_amount >= 0));

-- --- card_orders ------------------------------------------------------------
ALTER TABLE public.card_orders ALTER COLUMN delivery_fee TYPE numeric(12,2);
ALTER TABLE public.card_orders ALTER COLUMN price_per_card TYPE numeric(12,2);
ALTER TABLE public.card_orders ALTER COLUMN total_amount TYPE numeric(12,2);
ALTER TABLE public.card_orders ADD CONSTRAINT card_orders_money_nonneg
  CHECK ((delivery_fee IS NULL OR delivery_fee >= 0) AND (price_per_card IS NULL OR price_per_card >= 0) AND (total_amount IS NULL OR total_amount >= 0));

-- --- center_expenses --------------------------------------------------------
ALTER TABLE public.center_expenses ALTER COLUMN other TYPE numeric(12,2);
ALTER TABLE public.center_expenses ALTER COLUMN rent TYPE numeric(12,2);
ALTER TABLE public.center_expenses ALTER COLUMN salaries TYPE numeric(12,2);
ALTER TABLE public.center_expenses ALTER COLUMN utilities TYPE numeric(12,2);
ALTER TABLE public.center_expenses ADD CONSTRAINT center_expenses_money_nonneg
  CHECK ((other IS NULL OR other >= 0) AND (rent IS NULL OR rent >= 0) AND (salaries IS NULL OR salaries >= 0) AND (utilities IS NULL OR utilities >= 0));

-- --- centers ----------------------------------------------------------------
ALTER TABLE public.centers ALTER COLUMN all_in_price TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN announcement_balance TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN announcement_cap TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN announcement_price_per_blast TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN billing_amount TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN credit_balance TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN credit_reserved TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN pack_custom_invoice_minimum TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN pack_pending_balance TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN pack_price_per_parent TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN payg_rate TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN reactivation_fee_amount TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN referral_reward_amount TYPE numeric(12,2);
ALTER TABLE public.centers ALTER COLUMN subscription_monthly_fee TYPE numeric(12,2);
ALTER TABLE public.centers ADD CONSTRAINT centers_money_nonneg
  CHECK ((all_in_price IS NULL OR all_in_price >= 0)
     AND (announcement_balance IS NULL OR announcement_balance >= 0)
     AND (announcement_cap IS NULL OR announcement_cap >= 0)
     AND (announcement_price_per_blast IS NULL OR announcement_price_per_blast >= 0)
     AND credit_balance >= 0
     AND credit_reserved >= 0
     AND (early_adopter_price IS NULL OR early_adopter_price >= 0)
     AND pack_pending_balance >= 0
     AND (pack_price_per_parent IS NULL OR pack_price_per_parent >= 0)
     AND (payg_rate IS NULL OR payg_rate >= 0)
     AND (reactivation_fee_amount IS NULL OR reactivation_fee_amount >= 0)
     AND (referral_reward_amount IS NULL OR referral_reward_amount >= 0)
     AND (subscription_monthly_fee IS NULL OR subscription_monthly_fee >= 0));

-- --- ceo_action_queue -------------------------------------------------------
ALTER TABLE public.ceo_action_queue ALTER COLUMN revenue_at_risk TYPE numeric(12,2);
ALTER TABLE public.ceo_action_queue ADD CONSTRAINT ceo_action_queue_revenue_at_risk_nonneg
  CHECK (revenue_at_risk IS NULL OR revenue_at_risk >= 0);

-- --- combined_payment_sessions ----------------------------------------------
ALTER TABLE public.combined_payment_sessions ALTER COLUMN credit_amount TYPE numeric(12,2);
ALTER TABLE public.combined_payment_sessions ALTER COLUMN paymob_amount TYPE numeric(12,2);
ALTER TABLE public.combined_payment_sessions ALTER COLUMN total_amount TYPE numeric(12,2);
ALTER TABLE public.combined_payment_sessions ADD CONSTRAINT combined_payment_sessions_money_nonneg
  CHECK (credit_amount >= 0 AND paymob_amount >= 0 AND total_amount >= 0);

-- --- commission_payouts (adjustment_amount + total_amount stay signed) ------
ALTER TABLE public.commission_payouts ALTER COLUMN adjustment_amount TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ALTER COLUMN base_salary TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ALTER COLUMN loyalty_bonuses TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ALTER COLUMN override_commissions TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ALTER COLUMN t1_commissions TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ALTER COLUMN t2_commissions TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ALTER COLUMN total_amount TYPE numeric(12,2);
ALTER TABLE public.commission_payouts ADD CONSTRAINT commission_payouts_money_nonneg
  CHECK (base_salary >= 0 AND loyalty_bonuses >= 0 AND override_commissions >= 0
     AND t1_commissions >= 0 AND t2_commissions >= 0);

-- --- commissions -------------------------------------------------------------
ALTER TABLE public.commissions ALTER COLUMN loyalty_bonus_amount TYPE numeric(12,2);
ALTER TABLE public.commissions ALTER COLUMN t1_amount TYPE numeric(12,2);
ALTER TABLE public.commissions ALTER COLUMN t2_amount TYPE numeric(12,2);
ALTER TABLE public.commissions ALTER COLUMN total_commission TYPE numeric(12,2);
ALTER TABLE public.commissions ADD CONSTRAINT commissions_money_nonneg
  CHECK (loyalty_bonus_amount >= 0 AND t1_amount >= 0 AND t2_amount >= 0 AND total_commission >= 0);

-- --- credit_ledger (signed ledger by design — type only, no CHECK) ----------
ALTER TABLE public.credit_ledger ALTER COLUMN amount TYPE numeric(12,2);

-- --- delivery_fees ------------------------------------------------------------
ALTER TABLE public.delivery_fees ALTER COLUMN fee TYPE numeric(12,2);
ALTER TABLE public.delivery_fees ADD CONSTRAINT delivery_fees_fee_nonneg CHECK (fee >= 0);

-- --- groups -------------------------------------------------------------------
ALTER TABLE public.groups ALTER COLUMN monthly_fee TYPE numeric(12,2);
ALTER TABLE public.groups ADD CONSTRAINT groups_monthly_fee_nonneg
  CHECK (monthly_fee IS NULL OR monthly_fee >= 0);

-- --- invoices -----------------------------------------------------------------
ALTER TABLE public.invoices ALTER COLUMN amount_received TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN base_amount TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN discount_amount TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN group_overage TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN individual_overage TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN late_fee_amount TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN payment_amount TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN promo_original_amount TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN total_amount TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN whatsapp_group TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN whatsapp_individual TYPE numeric(12,2);
ALTER TABLE public.invoices ALTER COLUMN whatsapp_parent_checkup TYPE numeric(12,2);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_money_nonneg
  CHECK (amount_received >= 0
     AND (base_amount IS NULL OR base_amount >= 0)
     AND (discount_amount IS NULL OR discount_amount >= 0)
     AND (group_overage IS NULL OR group_overage >= 0)
     AND (individual_overage IS NULL OR individual_overage >= 0)
     AND (late_fee_amount IS NULL OR late_fee_amount >= 0)
     AND (payment_amount IS NULL OR payment_amount >= 0)
     AND (promo_original_amount IS NULL OR promo_original_amount >= 0)
     AND total_amount >= 0
     AND (whatsapp_group IS NULL OR whatsapp_group >= 0)
     AND (whatsapp_individual IS NULL OR whatsapp_individual >= 0)
     AND (whatsapp_parent_checkup IS NULL OR whatsapp_parent_checkup >= 0));

-- --- mrr_snapshots ------------------------------------------------------------
ALTER TABLE public.mrr_snapshots ALTER COLUMN total_mrr TYPE numeric(12,2);
ALTER TABLE public.mrr_snapshots ADD CONSTRAINT mrr_snapshots_total_mrr_nonneg CHECK (total_mrr >= 0);

-- --- parent_pack_billing -------------------------------------------------------
ALTER TABLE public.parent_pack_billing ALTER COLUMN amount TYPE numeric(12,2);
ALTER TABLE public.parent_pack_billing ALTER COLUMN base_amount TYPE numeric(12,2);
ALTER TABLE public.parent_pack_billing ALTER COLUMN service_fee TYPE numeric(12,2);
ALTER TABLE public.parent_pack_billing ALTER COLUMN total_amount TYPE numeric(12,2);
ALTER TABLE public.parent_pack_billing ALTER COLUMN vat TYPE numeric(12,2);
ALTER TABLE public.parent_pack_billing ADD CONSTRAINT parent_pack_billing_money_nonneg
  CHECK (amount >= 0 AND base_amount >= 0
     AND (service_fee IS NULL OR service_fee >= 0)
     AND (total_amount IS NULL OR total_amount >= 0)
     AND (vat IS NULL OR vat >= 0));

-- --- payg_rates ----------------------------------------------------------------
ALTER TABLE public.payg_rates ALTER COLUMN price_per_student TYPE numeric(12,2);
ALTER TABLE public.payg_rates ADD CONSTRAINT payg_rates_price_per_student_nonneg CHECK (price_per_student >= 0);

-- --- payments ------------------------------------------------------------------
ALTER TABLE public.payments ALTER COLUMN amount TYPE numeric(12,2);
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0);

-- --- payout_requests -------------------------------------------------------------
ALTER TABLE public.payout_requests ALTER COLUMN amount_requested TYPE numeric(12,2);
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_amount_requested_nonneg CHECK (amount_requested >= 0);

-- --- pricing_plans ---------------------------------------------------------------
ALTER TABLE public.pricing_plans ALTER COLUMN all_in_price TYPE numeric(12,2);
ALTER TABLE public.pricing_plans ALTER COLUMN cost_per_student TYPE numeric(12,2);
ALTER TABLE public.pricing_plans ALTER COLUMN monthly_fee TYPE numeric(12,2);
ALTER TABLE public.pricing_plans ALTER COLUMN payg_rate_per_student TYPE numeric(12,2);
ALTER TABLE public.pricing_plans ALTER COLUMN setup_fee TYPE numeric(12,2);
ALTER TABLE public.pricing_plans ADD CONSTRAINT pricing_plans_money_nonneg
  CHECK ((all_in_price IS NULL OR all_in_price >= 0) AND cost_per_student >= 0 AND monthly_fee >= 0
     AND (payg_rate_per_student IS NULL OR payg_rate_per_student >= 0) AND setup_fee >= 0);

-- --- referral_commissions (commission_rate is a rate — untouched) -----------------
ALTER TABLE public.referral_commissions ALTER COLUMN commission_amount TYPE numeric(12,2);
ALTER TABLE public.referral_commissions ALTER COLUMN referred_plan_fee TYPE numeric(12,2);
ALTER TABLE public.referral_commissions ADD CONSTRAINT referral_commissions_money_nonneg
  CHECK (commission_amount >= 0 AND referred_plan_fee >= 0);

-- --- referral_reward_records (reward_percentage is a rate — untouched) ------------
ALTER TABLE public.referral_reward_records ALTER COLUMN base_amount TYPE numeric(12,2);
ALTER TABLE public.referral_reward_records ALTER COLUMN reward_amount TYPE numeric(12,2);
ALTER TABLE public.referral_reward_records ADD CONSTRAINT referral_reward_records_money_nonneg
  CHECK (base_amount >= 0 AND reward_amount >= 0);

-- --- referral_rewards ---------------------------------------------------------------
ALTER TABLE public.referral_rewards ALTER COLUMN first_month_fee TYPE numeric(12,2);
ALTER TABLE public.referral_rewards ALTER COLUMN reward_amount TYPE numeric(12,2);
ALTER TABLE public.referral_rewards ADD CONSTRAINT referral_rewards_money_nonneg
  CHECK (first_month_fee >= 0 AND reward_amount >= 0);

-- --- renewal_history -----------------------------------------------------------------
ALTER TABLE public.renewal_history ALTER COLUMN amount_paid TYPE numeric(12,2);
ALTER TABLE public.renewal_history ADD CONSTRAINT renewal_history_amount_paid_nonneg CHECK (amount_paid >= 0);

-- --- staff ----------------------------------------------------------------------------
ALTER TABLE public.staff ALTER COLUMN base_salary TYPE numeric(12,2);
ALTER TABLE public.staff ADD CONSTRAINT staff_base_salary_nonneg CHECK (base_salary >= 0);

-- --- students ----------------------------------------------------------------------------
ALTER TABLE public.students ALTER COLUMN fee TYPE numeric(12,2);
ALTER TABLE public.students ALTER COLUMN balance_alert_threshold TYPE numeric(12,2);
ALTER TABLE public.students ADD CONSTRAINT students_money_nonneg
  CHECK ((fee IS NULL OR fee >= 0) AND (balance_alert_threshold IS NULL OR balance_alert_threshold >= 0));

-- --- student_groups (fee_per_class / center_cut_egp already guarded) --------------------
ALTER TABLE public.student_groups ALTER COLUMN fee TYPE numeric(12,2);
ALTER TABLE public.student_groups ADD CONSTRAINT student_groups_fee_nonneg
  CHECK (fee IS NULL OR fee >= 0);

-- --- subjects ----------------------------------------------------------------------------
ALTER TABLE public.subjects ALTER COLUMN monthly_fee TYPE numeric(12,2);
ALTER TABLE public.subjects ADD CONSTRAINT subjects_monthly_fee_nonneg
  CHECK (monthly_fee IS NULL OR monthly_fee >= 0);

-- --- transactions (family stays bare numeric — see header; flat fee gets the CHECK) -----
ALTER TABLE public.transactions ADD CONSTRAINT transactions_snap_processing_flat_nonneg
  CHECK (snap_processing_flat >= 0);

-- --- upgrade_log (daily_rate_difference stays signed) ------------------------------------
ALTER TABLE public.upgrade_log ALTER COLUMN amount_charged TYPE numeric(12,2);
ALTER TABLE public.upgrade_log ALTER COLUMN daily_rate_difference TYPE numeric(12,2);
ALTER TABLE public.upgrade_log ADD CONSTRAINT upgrade_log_amount_charged_nonneg CHECK (amount_charged >= 0);

-- --- wa_inactivity_alerts -----------------------------------------------------------------
ALTER TABLE public.wa_inactivity_alerts ALTER COLUMN monthly_fee TYPE numeric(12,2);
ALTER TABLE public.wa_inactivity_alerts ADD CONSTRAINT wa_inactivity_alerts_monthly_fee_nonneg
  CHECK (monthly_fee IS NULL OR monthly_fee >= 0);

-- --- wa_messages ---------------------------------------------------------------------------
ALTER TABLE public.wa_messages ALTER COLUMN cost TYPE numeric(12,2);
ALTER TABLE public.wa_messages ADD CONSTRAINT wa_messages_cost_nonneg CHECK (cost >= 0);

-- --- whatsapp_subscriptions -----------------------------------------------------------------
ALTER TABLE public.whatsapp_subscriptions ALTER COLUMN group_monthly_charge TYPE numeric(12,2);
ALTER TABLE public.whatsapp_subscriptions ALTER COLUMN group_overage_charge TYPE numeric(12,2);
ALTER TABLE public.whatsapp_subscriptions ALTER COLUMN individual_monthly_charge TYPE numeric(12,2);
ALTER TABLE public.whatsapp_subscriptions ALTER COLUMN individual_overage_charge TYPE numeric(12,2);
ALTER TABLE public.whatsapp_subscriptions ALTER COLUMN parent_monthly_charge TYPE numeric(12,2);
ALTER TABLE public.whatsapp_subscriptions ADD CONSTRAINT whatsapp_subscriptions_money_nonneg
  CHECK ((group_monthly_charge IS NULL OR group_monthly_charge >= 0)
     AND (group_overage_charge IS NULL OR group_overage_charge >= 0)
     AND (individual_monthly_charge IS NULL OR individual_monthly_charge >= 0)
     AND (individual_overage_charge IS NULL OR individual_overage_charge >= 0)
     AND (parent_monthly_charge IS NULL OR parent_monthly_charge >= 0));

-- --- whatsapp_usage ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_usage ALTER COLUMN meta_cost TYPE numeric(12,2);
ALTER TABLE public.whatsapp_usage ALTER COLUMN overage_charge TYPE numeric(12,2);
ALTER TABLE public.whatsapp_usage ADD CONSTRAINT whatsapp_usage_money_nonneg
  CHECK ((meta_cost IS NULL OR meta_cost >= 0) AND (overage_charge IS NULL OR overage_charge >= 0));

-- --- withdrawal_requests ------------------------------------------------------------------------
ALTER TABLE public.withdrawal_requests ALTER COLUMN cash_amount TYPE numeric(12,2);
ALTER TABLE public.withdrawal_requests ALTER COLUMN credits_deducted TYPE numeric(12,2);
ALTER TABLE public.withdrawal_requests ALTER COLUMN fee_amount TYPE numeric(12,2);
ALTER TABLE public.withdrawal_requests ADD CONSTRAINT withdrawal_requests_money_nonneg
  CHECK (cash_amount >= 0 AND credits_deducted >= 0 AND fee_amount >= 0);

NOTIFY pgrst, 'reload schema';
