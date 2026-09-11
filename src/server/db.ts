/**
 * The file database. `node:sqlite` ships with Node (>=22.5) so there is no
 * native module to build and no server to run - the whole dataset is one file,
 * which can be copied or backed up as-is.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const databaseFile = resolve(
  process.cwd(),
  process.env.DATABASE_FILE ?? './data/assessment.db',
);

mkdirSync(dirname(databaseFile), { recursive: true });

export const db = new DatabaseSync(databaseFile);

// WAL lets the admin dashboard read while business users are submitting.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// schema.sql sits next to this file in both src/ (tsx) and dist/ (tsc copies it
// via the build script), so resolve it relative to the module.
db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));

/** Rows come back as null-prototype objects; this makes them ordinary records. */
export function rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const result = db.prepare(sql).all(...(params as never[]));
  return result.map((r) => ({ ...r })) as T[];
}

export function row<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  const result = db.prepare(sql).get(...(params as never[]));
  return result === undefined ? undefined : ({ ...result } as T);
}

export function run(sql: string, ...params: unknown[]) {
  return db.prepare(sql).run(...(params as never[]));
}

let depth = 0;

/**
 * Runs `fn` in a transaction, rolling back if it throws.
 *
 * Reentrant: store functions call each other freely (seeding calls
 * createFactor, which is itself transactional), and SQLite has no nested
 * BEGIN, so inner calls use savepoints.
 */
export function transaction<T>(fn: () => T): T {
  const name = `sp_${depth}`;
  db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth += 1;
  try {
    const result = fn();
    depth -= 1;
    db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (error) {
    depth -= 1;
    db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw error;
  }
}
