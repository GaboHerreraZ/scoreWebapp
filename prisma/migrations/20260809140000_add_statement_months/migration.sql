-- Meses que abarca el ESTADO DE RESULTADOS de cada período (1..12).
--
-- El balance es una foto a balance_sheet_date, pero el ERI es un acumulado y en
-- los cierres intermedios (corte a marzo, junio, septiembre) NO cubre 12 meses.
-- La extracción IA ahora lee ese rango del encabezado del ERI y lo guarda aquí,
-- para que la capacidad de pago mensual y los días de las rotaciones se calculen
-- sobre la duración real y no sobre un año supuesto.
--
-- NULL = no se pudo determinar (o fila anterior a este cambio): el cálculo cae
-- al Parameter income_statement, que es el comportamiento que había.
ALTER TABLE "financial_statement_periods"
  ADD COLUMN "statement_months" INTEGER;
