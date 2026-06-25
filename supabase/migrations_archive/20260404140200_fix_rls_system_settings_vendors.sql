CREATE POLICY "service_role_all_system_settings"
  ON system_settings FOR ALL TO service_role USING (true);

CREATE POLICY "service_role_all_vendors"
  ON vendors FOR ALL TO service_role USING (true);

CREATE POLICY "authenticated_read_vendors"
  ON vendors FOR SELECT TO authenticated USING (true);
