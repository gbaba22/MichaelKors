/**
 * Seeds the configuration from seed/catalog.json (generated from the workbook
 * by scripts/import-xlsx.mjs). Runs automatically on first boot and can be
 * re-run with `npm run seed`.
 *
 * Seeding only ever fills an empty table, so re-running it never overwrites
 * configuration the admin has since edited.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { row, run, transaction } from './db.js';
import { createFactor, createOpportunity, createTeam, listTeams, setSettings, setScale } from './store.js';

interface Catalog {
  scale: number[];
  overall: { impactWeight: number; feasibilityWeight: number };
  factors: {
    name: string;
    question: string;
    category: 'impact' | 'feasibility';
    inverted: boolean;
    weight: number;
    sortOrder: number;
    levels: { score: number; label: string }[];
  }[];
  teams: string[];
  opportunities: {
    name: string;
    businessArea: string;
    businessGoal: string;
    description: string;
    sortOrder: number;
    teams: string[];
  }[];
}

const count = (table: string) => row<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;

export function isSeeded(): boolean {
  return count('factors') > 0 || count('opportunities') > 0 || count('teams') > 0;
}

export function seed(catalogPath = resolve(process.cwd(), 'seed/catalog.json')): void {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as Catalog;

  transaction(() => {
    if (count('scale_points') === 0) setScale(catalog.scale);

    if (count('settings') === 0) {
      setSettings({
        impactWeight: catalog.overall.impactWeight,
        feasibilityWeight: catalog.overall.feasibilityWeight,
      });
    }

    if (count('factors') === 0) {
      for (const factor of catalog.factors) createFactor(factor);
    }

    if (count('teams') === 0) {
      catalog.teams.forEach((name, i) => createTeam({ name, sortOrder: i }));
    }

    if (count('opportunities') === 0) {
      const teamIdByName = new Map(listTeams().map((t) => [t.name.toLowerCase(), t.id]));
      for (const opportunity of catalog.opportunities) {
        const teamIds = opportunity.teams
          .map((name) => teamIdByName.get(name.toLowerCase()))
          .filter((id): id is number => id != null);
        createOpportunity({ ...opportunity, teamIds });
      }
    }
  });
}

/** Wipes every response but leaves the configuration alone. */
export function resetResponses(): void {
  transaction(() => {
    run('DELETE FROM response_scores');
    run('DELETE FROM responses');
    run('DELETE FROM respondents');
  });
}

// `npm run seed`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  seed();
  console.log(
    `seeded: ${count('factors')} factors, ${count('teams')} teams, ${count('opportunities')} opportunities`,
  );
}
