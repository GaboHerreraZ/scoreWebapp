// Verifica que las migraciones esten alineadas entre el repo local, staging y
// produccion. Solo LEE (_prisma_migrations e information_schema); no modifica nada.
//
// Uso: node scripts/migrate-check.mjs   (o: npm run migrate:check)
import fs from 'node:fs';
import { Client } from 'pg';

const ENVS = [
  { label: 'STAGING', file: '.env.staging' },
  { label: 'PROD', file: '.env' },
];

const readUrl = (file) => {
  const env = fs.readFileSync(file, 'utf8');
  const m = env.match(/^DATABASE_URL=\"?([^\"\n]+)\"?/m);
  if (!m) throw new Error(`No DATABASE_URL en ${file}`);
  return m[1];
};

const refOf = (url) => url.match(/postgres\.([a-z0-9]+):/)?.[1] ?? '??';

async function fetchMigrations(url) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT migration_name,
              COUNT(*) AS rows,
              COUNT(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
              COUNT(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back
       FROM _prisma_migrations
       GROUP BY migration_name`,
    );
    return r.rows;
  } finally {
    await c.end();
  }
}

const local = fs
  .readdirSync('prisma/migrations')
  .filter((f) => /^[0-9]/.test(f))
  .sort();

const results = {};
for (const { label, file } of ENVS) {
  const url = readUrl(file);
  results[label] = { ref: refOf(url), rows: await fetchMigrations(url) };
}

console.log('Local migrations:', local.length);
for (const { label } of ENVS) {
  const r = results[label];
  const applied = r.rows.filter((x) => Number(x.ok) > 0).length;
  console.log(`${label} (${r.ref}): ${applied} aplicadas, ${r.rows.length} nombres en historial`);
}
console.log();

const localSet = new Set(local);
const setOf = (label) => new Set(results[label].rows.filter((x) => Number(x.ok) > 0).map((x) => x.migration_name));
const sets = Object.fromEntries(ENVS.map((e) => [e.label, setOf(e.label)]));

const allNames = [...new Set([...local, ...ENVS.flatMap((e) => results[e.label].rows.map((r) => r.migration_name))])].sort();

let problems = 0;
console.log('MIGRACION'.padEnd(60), 'LOCAL', ...ENVS.map((e) => e.label.padEnd(8)));
for (const name of allNames) {
  const cells = [localSet.has(name) ? ' ✓ ' : ' ✗ '];
  let aligned = localSet.has(name);
  for (const { label } of ENVS) {
    const has = sets[label].has(name);
    if (!has) aligned = false;
    cells.push((has ? ' ✓ ' : ' ✗ ').padEnd(8));
  }
  // detectar duplicados/rolled_back en historial
  let dupNote = '';
  for (const { label } of ENVS) {
    const row = results[label].rows.find((r) => r.migration_name === name);
    if (row && Number(row.rolled_back) > 0) dupNote += ` [${label}: ${row.rolled_back} rolled_back]`;
    if (row && Number(row.rows) > 1) dupNote += ` [${label}: ${row.rows} filas]`;
  }
  if (!aligned || dupNote) {
    problems++;
    console.log(name.padEnd(60), ...cells, '  <-- REVISAR' + dupNote);
  } else {
    console.log(name.padEnd(60), ...cells);
  }
}

console.log();
if (problems === 0) {
  console.log('✅ Todo alineado: local, staging y prod coinciden y sin duplicados.');
  process.exit(0);
} else {
  console.log(`⚠️  ${problems} migracion(es) requieren revision (ver "REVISAR" arriba).`);
  process.exit(2);
}
