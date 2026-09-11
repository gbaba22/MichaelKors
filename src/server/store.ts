/**
 * Data access for configuration, responses and analytics.
 * Everything that both the public and admin routes need lives here.
 */
import { rows, row, run, transaction } from './db.js';
import { computeScores, mean, round } from '../shared/scoring.js';
import type {
  AnalyticsPayload,
  Factor,
  Opportunity,
  OpportunityAggregate,
  ResponseRow,
  Settings,
  Team,
} from '../shared/types.js';

/* ------------------------------------------------------------------ settings */

const DEFAULT_SETTINGS: Settings = { impactWeight: 0.6, feasibilityWeight: 0.4 };

export function getSettings(): Settings {
  const stored = new Map(
    rows<{ key: string; value: string }>('SELECT key, value FROM settings').map((r) => [
      r.key,
      r.value,
    ]),
  );
  const read = (key: string, fallback: number) => {
    const raw = stored.get(key);
    const parsed = raw == null ? Number.NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    impactWeight: read('impact_weight', DEFAULT_SETTINGS.impactWeight),
    feasibilityWeight: read('feasibility_weight', DEFAULT_SETTINGS.feasibilityWeight),
  };
}

export function setSettings(next: Partial<Settings>) {
  const upsert = (key: string, value: number) =>
    run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      String(value),
    );
  transaction(() => {
    if (next.impactWeight != null) upsert('impact_weight', next.impactWeight);
    if (next.feasibilityWeight != null) upsert('feasibility_weight', next.feasibilityWeight);
  });
}

/* --------------------------------------------------------------------- scale */

export function getScale(): number[] {
  const points = rows<{ score: number }>('SELECT score FROM scale_points ORDER BY sort_order, score');
  return points.length > 0 ? points.map((p) => p.score) : [0, 5, 15, 30, 50, 75, 100];
}

export function setScale(scores: number[]) {
  transaction(() => {
    run('DELETE FROM scale_points');
    scores.forEach((score, i) => run('INSERT INTO scale_points (score, sort_order) VALUES (?, ?)', score, i));
  });
}

/* --------------------------------------------------------------------- teams */

export function listTeams(activeOnly = false): Team[] {
  const raw = rows<{ id: number; name: string; active: number; sort_order: number }>(
    `SELECT id, name, active, sort_order FROM teams
     ${activeOnly ? 'WHERE active = 1' : ''}
     ORDER BY sort_order, name`,
  );
  return raw.map((t) => ({ id: t.id, name: t.name, active: !!t.active, sortOrder: t.sort_order }));
}

