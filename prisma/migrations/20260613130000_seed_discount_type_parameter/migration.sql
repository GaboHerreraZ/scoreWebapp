-- Seed: tipos de descuento para ConsultationPrice (discountTypeId → Parameter).
-- 'percentage' = el discountValue es un % (ej. 20 = 20%).
-- 'fixed'      = el discountValue es un monto fijo a restar (ej. 5000 = $5.000 menos).
-- Idempotente: ON CONFLICT no duplica si ya existen. created_at/updated_at se
-- setean en SQL porque los @default(now())/@updatedAt de Prisma son del lado del cliente.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('discount_type', 'percentage', 'Porcentaje', 'El valor del descuento es un porcentaje', true, 0, NOW(), NOW()),
  ('discount_type', 'fixed', 'Monto fijo', 'El valor del descuento es un monto fijo en la moneda', true, 1, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;
