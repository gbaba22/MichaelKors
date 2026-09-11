/**
 * The business-user API.
 *
 * Deliberately narrow: it never returns factor weights, factor categories or
 * anyone's scores, so nothing in the assessment link can leak analytics.
 */
import { Router } from 'express';
import { broadcast } from '../events.js';
import {
  getRespondent,
  getRespondentScores,
  getScale,
  listFactors,
  listOpportunitiesForTeam,
  listTeams,
  saveResponse,
  submitAll,
  upsertRespondent,
} from '../store.js';
import type { AssessmentForm } from '../../shared/types.js';

export const publicRouter: Router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Teams for the intro screen's dropdown. */
publicRouter.get('/teams', (_req, res) => {
  res.json(listTeams(true).map((t) => ({ id: t.id, name: t.name })));
});

/**
 * Identifies the respondent and returns everything the survey needs:
 * their team's opportunities, the questions, the scale, and any answers
 * they already saved.
 */
publicRouter.post('/session', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim();
  const teamId = Number(req.body?.teamId);

  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  const team = listTeams(true).find((t) => t.id === teamId);
  if (!team) return res.status(400).json({ error: 'Please choose your team.' });

  const respondent = upsertRespondent({ name, email, teamId });
  res.json(buildForm(respondent.id));
});

/** Re-fetches the form, e.g. after a reload. */
publicRouter.get('/session/:respondentId', (req, res) => {
  const form = buildForm(Number(req.params.respondentId));
  if (!form) return res.status(404).json({ error: 'Session not found. Please start again.' });
  res.json(form);
});

/** Autosave: called whenever an answer changes. */
publicRouter.put('/session/:respondentId/responses/:opportunityId', (req, res) => {
  const respondentId = Number(req.params.respondentId);
  const opportunityId = Number(req.params.opportunityId);
  const respondent = getRespondent(respondentId);
  if (!respondent) return res.status(404).json({ error: 'Session not found. Please start again.' });

  // Only accept scores for opportunities this respondent's team was given.
  if (respondent.teamId == null) return res.status(400).json({ error: 'No team assigned.' });
  const allowed = listOpportunitiesForTeam(respondent.teamId).some((o) => o.id === opportunityId);
  if (!allowed) return res.status(403).json({ error: 'That opportunity is not assigned to your team.' });

  const validScores = new Set(getScale());
  const factorIds = new Set(listFactors(true).map((f) => f.id));
  const scores: Record<number, number> = {};
  for (const [key, value] of Object.entries(req.body?.scores ?? {})) {
    const factorId = Number(key);
    const score = Number(value);
    if (!factorIds.has(factorId)) continue;
    if (!validScores.has(score)) continue;
    scores[factorId] = score;
  }

  saveResponse({
    respondentId,
    opportunityId,
    scores,
    submitted: req.body?.submitted === true,
  });
  broadcast({ type: 'response', opportunityId, respondentId });
  res.json({ ok: true });
});

/** Final submit: marks everything answered so far as submitted. */
publicRouter.post('/session/:respondentId/submit', (req, res) => {
  const respondentId = Number(req.params.respondentId);
  if (!getRespondent(respondentId)) {
    return res.status(404).json({ error: 'Session not found. Please start again.' });
  }
  submitAll(respondentId);
  broadcast({ type: 'submitted', respondentId });
  res.json({ ok: true });
});

/**
 * Builds the survey payload. Factors are flattened into plain "questions" with
 * their rubric labels - impact vs feasibility is never exposed here, because a
 * business user shouldn't be scoring with the model's structure in mind.
 */
function buildForm(respondentId: number): AssessmentForm | undefined {
  const respondent = getRespondent(respondentId);
  if (!respondent || respondent.teamId == null) return undefined;
  const team = listTeams().find((t) => t.id === respondent.teamId);
  if (!team) return undefined;

  const saved = getRespondentScores(respondentId);

  return {
    respondent: {
      id: respondent.id,
      name: respondent.name,
      email: respondent.email,
      teamId: team.id,
      teamName: team.name,
    },
    scale: getScale(),
    questions: listFactors(true).map((f) => ({
      id: f.id,
      name: f.name,
      question: f.question,
      levels: f.levels,
    })),
    opportunities: listOpportunitiesForTeam(team.id).map((o) => ({
      id: o.id,
      name: o.name,
      businessArea: o.businessArea,
      businessGoal: o.businessGoal,
      description: o.description,
      scores: saved.get(o.id)?.scores ?? {},
      submitted: saved.get(o.id)?.submitted ?? false,
    })),
  };
}
