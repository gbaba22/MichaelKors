/**
 * The scoring model must keep reproducing AI_Opportunity_Assessment_v2.xlsx:
 *
 *   Impact      = E*0.35 + F*0.35 + G*0.15 + H*0.15
 *   Feasibility = I*0.3 + J*0.2 + (100-K)*0.2 + N*0.15 + (100-L)*0.1 + (100-M)*0.05
 *   Overall     = Impact*0.6 + Feasibility*0.4
 *
 * Each case below computes the workbook formula by hand and asserts the code
 * lands on the same number.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { categoryScore, computeScores, effectiveValue, mean, round } from '../src/shared/scoring.ts';
import type { Factor, Settings } from '../src/shared/types.ts';

const SETTINGS: Settings = { impactWeight: 0.6, feasibilityWeight: 0.4 };

/** The workbook's ten factors, in its column order, with ids 1..10. */
const FACTORS: Factor[] = [
  ['Makes Money', 'impact', false, 0.35],
  ['Saves Money', 'impact', false, 0.35],
  ['Increases Loyalty', 'impact', false, 0.15],
  ['Protect/Grow Market Share', 'impact', false, 0.15],
  ['Data Readiness', 'feasibility', false, 0.3],
  ['Process Readiness', 'feasibility', false, 0.2],
  ['Implementation/System Complexity', 'feasibility', true, 0.2],
  ['Ease of MVP', 'feasibility', false, 0.15],
  ['Change Risk', 'feasibility', true, 0.1],
  ['Cost', 'feasibility', true, 0.05],
].map(([name, category, inverted, weight], i) => ({
  id: i + 1,
  name: name as string,
  question: '',
  category: category as Factor['category'],
  inverted: inverted as boolean,
  weight: weight as number,
  active: true,
  sortOrder: i,
  levels: [],
}));

/** Scores keyed by factor id, given in workbook column order E..N. */
const scoresOf = (...values: number[]) =>
  Object.fromEntries(values.map((v, i) => [i + 1, v])) as Record<number, number>;

/**
 * The workbook's own arithmetic, written out longhand.
 *
 * Note the column order: the scores arrive in factor order, and the workbook's
 * feasibility columns are not in that order - Ease of MVP is column N, which
 * sits between Complexity (K) and Change Risk (L) in the factor list.
 */
function excel(v: number[]) {
  const [E, F, G, H, I, J, K, N, L, M] = v;
  const impact = E * 0.35 + F * 0.35 + G * 0.15 + H * 0.15;
  const feasibility =
    I * 0.3 + J * 0.2 + (100 - K) * 0.2 + N * 0.15 + (100 - L) * 0.1 + (100 - M) * 0.05;
  return { impact, feasibility, overall: impact * 0.6 + feasibility * 0.4 };
}

