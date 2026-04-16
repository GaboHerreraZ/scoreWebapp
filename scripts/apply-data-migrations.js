import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'data');

const version = process.env.DATA_MIGRATION_VERSION;
if (!version) {
  console.error(
    'Missing DATA_MIGRATION_VERSION environment variable (e.g. "v001")',
  );
  process.exit(1);
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DIRECT_URL / DATABASE_URL environment variable');
  process.exit(1);
}

const client = new Client({ connectionString });

async function ensureTrackingTable() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_data_migrations" (
      "name" VARCHAR(255) PRIMARY KEY,
      "applied_at" TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

async function getApplied() {
  const { rows } = await client.query('SELECT name FROM "_data_migrations"');
  return new Set(rows.map((r) => r.name));
}

async function applyMigration(name, sql) {
  console.log(`▶ Applying ${name}`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO "_data_migrations" (name) VALUES ($1)', [
      name,
    ]);
    await client.query('COMMIT');
    console.log(`✔ Applied ${name}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`✖ Failed ${name}:`, err.message);
    throw err;
  }
}

function collectScripts(targetVersion) {
  const versionDir = join(MIGRATIONS_DIR, targetVersion);
  let stat;
  try {
    stat = statSync(versionDir);
  } catch {
    console.error(`Version folder not found: prisma/data/${targetVersion}`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    console.error(`Not a directory: prisma/data/${targetVersion}`);
    process.exit(1);
  }

  return readdirSync(versionDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({
      name: `${targetVersion}/${file.replace('.sql', '')}`,
      path: join(versionDir, file),
    }));
}

async function main() {
  await client.connect();
  try {
    await ensureTrackingTable();
    const applied = await getApplied();

    const scripts = collectScripts(version);
    const pending = scripts.filter((s) => !applied.has(s.name));

    console.log(`Target version: ${version}`);

    if (pending.length === 0) {
      console.log('No pending data migrations.');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):`);
    pending.forEach((s) => console.log(`  - ${s.name}`));
    console.log('');

    for (const { name, path } of pending) {
      const sql = readFileSync(path, 'utf8');
      await applyMigration(name, sql);
    }

    console.log('\nAll data migrations applied successfully.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
