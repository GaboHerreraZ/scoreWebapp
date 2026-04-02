-- Seed invited role parameter
INSERT INTO parameters (type, code, label, description, is_active, sort_order, created_at, updated_at)
VALUES
  ('user_company_role', 'invitado', 'Invitado', 'Rol asignado por defecto al aceptar una invitación', true, 10, NOW(), NOW())
ON CONFLICT (type, code) DO NOTHING;
