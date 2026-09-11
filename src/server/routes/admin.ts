/**
 * The admin API: configuration CRUD, raw responses, analytics and the live
 * event stream. Everything below /login is behind requireAdmin.
 */
import { Router } from 'express';
import { checkPassword, endSession, isAdmin, requireAdmin, startSession, adminPassword } from '../auth.js';
import { addClient, broadcast } from '../events.js';
import { resetResponses } from '../seed.js';
import {
  createFactor,
  createOpportunity,
  createTeam,
  deleteFactor,
  deleteOpportunity,
  deleteTeam,
  getAnalytics,
  getScale,
  listFactors,
  listOpportunities,
  listResponseRows,
  listTeams,
  setScale,
  setSettings,
  getSettings,
  updateFactor,
  updateOpportunity,
  updateTeam,
} from '../store.js';

export const adminRouter: Router = Router();

/* ----------------------------------------------------------------- sessions */

adminRouter.get('/me', (req, res) => {
  res.json({ admin: isAdmin(req), passwordConfigured: adminPassword() != null });
});

adminRouter.post('/login', (req, res) => {
  if (!adminPassword()) {
    return res.status(500).json({
      error: 'ADMIN_PASSWORD is not set on the server. Set it in .env and restart.',
    });
  }
  if (!checkPassword(String(req.body?.password ?? ''))) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  startSession(res);
  res.json({ ok: true });
});

adminRouter.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

adminRouter.use(requireAdmin);

/* ------------------------------------------------------------------- config */

adminRouter.get('/config', (_req, res) => {
  res.json({
    teams: listTeams(),
    opportunities: listOpportunities(),
    factors: listFactors(),
    settings: getSettings(),
    scale: getScale(),
  });
});

adminRouter.put('/settings', (req, res) => {
  const impactWeight = Number(req.body?.impactWeight);
  const feasibilityWeight = Number(req.body?.feasibilityWeight);
  if (!Number.isFinite(impactWeight) || !Number.isFinite(feasibilityWeight)) {
    return res.status(400).json({ error: 'Weights must be numbers.' });
  }
  if (impactWeight < 0 || feasibilityWeight < 0 || impactWeight + feasibilityWeight <= 0) {
    return res.status(400).json({ error: 'Weights must be positive and add up to more than zero.' });
  }
  setSettings({ impactWeight, feasibilityWeight });
  broadcast({ type: 'config' });
  res.json(getSettings());
});

adminRouter.put('/scale', (req, res) => {
  const scores = Array.isArray(req.body?.scores) ? req.body.scores.map(Number) : [];
  if (scores.length < 2 || scores.some((s: number) => !Number.isFinite(s))) {
    return res.status(400).json({ error: 'Provide at least two numeric scale points.' });
  }
  if (new Set(scores).size !== scores.length) {
    return res.status(400).json({ error: 'Scale points must be unique.' });
  }
  setScale(scores);
  broadcast({ type: 'config' });
  res.json({ scale: getScale() });
});

/* -------------------------------------------------------------------- teams */

adminRouter.post('/teams', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Team name is required.' });
  if (listTeams().some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'A team with that name already exists.' });
  }
  const team = createTeam({ name, active: req.body?.active !== false });
  broadcast({ type: 'config' });
  res.status(201).json(team);
});

adminRouter.put('/teams/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = req.body?.name == null ? undefined : String(req.body.name).trim();
  if (name === '') return res.status(400).json({ error: 'Team name is required.' });
  if (name && listTeams().some((t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'A team with that name already exists.' });
  }
  if (!updateTeam(id, { name, active: req.body?.active, sortOrder: req.body?.sortOrder })) {
    return res.status(404).json({ error: 'Team not found.' });
  }
  broadcast({ type: 'config' });
  res.json(listTeams().find((t) => t.id === id));
});