export function createTeam(input: { name: string; active?: boolean; sortOrder?: number }): Team {
  const nextOrder =
    input.sortOrder ??
    (row<{ next: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM teams')?.next ?? 0);
  const result = run(
    'INSERT INTO teams (name, active, sort_order) VALUES (?, ?, ?)',
    input.name,
    input.active === false ? 0 : 1,
    nextOrder,
  );
  return {
    id: Number(result.lastInsertRowid),
    name: input.name,
    active: input.active !== false,
    sortOrder: nextOrder,
  };
}

export function updateTeam(id: number, patch: Partial<Pick<Team, 'name' | 'active' | 'sortOrder'>>) {
  const current = row<{ name: string; active: number; sort_order: number }>(
    'SELECT name, active, sort_order FROM teams WHERE id = ?',
    id,
  );
  if (!current) return false;
  run(
    'UPDATE teams SET name = ?, active = ?, sort_order = ? WHERE id = ?',
    patch.name ?? current.name,
    patch.active == null ? current.active : patch.active ? 1 : 0,
    patch.sortOrder ?? current.sort_order,
    id,
  );
  return true;
}

export function deleteTeam(id: number) {
  run('DELETE FROM teams WHERE id = ?', id);
}

/* ------------------------------------------------------------- opportunities */

export function listOpportunities(activeOnly = false): Opportunity[] {
  const raw = rows<{
    id: number;
    name: string;
    business_area: string;
    business_goal: string;
    description: string;
    active: number;
    sort_order: number;
  }>(
    `SELECT id, name, business_area, business_goal, description, active, sort_order
     FROM opportunities ${activeOnly ? 'WHERE active = 1' : ''}
     ORDER BY sort_order, name`,
  );
  const mapping = rows<{ opportunity_id: number; team_id: number }>(
    'SELECT opportunity_id, team_id FROM opportunity_teams',
  );
  const byOpportunity = new Map<number, number[]>();
  for (const m of mapping) {
    const list = byOpportunity.get(m.opportunity_id) ?? [];
    list.push(m.team_id);
    byOpportunity.set(m.opportunity_id, list);
  }
  return raw.map((o) => ({
    id: o.id,
    name: o.name,
    businessArea: o.business_area,
    businessGoal: o.business_goal,
    description: o.description,
    active: !!o.active,
    sortOrder: o.sort_order,
    teamIds: byOpportunity.get(o.id) ?? [],
  }));
}

/** Active opportunities mapped to one team, in admin-defined order. */
export function listOpportunitiesForTeam(teamId: number): Opportunity[] {
  const ids = new Set(
    rows<{ opportunity_id: number }>(
      'SELECT opportunity_id FROM opportunity_teams WHERE team_id = ?',
      teamId,
    ).map((r) => r.opportunity_id),
  );
  return listOpportunities(true).filter((o) => ids.has(o.id));
}

type OpportunityInput = {
  name: string;
  businessArea?: string;
  businessGoal?: string;
  description?: string;
  active?: boolean;
  sortOrder?: number;
  teamIds?: number[];
};

export function createOpportunity(input: OpportunityInput): number {
  return transaction(() => {
    const nextOrder =
      input.sortOrder ??
      (row<{ next: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM opportunities')
        ?.next ?? 0);
    const result = run(
      `INSERT INTO opportunities (name, business_area, business_goal, description, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.name,
      input.businessArea ?? '',
      input.businessGoal ?? '',
      input.description ?? '',
      input.active === false ? 0 : 1,
      nextOrder,
    );
    const id = Number(result.lastInsertRowid);
    setOpportunityTeams(id, input.teamIds ?? []);
    return id;
  });
}

export function updateOpportunity(id: number, patch: Partial<OpportunityInput>) {
  const current = row<{
    name: string;
    business_area: string;
    business_goal: string;
    description: string;
    active: number;
    sort_order: number;
  }>(
    'SELECT name, business_area, business_goal, description, active, sort_order FROM opportunities WHERE id = ?',
    id,
  );
  if (!current) return false;
  transaction(() => {
    run(
      `UPDATE opportunities
       SET name = ?, business_area = ?, business_goal = ?, description = ?, active = ?, sort_order = ?
       WHERE id = ?`,
      patch.name ?? current.name,
      patch.businessArea ?? current.business_area,
      patch.businessGoal ?? current.business_goal,
      patch.description ?? current.description,
      patch.active == null ? current.active : patch.active ? 1 : 0,
      patch.sortOrder ?? current.sort_order,
      id,
    );
    if (patch.teamIds) setOpportunityTeams(id, patch.teamIds);
  });
  return true;
}

export function setOpportunityTeams(opportunityId: number, teamIds: number[]) {
  run('DELETE FROM opportunity_teams WHERE opportunity_id = ?', opportunityId);
  for (const teamId of new Set(teamIds)) {
    run(
      'INSERT OR IGNORE INTO opportunity_teams (opportunity_id, team_id) VALUES (?, ?)',
      opportunityId,
      teamId,
    );
  }
}

export function deleteOpportunity(id: number) {
  run('DELETE FROM opportunities WHERE id = ?', id);
}

/* ------------------------------------------------------------------- factors */

export function listFactors(activeOnly = false): Factor[] {
  const raw = rows<{
    id: number;
    name: string;
    question: string;
    category: 'impact' | 'feasibility';
    inverted: number;
    weight: number;
    active: number;
    sort_order: number;
  }>(
    `SELECT id, name, question, category, inverted, weight, active, sort_order
     FROM factors ${activeOnly ? 'WHERE active = 1' : ''}
     ORDER BY sort_order, id`,
  );
  const levels = rows<{ factor_id: number; score: number; label: string }>(
    'SELECT factor_id, score, label FROM factor_levels ORDER BY factor_id, score',
  );
  const byFactor = new Map<number, { score: number; label: string }[]>();
  for (const l of levels) {
    const list = byFactor.get(l.factor_id) ?? [];
    list.push({ score: l.score, label: l.label });
    byFactor.set(l.factor_id, list);
  }
  const scale = getScale();
  return raw.map((f) => ({
    id: f.id,
    name: f.name,
    question: f.question,
    category: f.category,
    inverted: !!f.inverted,
    weight: f.weight,
    active: !!f.active,
    sortOrder: f.sort_order,
    // Fall back to unlabelled scale points so a newly added factor is usable
    // before the admin fills in its rubric.
    levels: byFactor.get(f.id) ?? scale.map((score) => ({ score, label: '' })),
  }));
}

type FactorInput = {
  name: string;
  question?: string;
  category: 'impact' | 'feasibility';
  inverted?: boolean;
  weight?: number;
  active?: boolean;
  sortOrder?: number;
  levels?: { score: number; label: string }[];
};

export function createFactor(input: FactorInput): number {
  return transaction(() => {
    const nextOrder =
      input.sortOrder ??
      (row<{ next: number }>('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM factors')?.next ??
        0);
    const result = run(
      `INSERT INTO factors (name, question, category, inverted, weight, active, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      input.name,
      input.question ?? '',
      input.category,
      input.inverted ? 1 : 0,
      input.weight ?? 0,
      input.active === false ? 0 : 1,
      nextOrder,
    );
    const id = Number(result.lastInsertRowid);
    setFactorLevels(id, input.levels ?? getScale().map((score) => ({ score, label: '' })));
    return id;
  });
}

export function updateFactor(id: number, patch: Partial<FactorInput>) {
  const current = row<{
    name: string;
    question: string;
    category: 'impact' | 'feasibility';
    inverted: number;
    weight: number;
    active: number;
    sort_order: number;
  }>(
    'SELECT name, question, category, inverted, weight, active, sort_order FROM factors WHERE id = ?',
    id,
  );
  if (!current) return false;
  transaction(() => {
    run(
      `UPDATE factors
       SET name = ?, question = ?, category = ?, inverted = ?, weight = ?, active = ?, sort_order = ?
       WHERE id = ?`,
      patch.name ?? current.name,
      patch.question ?? current.question,
      patch.category ?? current.category,
      patch.inverted == null ? current.inverted : patch.inverted ? 1 : 0,
      patch.weight ?? current.weight,
      patch.active == null ? current.active : patch.active ? 1 : 0,
      patch.sortOrder ?? current.sort_order,
      id,
    );
    if (patch.levels) setFactorLevels(id, patch.levels);
  });
  return true;
}

export function setFactorLevels(factorId: number, levels: { score: number; label: string }[]) {
  run('DELETE FROM factor_levels WHERE factor_id = ?', factorId);
  for (const level of levels) {
    run(
      'INSERT OR REPLACE INTO factor_levels (factor_id, score, label) VALUES (?, ?, ?)',
      factorId,
      level.score,
      level.label ?? '',
    );
  }
}

export function deleteFactor(id: number) {
  run('DELETE FROM factors WHERE id = ?', id);
}

/* --------------------------------------------------------------- respondents */

export interface Respondent {
  id: number;
  name: string;
  email: string;
  teamId: number | null;
  createdAt: string;
}

/**
 * Looks a respondent up by email (case-insensitive) and creates them if new, so
 * someone who closes the tab and comes back resumes their own answers.
 */
export function upsertRespondent(input: { name: string; email: string; teamId: number }): Respondent {
  const email = input.email.trim().toLowerCase();
  const existing = row<{ id: number }>('SELECT id FROM respondents WHERE email = ?', email);
  if (existing) {
    run(
      "UPDATE respondents SET name = ?, team_id = ?, updated_at = datetime('now') WHERE id = ?",
      input.name.trim(),
      input.teamId,
      existing.id,
    );
  } else {
    run(
      'INSERT INTO respondents (name, email, team_id) VALUES (?, ?, ?)',
      input.name.trim(),
      email,
      input.teamId,
    );
  }
  const saved = row<{ id: number; name: string; email: string; team_id: number | null; created_at: string }>(
    'SELECT id, name, email, team_id, created_at FROM respondents WHERE email = ?',
    email,
  )!;
  return {
    id: saved.id,
    name: saved.name,
    email: saved.email,
    teamId: saved.team_id,
    createdAt: saved.created_at,
  };
}

export function getRespondent(id: number): Respondent | undefined {
  const r = row<{ id: number; name: string; email: string; team_id: number | null; created_at: string }>(
    'SELECT id, name, email, team_id, created_at FROM respondents WHERE id = ?',
    id,
  );
  return r && { id: r.id, name: r.name, email: r.email, teamId: r.team_id, createdAt: r.created_at };
}

/* ----------------------------------------------------------------- responses */

/** All of one respondent's saved scores, keyed by opportunity then factor. */
export function getRespondentScores(
  respondentId: number,
): Map<number, { scores: Record<number, number>; submitted: boolean }> {
  const responseRows = rows<{ id: number; opportunity_id: number; submitted: number }>(
    'SELECT id, opportunity_id, submitted FROM responses WHERE respondent_id = ?',
    respondentId,
  );
  const byResponseId = new Map(responseRows.map((r) => [r.id, r]));
  const result = new Map<number, { scores: Record<number, number>; submitted: boolean }>();
  for (const r of responseRows) {
    result.set(r.opportunity_id, { scores: {}, submitted: !!r.submitted });
  }
  if (responseRows.length > 0) {
    const placeholders = responseRows.map(() => '?').join(',');
    const scoreRows = rows<{ response_id: number; factor_id: number; score: number }>(
      `SELECT response_id, factor_id, score FROM response_scores WHERE response_id IN (${placeholders})`,
      ...responseRows.map((r) => r.id),
    );
    for (const s of scoreRows) {
      const response = byResponseId.get(s.response_id);
      if (!response) continue;
      result.get(response.opportunity_id)!.scores[s.factor_id] = s.score;
    }
  }
  return result;
}

/**
 * Saves (or re-saves) one respondent's scores for one opportunity.
 * Called on every answer change, so it must be an idempotent upsert.
 */
export function saveResponse(input: {
  respondentId: number;
  opportunityId: number;
  scores: Record<number, number>;
  submitted: boolean;
}) {
  transaction(() => {
    run(
      `INSERT INTO responses (respondent_id, opportunity_id, submitted, submitted_at, updated_at)
       VALUES (?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END, datetime('now'))
       ON CONFLICT(respondent_id, opportunity_id) DO UPDATE SET
         submitted    = excluded.submitted,
         -- Keep the first submission time rather than overwriting it on re-save.
         submitted_at = COALESCE(responses.submitted_at, excluded.submitted_at),
         updated_at   = excluded.updated_at`,
      input.respondentId,
      input.opportunityId,
      input.submitted ? 1 : 0,
      input.submitted ? 1 : 0,
    );
    const response = row<{ id: number }>(
      'SELECT id FROM responses WHERE respondent_id = ? AND opportunity_id = ?',
      input.respondentId,
      input.opportunityId,
    )!;
    for (const [factorId, score] of Object.entries(input.scores)) {
      if (score == null || Number.isNaN(Number(score))) continue;
      run(
        `INSERT INTO response_scores (response_id, factor_id, score) VALUES (?, ?, ?)
         ON CONFLICT(response_id, factor_id) DO UPDATE SET score = excluded.score`,
        response.id,
        Number(factorId),
        Number(score),
      );
    }
  });
}

/** Marks every opportunity the respondent has answered as submitted. */
export function submitAll(respondentId: number) {
  run(
    `UPDATE responses
     SET submitted = 1,
         submitted_at = COALESCE(submitted_at, datetime('now')),
         updated_at = datetime('now')
     WHERE respondent_id = ?`,
    respondentId,
  );
}

/* ------------------------------------------------------------------ analytics */

/** Every respondent x opportunity row, with each row's computed scores. */
export function listResponseRows(): ResponseRow[] {
  const factors = listFactors();
  const settings = getSettings();
  const raw = rows<{
    response_id: number;
    respondent_id: number;
    respondent_name: string;
    respondent_email: string;
    team_id: number | null;
    team_name: string | null;
    opportunity_id: number;
    opportunity_name: string;
    business_area: string;
    submitted: number;
    submitted_at: string | null;
    updated_at: string;
  }>(
    `SELECT r.id             AS response_id,
            r.respondent_id  AS respondent_id,
            p.name           AS respondent_name,
            p.email          AS respondent_email,
            p.team_id        AS team_id,
            t.name           AS team_name,
            r.opportunity_id AS opportunity_id,
            o.name           AS opportunity_name,
            o.business_area  AS business_area,
            r.submitted      AS submitted,
            r.submitted_at   AS submitted_at,
            r.updated_at     AS updated_at
     FROM responses r
     JOIN respondents p   ON p.id = r.respondent_id
     JOIN opportunities o ON o.id = r.opportunity_id
     LEFT JOIN teams t    ON t.id = p.team_id
     ORDER BY p.name, o.sort_order`,
  );
  const scoreRows = rows<{ response_id: number; factor_id: number; score: number }>(
    'SELECT response_id, factor_id, score FROM response_scores',
  );
  const byResponse = new Map<number, Record<number, number>>();
  for (const s of scoreRows) {
    const record = byResponse.get(s.response_id) ?? {};
    record[s.factor_id] = s.score;
    byResponse.set(s.response_id, record);
  }

  return raw.map((r) => {
    const scores = byResponse.get(r.response_id) ?? {};
    const computed = computeScores(factors, scores, settings);
    return {
      responseId: r.response_id,
      respondentId: r.respondent_id,
      respondentName: r.respondent_name,
      respondentEmail: r.respondent_email,
      teamId: r.team_id,
      teamName: r.team_name ?? '',
      opportunityId: r.opportunity_id,
      opportunityName: r.opportunity_name,
      businessArea: r.business_area,
      submitted: !!r.submitted,
      submittedAt: r.submitted_at,
      updatedAt: r.updated_at,
      scores,
      impact: round(computed.impact),
      feasibility: round(computed.feasibility),
      overall: round(computed.overall),
    };
  });
}

/**
 * Opportunity-level analytics: each respondent's scores are computed first and
 * then averaged, so one person answering every factor counts the same as
 * anyone else regardless of how many factors there are.
 */
export function getAnalytics(): AnalyticsPayload {
  const factors = listFactors();
  const settings = getSettings();
  const opportunities = listOpportunities();
  const teams = new Map(listTeams().map((t) => [t.id, t.name]));
  const responseRows = listResponseRows();

  const byOpportunity = new Map<number, ResponseRow[]>();
  for (const r of responseRows) {
    const list = byOpportunity.get(r.opportunityId) ?? [];
    list.push(r);
    byOpportunity.set(r.opportunityId, list);
  }

  const aggregates: OpportunityAggregate[] = opportunities.map((o) => {
    const responses = byOpportunity.get(o.id) ?? [];
    const factorMeans: Record<number, number> = {};
    for (const factor of factors) {
      const value = mean(responses.map((r) => r.scores[factor.id]));
      if (value != null) factorMeans[factor.id] = round(value, 1)!;
    }
    return {
      opportunityId: o.id,
      name: o.name,
      businessArea: o.businessArea,
      businessGoal: o.businessGoal,
      teamNames: o.teamIds.map((id) => teams.get(id) ?? '').filter(Boolean),
      respondentCount: responses.length,
      factorMeans,
      impact: round(mean(responses.map((r) => r.impact))),
      feasibility: round(mean(responses.map((r) => r.feasibility))),
      overall: round(mean(responses.map((r) => r.overall))),
    };
  });

  return {
    factors,
    settings,
    aggregates,
    totals: {
      respondents: row<{ n: number }>('SELECT COUNT(*) AS n FROM respondents')?.n ?? 0,
      responses: responseRows.length,
      submitted: responseRows.filter((r) => r.submitted).length,
    },
    generatedAt: new Date().toISOString(),
  };
}
