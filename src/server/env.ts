/**
 * Reads .env into process.env without pulling in a dependency.
 *
 * This module must be imported before any module that reads configuration at
 * import time (db.ts opens DATABASE_FILE, auth.ts reads SESSION_SECRET), which
 * is why it is a module of its own rather than a function in index.ts.
 *
 * Variables already present in the environment always win, so a real deployment
 * can set them properly and ignore the file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve(process.cwd(), process.env.ENV_FILE ?? '.env');

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const match = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1];
    let value = match[2] ?? '';
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
}
