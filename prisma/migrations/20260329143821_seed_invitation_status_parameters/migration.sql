-- Seed invitation status parameters
INSERT INTO parameters (type, code, label, description, is_active, sort_order, created_at, updated_at)
VALUES
  ('invitation_status', 'pending', 'Pendiente', 'Invitación pendiente de respuesta', true, 1, NOW(), NOW()),
  ('invitation_status', 'accepted', 'Aceptada', 'Invitación aceptada por el usuario', true, 2, NOW(), NOW()),
  ('invitation_status', 'rejected', 'Rechazada', 'Invitación rechazada por el usuario', true, 3, NOW(), NOW())
ON CONFLICT (type, code) DO NOTHING;
