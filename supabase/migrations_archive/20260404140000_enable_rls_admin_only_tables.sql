-- RLS on admin-only / platform tables; service_role full access; centers read own rows where applicable.
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE combined_payment_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE upgrade_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrr_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_incoming ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_credit_ledger"
  ON credit_ledger FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_combined_sessions"
  ON combined_payment_sessions FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_withdrawal_requests"
  ON withdrawal_requests FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_upgrade_log"
  ON upgrade_log FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_mrr_snapshots"
  ON mrr_snapshots FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_admin_payments"
  ON admin_payments FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_whatsapp_messages"
  ON whatsapp_messages FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_whatsapp_incoming"
  ON whatsapp_incoming FOR ALL TO service_role USING (true);

CREATE POLICY "center_read_own_credit_ledger"
  ON credit_ledger FOR SELECT TO authenticated
  USING (
    center_id = (
      SELECT center_id FROM users
      WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "center_read_own_payment_sessions"
  ON combined_payment_sessions FOR SELECT TO authenticated
  USING (
    center_id = (
      SELECT center_id FROM users
      WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "center_read_own_withdrawals"
  ON withdrawal_requests FOR SELECT TO authenticated
  USING (
    center_id = (
      SELECT center_id FROM users
      WHERE id = auth.uid() LIMIT 1
    )
  );
