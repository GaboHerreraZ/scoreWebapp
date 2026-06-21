-- Datos del equipo interno Creditia en platform_admins: nombre, teléfono y rol
-- (admin/support/sales). El rol es un Parameter 'platform_admin_role', DISTINTO
-- de los roles de empresa. Campos nullable: los admins existentes se completan
-- manualmente desde la BD. created_at/updated_at del seed en SQL.

-- Seed de roles del equipo interno.
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  ('platform_admin_role', 'admin', 'Administrador', 'Acceso total al portal administrativo', true, 0, NOW(), NOW()),
  ('platform_admin_role', 'support', 'Soporte', 'Equipo de soporte', true, 1, NOW(), NOW()),
  ('platform_admin_role', 'sales', 'Ventas', 'Equipo comercial', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- Nuevas columnas en platform_admins.
ALTER TABLE "platform_admins" ADD COLUMN "name" VARCHAR(150);
ALTER TABLE "platform_admins" ADD COLUMN "phone" VARCHAR(50);
ALTER TABLE "platform_admins" ADD COLUMN "role_id" INTEGER;

ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "parameters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
