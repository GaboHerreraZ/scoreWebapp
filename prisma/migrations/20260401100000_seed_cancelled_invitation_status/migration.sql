-- Seed cancelled invitation status parameter
INSERT INTO parameters (type, code, label, description, is_active, sort_order, created_at, updated_at)
VALUES
  ('invitation_status', 'canceled', 'Cancelada', 'Invitación cancelada por el administrador', true, 4, NOW(), NOW())
ON CONFLICT (type, code) DO NOTHING;
