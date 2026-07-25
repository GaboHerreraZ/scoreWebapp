-- Sugerencias de verificación de la central (vectorSugerencias de MiDecisor):
-- checklist de documentación que Experian recomienda pedirle al cliente según su
-- perfil (empleado/independiente). Se archiva por snapshot, como los demás
-- bloques JSONB de la consulta. Forma: [{ "title": string|null, "items": string[] }]
ALTER TABLE "customer_risk_snapshots" ADD COLUMN "suggestions" JSONB;
