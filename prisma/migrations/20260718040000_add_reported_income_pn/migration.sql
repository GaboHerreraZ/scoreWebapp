-- Endeudamiento reportado (solo PN) en el snapshot de riesgo: ingreso mensual y
-- % del ingreso ya comprometido en cuotas. Es el único dato financiero que la
-- central tiene de una persona natural (la PJ reporta EEFF; la PN no), y se usa
-- como REFERENCIA de capacidad de pago (alerta) al contrastar contra el PDF.
-- null en PJ.

ALTER TABLE "customer_risk_snapshots"
  ADD COLUMN "reported_income" DOUBLE PRECISION,
  ADD COLUMN "quota_to_income_pct" DOUBLE PRECISION;
