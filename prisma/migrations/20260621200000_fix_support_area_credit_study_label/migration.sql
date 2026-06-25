-- Corrige el label del área de soporte 'credit_study' a "Análisis de crédito".
-- El seed original lo creó como "Estudios de crédito" y el ON CONFLICT DO NOTHING
-- de la migración anterior no actualiza filas existentes, por eso se hace aquí.
UPDATE "parameters"
SET "label" = 'Análisis de crédito', "updated_at" = NOW()
WHERE "type" = 'support_area' AND "code" = 'credit_study';
