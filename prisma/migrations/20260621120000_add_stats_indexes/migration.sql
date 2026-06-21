-- Índices de apoyo para las estadísticas del portal admin (módulo admin-stats).
-- Las consultas agregan por rango de fechas; estos índices evitan escaneos
-- completos de las tablas-ledger que crecen con el uso.

-- Venta por fecha: filtra por estado del pago y paidAt (métricas de ingresos).
CREATE INDEX "analysis_packs_status_id_paid_at_idx" ON "analysis_packs"("status_id", "paid_at");

-- Serie temporal global de consumo: COUNT/date_trunc por created_at.
CREATE INDEX "analysis_consumptions_created_at_idx" ON "analysis_consumptions"("created_at");
