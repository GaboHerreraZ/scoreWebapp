-- ─── Retiro del contrato macro ───────────────────────────────────────────────
-- Se elimina la firma del contrato marco Creditia ↔ empresa cliente: ya no se
-- pide y deja de ser un gate para operar. Se dropea la tabla completa y los
-- parámetros de estado que solo ella usaba.
--
-- ANTES DE CORRER ESTO EN PRODUCCIÓN: ejecutar
--   node scripts/export-contract-signatures.mjs .env
-- que vuelca las filas a backups/contract-signatures-*.json. Los contratos
-- YA FIRMADOS son evidencia legal: el PDF sigue en el bucket de Storage y en
-- Zapsign, pero el puntero (ruta del respaldo y token del documento) solo vive
-- en esta tabla. Sin el volcado ese puntero se pierde.
--
-- Nada más en el esquema apunta a contract_signatures: sus FKs salen hacia
-- companies y parameters, así que el DROP no toca ninguna otra fila. La empresa
-- tampoco depende de la firma para estar activa (companies.is_active nace en
-- true), así que ningún cliente queda bloqueado por este cambio.

DROP TABLE IF EXISTS "contract_signatures";

-- Los estados solo los usaba la tabla anterior; una vez dropeada quedan
-- huérfanos. Se borran por (type, code) para no tocar otros parámetros.
DELETE FROM "parameters" WHERE "type" = 'company_contract_status';
