-- Reset subscriptions table
-- Destructive: deletes all rows. Only run on environments where this is acceptable.
-- Depends on: 01_reset_parameters.sql (dashboard_level and support_level codes)

DELETE FROM "subscriptions";

INSERT INTO "subscriptions" (
  "id", "name", "max_users", "max_companies", "excel_reports", "is_active",
  "created_at", "updated_at", "description", "email_notifications",
  "max_customers", "max_studies_per_month", "theme_customization",
  "price", "is_monthly", "dashboard_level_id", "support_level_id",
  "max_ai_analysis_per_month", "max_pdf_extractions_per_month"
) VALUES
  (
    '3f7b1c2e-6d9a-4f41-9c52-2e8c5a7b9d13', 'Pro', 5, 1, true, true,
    '2026-02-19 13:54:51', '2026-02-19 13:54:54', NULL, true,
    100, 250, true,
    250000, false,
    (SELECT id FROM "parameters" WHERE type = 'dashboard_level' AND code = 'advanced'),
    (SELECT id FROM "parameters" WHERE type = 'support_level'   AND code = 'priorityEmail'),
    50, 50
  ),
  (
    '9c2a6f4d-3b7e-48a1-b5f2-6d1e9c0a7f34', 'Free', 1, 1, false, true,
    '2026-02-19 15:32:25', '2026-02-19 15:32:29', NULL, false,
    1, 3, true,
    0, false,
    (SELECT id FROM "parameters" WHERE type = 'dashboard_level' AND code = 'basic'),
    (SELECT id FROM "parameters" WHERE type = 'support_level'   AND code = 'email'),
    NULL, NULL
  );
