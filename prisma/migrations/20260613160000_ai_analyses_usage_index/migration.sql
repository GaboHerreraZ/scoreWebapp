-- Índice para el conteo de consumo por ciclo de AiAnalysis
-- (companyId + typeId + createdAt). Antes la tabla no tenía índices y cada
-- count en getUsage / chequeos de límite hacía un sequential scan.
CREATE INDEX IF NOT EXISTS "ai_analyses_company_id_type_id_created_at_idx"
  ON "ai_analyses" ("company_id", "type_id", "created_at");