adminRouter.delete('/teams/:id', (req, res) => {
  deleteTeam(Number(req.params.id));
  broadcast({ type: 'config' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------ opportunities */

adminRouter.post('/opportunities', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Opportunity name is required.' });
  const id = createOpportunity({
    name,
    businessArea: req.body?.businessArea,
    businessGoal: req.body?.businessGoal,
    description: req.body?.description,
    active: req.body?.active,
    teamIds: toNumberArray(req.body?.teamIds),
  });
  broadcast({ type: 'config' });
  res.status(201).json(listOpportunities().find((o) => o.id === id));
});

adminRouter.put('/opportunities/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = req.body?.name == null ? undefined : String(req.body.name).trim();
  if (name === '') return res.status(400).json({ error: 'Opportunity name is required.' });
  const ok = updateOpportunity(id, {
    name,
    businessArea: req.body?.businessArea,
    businessGoal: req.body?.businessGoal,
    description: req.body?.description,
    active: req.body?.active,
    sortOrder: req.body?.sortOrder,
    teamIds: req.body?.teamIds == null ? undefined : toNumberArray(req.body.teamIds),
  });
  if (!ok) return res.status(404).json({ error: 'Opportunity not found.' });
  broadcast({ type: 'config' });
  res.json(listOpportunities().find((o) => o.id === id));
});

adminRouter.delete('/opportunities/:id', (req, res) => {
  deleteOpportunity(Number(req.params.id));
  broadcast({ type: 'config' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ factors */

adminRouter.post('/factors', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const category = req.body?.category;
  if (!name) return res.status(400).json({ error: 'Factor name is required.' });
  if (category !== 'impact' && category !== 'feasibility') {
    return res.status(400).json({ error: 'Category must be impact or feasibility.' });
  }
  const id = createFactor({
    name,
    question: req.body?.question,
    category,
    inverted: req.body?.inverted === true,
    weight: Number(req.body?.weight ?? 0),
    active: req.body?.active,
    levels: normaliseLevels(req.body?.levels),
  });
  broadcast({ type: 'config' });
  res.status(201).json(listFactors().find((f) => f.id === id));
});

adminRouter.put('/factors/:id', (req, res) => {
  const id = Number(req.params.id);
  const category = req.body?.category;
  if (category != null && category !== 'impact' && category !== 'feasibility') {
    return res.status(400).json({ error: 'Category must be impact or feasibility.' });
  }
  const weight = req.body?.weight == null ? undefined : Number(req.body.weight);
  if (weight != null && (!Number.isFinite(weight) || weight < 0)) {
    return res.status(400).json({ error: 'Weight must be zero or more.' });
  }
  const ok = updateFactor(id, {
    name: req.body?.name == null ? undefined : String(req.body.name).trim(),
    question: req.body?.question,
    category,
    inverted: req.body?.inverted,
    weight,
    active: req.body?.active,
    sortOrder: req.body?.sortOrder,
    levels: req.body?.levels == null ? undefined : normaliseLevels(req.body.levels),
  });
  if (!ok) return res.status(404).json({ error: 'Factor not found.' });
  broadcast({ type: 'config' });
  res.json(listFactors().find((f) => f.id === id));
});

adminRouter.delete('/factors/:id', (req, res) => {
  deleteFactor(Number(req.params.id));
  broadcast({ type: 'config' });
  res.json({ ok: true });
});

/* -------------------------------------------------- responses and analytics */

adminRouter.get('/responses', (_req, res) => {
  res.json({ factors: listFactors(), rows: listResponseRows() });
});

adminRouter.get('/analytics', (_req, res) => {
  res.json(getAnalytics());
});

/** One row per respondent x opportunity, with raw scores and computed scores. */
adminRouter.get('/responses.csv', (_req, res) => {
  const factors = listFactors();
  const header = [
    'Respondent',
    'Email',
    'Team',
    'Business Area',
    'AI Opportunity',
    ...factors.map((f) => f.name),
    'Impact Score',
    'Feasibility Score',
    'Overall Score',
    'Submitted',
    'Updated At',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const r of listResponseRows()) {
    lines.push(
      [
        r.respondentName,
        r.respondentEmail,
        r.teamName,
        r.businessArea,
        r.opportunityName,
        ...factors.map((f) => r.scores[f.id] ?? ''),
        r.impact ?? '',
        r.feasibility ?? '',
        r.overall ?? '',
        r.submitted ? 'yes' : 'no',
        r.updatedAt,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="ai-opportunity-responses.csv"');
  res.send(`${lines.join('\n')}\n`);
});

adminRouter.post('/responses/reset', (_req, res) => {
  resetResponses();
  broadcast({ type: 'config' });
  res.json({ ok: true });
});

/** Live updates: the dashboard refetches analytics whenever a frame arrives. */
adminRouter.get('/stream', (_req, res) => {
  addClient(res);
});

/* ------------------------------------------------------------------ helpers */

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((n) => Number.isFinite(n));
}

function normaliseLevels(value: unknown): { score: number; label: string }[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((l) => ({ score: Number((l as { score: unknown }).score), label: String((l as { label?: unknown }).label ?? '') }))
    .filter((l) => Number.isFinite(l.score));
}

/** Quotes anything that would otherwise break a CSV cell. */
function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
