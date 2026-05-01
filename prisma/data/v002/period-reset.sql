-- Reset parameters of type 'period'
-- Removes all existing rows and inserts 12 entries (code/label from 1 to 12)

BEGIN;

DELETE FROM "parameters" WHERE "type" = 'period';

INSERT INTO "parameters" (
  "type", "code", "label", "is_active", "sort_order", "created_at", "updated_at"
) VALUES
  ('period', '1',  '1',  true, 1,  NOW(), NOW()),
  ('period', '2',  '2',  true, 2,  NOW(), NOW()),
  ('period', '3',  '3',  true, 3,  NOW(), NOW()),
  ('period', '4',  '4',  true, 4,  NOW(), NOW()),
  ('period', '5',  '5',  true, 5,  NOW(), NOW()),
  ('period', '6',  '6',  true, 6,  NOW(), NOW()),
  ('period', '7',  '7',  true, 7,  NOW(), NOW()),
  ('period', '8',  '8',  true, 8,  NOW(), NOW()),
  ('period', '9',  '9',  true, 9,  NOW(), NOW()),
  ('period', '10', '10', true, 10, NOW(), NOW()),
  ('period', '11', '11', true, 11, NOW(), NOW()),
  ('period', '12', '12', true, 12, NOW(), NOW());

COMMIT;
