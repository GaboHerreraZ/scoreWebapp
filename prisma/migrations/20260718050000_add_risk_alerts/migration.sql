-- Detalle de las alertas de la central en el snapshot de riesgo (el "cuáles"
-- detrás del booleano has_alertas). PN: lista de textos de informacionRiesgo.alertas.
-- PJ: nodos de la malla de vínculos con cantidadAlertas > 0 (propia empresa o
-- vínculos). null si no hay alertas. hasAlertas se deriva de este arreglo.

ALTER TABLE "customer_risk_snapshots"
  ADD COLUMN "alerts" JSONB;