const CASES: Record<string, number[]> = {
  'mid-range scores': [75, 50, 30, 15, 75, 50, 30, 50, 15, 5],
  'floor of the scale': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'ceiling of the scale': [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
  'best possible opportunity': [100, 100, 100, 100, 100, 100, 0, 100, 0, 0],
  'every scale point used': [0, 5, 15, 30, 50, 75, 100, 0, 5, 15],
  'inverted factors at their worst': [50, 50, 50, 50, 50, 50, 100, 50, 100, 100],
};

for (const [label, values] of Object.entries(CASES)) {
  test(`matches the workbook: ${label}`, () => {
    const expected = excel(values);
    const actual = computeScores(FACTORS, scoresOf(...values), SETTINGS);
    assert.ok(actual.impact != null && actual.feasibility != null && actual.overall != null);
    assert.ok(Math.abs(actual.impact - expected.impact) < 1e-9, `impact: ${actual.impact}`);
    assert.ok(
      Math.abs(actual.feasibility - expected.feasibility) < 1e-9,
      `feasibility: ${actual.feasibility}`,
    );
    assert.ok(Math.abs(actual.overall - expected.overall) < 1e-9, `overall: ${actual.overall}`);
  });
}

test('the worked example from the plan comes out at 50.5 / 67.25 / 57.2', () => {
  const actual = computeScores(FACTORS, scoresOf(75, 50, 30, 15, 75, 50, 30, 50, 15, 5), SETTINGS);
  assert.equal(round(actual.impact), 50.5);
  assert.equal(actual.feasibility, 67.25);
  assert.equal(round(actual.overall), 57.2);
});

test('inverted factors flip the raw score, plain ones do not', () => {
  assert.equal(effectiveValue({ inverted: true }, 75), 25);
  assert.equal(effectiveValue({ inverted: false }, 75), 75);
  assert.equal(effectiveValue({ inverted: true }, 0), 100);
});

test('weights that do not add up to 100% still produce a 0-100 score', () => {
  // Two impact factors at 10% each: the result is their mean, not a tenth of it.
  const factors: Factor[] = FACTORS.slice(0, 2).map((f) => ({ ...f, weight: 0.1 }));
  const score = categoryScore(factors, scoresOf(100, 50), 'impact');
  assert.equal(score, 75);
});

test('inactive factors are excluded from their category', () => {
  const factors = FACTORS.map((f) => (f.name === 'Saves Money' ? { ...f, active: false } : f));
  const scores = scoresOf(100, 0, 100, 100, 0, 0, 0, 0, 0, 0);
  // Without Saves Money the impact weights are 0.35 + 0.15 + 0.15 = 0.65, all scored 100.
  assert.equal(categoryScore(factors, scores, 'impact'), 100);
});

test('unanswered factors are skipped rather than counted as zero', () => {
  // Only Makes Money answered: impact is that factor's score, not a weighted fraction.
  assert.equal(categoryScore(FACTORS, { 1: 50 }, 'impact'), 50);
});

test('a category with no answers is null, and that makes overall null', () => {
  const result = computeScores(FACTORS, { 1: 50 }, SETTINGS);
  assert.equal(result.impact, 50);
  assert.equal(result.feasibility, null);
  assert.equal(result.overall, null);
});

test('an opportunity score is the mean of each respondent, not of raw answers', () => {
  const a = computeScores(FACTORS, scoresOf(100, 100, 100, 100, 100, 100, 0, 100, 0, 0), SETTINGS);
  const b = computeScores(FACTORS, scoresOf(0, 0, 0, 0, 0, 0, 100, 0, 100, 100), SETTINGS);
  assert.equal(a.overall, 100);
  assert.equal(b.overall, 0);
  assert.equal(mean([a.overall, b.overall]), 50);
});

test('mean ignores missing values instead of treating them as zero', () => {
  assert.equal(mean([10, null, 20, undefined]), 15);
  assert.equal(mean([null, undefined]), null);
});

test('the shipped seed data carries the workbook weights and the 7-point scale', () => {
  const catalog = JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../seed/catalog.json'), 'utf8'),
  ) as {
    scale: number[];
    overall: { impactWeight: number; feasibilityWeight: number };
    factors: { name: string; category: string; inverted: boolean; weight: number }[];
    opportunities: unknown[];
    teams: unknown[];
  };

  assert.deepEqual(catalog.scale, [0, 5, 15, 30, 50, 75, 100]);
  assert.deepEqual(catalog.overall, { impactWeight: 0.6, feasibilityWeight: 0.4 });
  assert.equal(catalog.opportunities.length, 36);
  assert.ok(catalog.teams.length > 0);

  const sum = (category: string) =>
    catalog.factors
      .filter((f) => f.category === category)
      .reduce((total, f) => total + f.weight, 0);
  assert.ok(Math.abs(sum('impact') - 1) < 1e-9, 'impact weights total 100%');
  assert.ok(Math.abs(sum('feasibility') - 1) < 1e-9, 'feasibility weights total 100%');

  const inverted = catalog.factors.filter((f) => f.inverted).map((f) => f.name).sort();
  assert.deepEqual(inverted, ['Change Risk', 'Cost', 'Implementation/System Complexity']);
});
