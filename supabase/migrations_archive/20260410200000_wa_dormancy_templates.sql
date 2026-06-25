-- Dormancy / reactivation WhatsApp templates (Meta submission + sync; start PENDING until APPROVED)

INSERT INTO wa_meta_templates (template_name, category, status, variables_count)
VALUES
  ('chq_dormancy_notice', 'UTILITY', 'PENDING', 3),
  ('chq_reactivation_warning_90', 'UTILITY', 'PENDING', 2),
  ('chq_reactivation_warning_30', 'UTILITY', 'PENDING', 2),
  ('chq_data_deletion_notice', 'UTILITY', 'PENDING', 2)
ON CONFLICT (template_name) DO UPDATE SET
  category = EXCLUDED.category,
  variables_count = EXCLUDED.variables_count,
  status = CASE
    WHEN wa_meta_templates.status = 'APPROVED' THEN wa_meta_templates.status
    ELSE EXCLUDED.status
  END,
  updated_at = now();
