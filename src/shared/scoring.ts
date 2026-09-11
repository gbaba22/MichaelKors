/**
 * The scoring model, kept in one place so the server's analytics and any client
 * preview can never drift apart.
 *
 * It reproduces the formulas in AI_Opportunity_Assessment_v2.xlsx:
 *
 *   Impact      = MakesMoney*0.35 + SavesMoney*0.35 + Loyalty*0.15 + MarketShare*0.15
 *   Feasibility = Data*0.3 + Process*0.2 + (100-Complexity)*0.2
 *                 + EaseOfMVP*0.15 + (100-ChangeRisk)*0.1 + (100-Cost)*0.05
 *   Overall     = Impact*0.6 + Feasibility*0.4
 *
 * Two generalisations, so the admin can reconfigure the model without breaking it:
 *
 *   - "Inverted" is a property of a factor rather than something hard-coded into
 *     the feasibility formula, so an admin can add or remove inverted factors.
 *   - Each weighted sum is divided by the sum of the weights it used. With the
 *     workbook's weights (which total 100% in every group) that divisor is 1 and
 *     the results are identical; with admin-edited weights that don't total 100%
 *     the score still lands on 0-100 instead of silently rescaling.
 */
import type { Factor, FactorCategory, ScoreTriplet, Settings } from './types.js';

/** A factor's contribution after inversion: for cost/risk/complexity, less is better. */
export function effectiveValue(factor: Pick<Factor, 'inverted'>, rawScore: number): number {
  return factor.inverted ? 100 - rawScore : rawScore;
}

/**
 * Weighted mean of one category's factors.
 * Returns null when no factor in the category has been answered.
 */
export function categoryScore(
  factors: Factor[],
  scores: Record<number, number>,
  category: FactorCategory,
): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const factor of factors) {
    if (!factor.active || factor.category !== category) continue;
    const raw = scores[factor.id];
    if (raw == null || Number.isNaN(raw)) continue;
    weighted += effectiveValue(factor, raw) * factor.weight;
    weightSum += factor.weight;
  }
  if (weightSum <= 0) return null;
  return weighted / weightSum;
}

/**
 * Combines impact and feasibility into the overall score.
 * Returns null unless both sides have a score.
 */
export function overallScore(
  impact: number | null,
  feasibility: number | null,
  settings: Settings,
): number | null {
  if (impact == null || feasibility == null) return null;
  const weightSum = settings.impactWeight + settings.feasibilityWeight;
  if (weightSum <= 0) return null;
  return (impact * settings.impactWeight + feasibility * settings.feasibilityWeight) / weightSum;
}

/** Impact, feasibility and overall for a single set of raw factor scores. */
export function computeScores(
  factors: Factor[],
  scores: Record<number, number>,
  settings: Settings,
): ScoreTriplet {
  const impact = categoryScore(factors, scores, 'impact');
  const feasibility = categoryScore(factors, scores, 'feasibility');
  return { impact, feasibility, overall: overallScore(impact, feasibility, settings) };
}

/** Mean of the values that are present; null if there are none. */
export function mean(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null && !Number.isNaN(v));
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/** Rounds for display without pretending to a precision the inputs don't have. */
export function round(value: number | null, digits = 1): number | null {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
