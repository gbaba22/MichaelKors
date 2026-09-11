#!/usr/bin/env node
/**
 * Regenerates seed/catalog.json from the source workbook.
 *
 *   node scripts/import-xlsx.mjs [path/to/workbook.xlsx]
 *
 * The workbook is the system of record for the assessment model:
 *   - "Weights"             -> factor categories, weights and which factors are inverted
 *   - "Rubric"              -> the 7-point scale and the label for each factor at each point
 *   - "Opportunity Catalog" -> opportunities, business areas/goals and their relevant teams
 *
 * Reads .xlsx directly (it is just a zip of XML) so this script needs no dependencies.
 */
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workbookPath = process.argv[2] ?? resolve(root, 'seed/AI_Opportunity_Assessment_v2.xlsx');
const outPath = resolve(root, 'seed/catalog.json');

/* ---------------------------------------------------------------- xlsx read */

const unzip = (name) => execFileSync('unzip', ['-p', workbookPath, name], { maxBuffer: 64 << 20 });

const decodeEntities = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

/** Shared string table: each <si> is one string, possibly split across runs. */
function readSharedStrings() {
  let xml;
  try {
    xml = unzip('xl/sharedStrings.xml').toString('utf8');
  } catch {
    return [];
  }
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
}

/** Maps sheet name -> worksheet part path, via workbook.xml + its rels. */
function sheetPaths() {
  const wb = unzip('xl/workbook.xml').toString('utf8');
  const rels = unzip('xl/_rels/workbook.xml.rels').toString('utf8');
  const relById = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])[1],
      /Target="([^"]+)"/.exec(m[0])[1].replace(/^\/?xl\//, ''),
    ]),
  );
  const out = new Map();
  for (const m of wb.matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = decodeEntities(/name="([^"]+)"/.exec(m[0])[1]);
    const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    out.set(name, `xl/${relById.get(rid)}`);
  }
  return out;
}

const strings = readSharedStrings();
const paths = sheetPaths();

/** Returns a sheet as a dense array of rows of trimmed strings ('' for blanks). */
function readSheet(name) {
  const path = paths.get(name);
  if (!path) throw new Error(`sheet not found: ${name} (have: ${[...paths.keys()].join(', ')})`);
  const xml = unzip(path).toString('utf8');
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const col = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const index = col
        ? [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1
        : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1];
      // Skip formulas; we only want literal content.
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = strings[Number(raw)] ?? '';
      else if (type === 'inlineStr')
        value = decodeEntities([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (raw != null) value = decodeEntities(raw);
      while (cells.length < index) cells.push('');
      cells[index] = String(value).trim();
    }
    rows.push(cells);
  }
  return rows;
}

/* ------------------------------------------------------------- scale + rubric */

const rubricRows = readSheet('Rubric');
const rubricHeader = rubricRows[0];
// Header is: Factor | Question | 0 | 5 | 15 | 30 | 50 | 75 | 100
const scale = rubricHeader.slice(2).filter((v) => v !== '').map(Number);
if (scale.length !== 7 || scale[0] !== 0 || scale.at(-1) !== 100) {
  throw new Error(`unexpected scale in Rubric header: ${JSON.stringify(rubricHeader)}`);
}

const rubric = new Map(); // factor name -> { question, levels: [{score,label}] }
for (const row of rubricRows.slice(1)) {
  if (!row[0]) continue;
  rubric.set(row[0], {
    question: row[1] ?? '',
    levels: scale.map((score, i) => ({ score, label: row[2 + i] ?? '' })),
  });
}

/* ------------------------------------------------------------------- factors */

// The Weights sheet is three labelled blocks: impact factors, feasibility
// factors, then the overall Impact/Feasibility split.
const weightRows = readSheet('Weights');
const parsePercent = (v) => {
  const n = Number(String(v).replace('%', ''));
  if (Number.isNaN(n)) throw new Error(`unparseable weight: ${v}`);
  return String(v).includes('%') ? n / 100 : n;
};

const factors = [];
const overall = {};
let category = null;
let order = 0;
// Note: the sheet's header row is itself the first block marker ("Impact
// Factor | Weight"), so iterate from row 0 rather than skipping a header.
for (const row of weightRows) {
  const [label, weight] = row;
  if (!label) continue;
  if (/^Impact Factor$/i.test(label)) { category = 'impact'; continue; }
  if (/^Feasibility Factor$/i.test(label)) { category = 'feasibility'; continue; }
  if (/^Overall$/i.test(label)) { category = 'overall'; continue; }

  if (category === 'overall') {
    if (/^Impact Score$/i.test(label)) overall.impactWeight = parsePercent(weight);
    if (/^Feasibility Score$/i.test(label)) overall.feasibilityWeight = parsePercent(weight);
    continue;
  }

  // e.g. "Implementation/System Complexity (inverted)"
  const inverted = /\(inverted\)/i.test(label);
  const name = label.replace(/\s*\(inverted\)\s*$/i, '').trim();
  const entry = rubric.get(name);
  if (!entry) throw new Error(`factor "${name}" in Weights has no Rubric row`);
  factors.push({
    name,
    question: entry.question,
    category,
    inverted,
    weight: parsePercent(weight),
    sortOrder: order++,
    levels: entry.levels,
  });
}

/* -------------------------------------------------------------- opportunities */

/**
 * "Relevant Team" holds one or more teams separated by "," or "/"
 * (e.g. "Supply Chain, Planning", "Procurement / Finance").
 */
const splitTeams = (cell) =>
  String(cell)
    .split(/[,/]/)
    .map((t) => t.trim())
    .filter(Boolean);

const catalogRows = readSheet('Opportunity Catalog');
const opportunities = [];
const teams = [];
const seenTeam = new Set();
for (const row of catalogRows.slice(1)) {
  const [businessArea, businessGoal, name, teamCell] = row;
  if (!name) continue;
  const teamNames = splitTeams(teamCell ?? '');
  for (const t of teamNames) {
    if (!seenTeam.has(t)) { seenTeam.add(t); teams.push(t); }
  }
  opportunities.push({
    name,
    businessArea: businessArea ?? '',
    businessGoal: businessGoal ?? '',
    description: '',
    sortOrder: opportunities.length,
    teams: teamNames,
  });
}
teams.sort((a, b) => a.localeCompare(b));

/* --------------------------------------------------------------------- write */

const catalog = {
  source: 'AI_Opportunity_Assessment_v2.xlsx',
  generatedBy: 'scripts/import-xlsx.mjs',
  scale,
  overall,
  factors,
  teams,
  opportunities,
};

writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(
  `wrote ${outPath}: ${factors.length} factors, ${teams.length} teams, ` +
    `${opportunities.length} opportunities, scale ${scale.join('/')}, ` +
    `overall impact ${overall.impactWeight} / feasibility ${overall.feasibilityWeight}`,
);
