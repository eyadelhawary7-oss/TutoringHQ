-- Registry row for live scan WhatsApp template (Meta name: chq_scan_notification)

INSERT INTO wa_meta_templates (template_name, category, status, variables_count)
VALUES ('chq_scan_notification', 'UTILITY', 'APPROVED', 4)
ON CONFLICT (template_name) DO UPDATE SET
  status = EXCLUDED.status,
  category = EXCLUDED.category,
  variables_count = EXCLUDED.variables_count,
  updated_at = now();
