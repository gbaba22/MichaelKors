/**
 * The whole application: one Express process serving the API, the business-user
 * assessment link and the admin link, backed by a single SQLite file.
 */
// Must come first: db.ts and auth.ts read configuration at import time.
import './env.js';

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { adminPassword } from './auth.js';
import { databaseFile } from './db.js';
import { adminRouter } from './routes/admin.js';
import { publicRouter } from './routes/public.js';
import { isSeeded, seed } from './seed.js';

const port = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const clientDir = resolve(here, '../client');

if (!isSeeded()) {
  seed();
  console.log('Seeded configuration from seed/catalog.json');
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api/admin', adminRouter);
app.use('/api', publicRouter);
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: databaseFile });
});

// In production the built client lives in dist/client; in dev, vite serves it.
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  // Client-side routing: any non-API path renders the SPA.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(resolve(clientDir, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`AI Capability Assessment running on http://localhost:${port}`);
  console.log(`  Assessment link: http://localhost:${port}/`);
  console.log(`  Admin link:      http://localhost:${port}/admin`);
  console.log(`  Database:        ${databaseFile}`);
  if (!adminPassword()) {
    console.warn('  WARNING: ADMIN_PASSWORD is not set - the admin link cannot be used.');
  }
});
