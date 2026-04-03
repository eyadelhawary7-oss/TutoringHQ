ALTER TABLE plan_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_plan_requests"
  ON plan_requests FOR ALL TO service_role USING (true);

CREATE POLICY "center_read_own_plan_requests"
  ON plan_requests FOR SELECT TO authenticated
  USING (
    center_id = (
      SELECT center_id FROM users
      WHERE id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "center_insert_own_plan_requests"
  ON plan_requests FOR INSERT TO authenticated
  WITH CHECK (
    center_id = (
      SELECT center_id FROM users
      WHERE id = auth.uid() LIMIT 1
    )
  );
