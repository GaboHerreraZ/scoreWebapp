-- El score de viabilidad pasa de entero a decimal. El score ES la suma de las
-- contribuciones por dimensión que ve el usuario (cada una a un decimal), así
-- que como Int el decimal se truncaba en la escritura: el detalle mostraba
-- 20,9 y el listado, el dashboard y el Excel decían 20.
-- Los valores existentes son enteros y sobreviven intactos al cambio de tipo.

ALTER TABLE "credit_studies" ALTER COLUMN "viability_score" TYPE DOUBLE PRECISION;
