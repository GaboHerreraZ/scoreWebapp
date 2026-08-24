// Respaldo previo al retiro del contrato macro (migración
// 20260824140000_drop_macro_contract). Solo LEE: vuelca contract_signatures a
// un JSON y muestra un resumen de lo que se va a perder.
//
// Se corre ANTES de aplicar la migración, en cada ambiente:
//   node scripts/export-contract-signatures.mjs .env.staging
//   node scripts/export-contract-signatures.mjs .env          (PRODUCCIÓN)
//
// Los contratos firmados son evidencia legal. El PDF sigue existiendo en el
// bucket de Supabase Storage y en Zapsign; lo que solo vive en esta tabla es el
// puntero (signed_file_storage_path, provider_doc_token). Este volcado lo salva.
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const envFile = process.argv[2] ?? '.env.staging';
const isProd = !envFile.includes('staging');

const readUrl = (file) => {
  const env = fs.readFileSync(file, 'utf8');
  // DIRECT_URL primero: la lectura no pasa por el pooler.
  const m =
    env.match(/^DIRECT_URL=\"?([^\"\n]+)\"?/m) ??
    env.match(/^DATABASE_URL=\"?([^\"\n]+)\"?/m);
  if (!m) throw new Error(`No DIRECT_URL/DATABASE_URL en ${file}`);
  return m[1];
};

const url = readUrl(envFile);
const projectRef = url.match(/postgres\.([a-z0-9]+):/)?.[1] ?? '??';

console.log(
  `${isProd ? '⚠️  PRODUCCIÓN' : 'STAGING'} — ${envFile} (${projectRef})\n`,
);

const client = new Client({ connectionString: url });
await client.connect();

try {
  const exists = await client.query(
    `SELECT to_regclass('public.contract_signatures') AS t`,
  );
  if (!exists.rows[0].t) {
    console.log('La tabla contract_signatures ya no existe: nada que respaldar.');
    process.exit(0);
  }

  const { rows } = await client.query(`
    SELECT cs.*, c."name" AS company_name, c."nit" AS company_nit, p."code" AS status_code
    FROM "contract_signatures" cs
    JOIN "companies" c ON c."id" = cs."company_id"
    LEFT JOIN "parameters" p ON p."id" = cs."status_id"
    ORDER BY cs."created_at"
  `);

  const byStatus = rows.reduce((acc, r) => {
    const k = r.status_code ?? '(sin estado)';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Filas en contract_signatures: ${rows.length}`);
  for (const [code, n] of Object.entries(byStatus)) {
    console.log(`  ${code.padEnd(20)} ${n}`);
  }
  const withPdf = rows.filter((r) => r.signed_file_storage_path).length;
  console.log(`  con PDF respaldado en Storage: ${withPdf}`);

  // Empresas inactivas: no deberían existir (companies.is_active nace en true y
  // solo la firma lo tocaba, para ponerlo en true). Si aparece alguna, hay que
  // revisarla a mano ANTES de migrar: al quitar el contrato nada la reactivará.
  const inactive = await client.query(
    `SELECT "id", "name", "nit" FROM "companies" WHERE "is_active" = false`,
  );
  if (inactive.rows.length) {
    console.log(
      `\n⚠️  ${inactive.rows.length} empresa(s) con is_active=false — revisar antes de migrar:`,
    );
    for (const c of inactive.rows) console.log(`   ${c.nit}  ${c.name}  (${c.id})`);
  } else {
    console.log('\n✓ Ninguna empresa quedó inactiva por falta de firma.');
  }

  if (!rows.length) {
    console.log('\nSin filas: no se escribe archivo.');
    process.exit(0);
  }

  fs.mkdirSync('backups', { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = path.join(
    'backups',
    `contract-signatures-${projectRef}-${stamp}.json`,
  );
  fs.writeFileSync(
    out,
    JSON.stringify(
      { exportedAt: new Date().toISOString(), projectRef, envFile, rows },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`\n✓ Respaldo escrito en ${out}`);
  console.log('  Guardarlo fuera del repo antes de aplicar la migración.');
} finally {
  await client.end();
}
