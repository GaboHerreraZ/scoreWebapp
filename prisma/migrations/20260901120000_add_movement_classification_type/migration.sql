-- Clasificación consolidada de movimientos (estudio de capacidad de pago):
-- una corrida IA por perform que recibe TODOS los meses y decide la categoría
-- definitiva de cada movimiento. Solo agrega el tipo al ledger de AiAnalysis.
INSERT INTO "parameters" ("type","code","label","description","is_active","sort_order","created_at","updated_at") VALUES
  ('ai_analysis_type','movementClassification','Clasificación consolidada de movimientos','Corrida IA que clasifica todos los movimientos de la ventana con un solo criterio',true,0,NOW(),NOW())
ON CONFLICT ("type","code") DO NOTHING;
