/** Types shared by the server and both client apps. */

export type FactorCategory = 'impact' | 'feasibility';

export interface FactorLevel {
  score: number;
  label: string;
}

export interface Factor {
  id: number;
  name: string;
  question: string;
  category: FactorCategory;
  /** When true a high raw score is bad (cost, risk, complexity) and is flipped to 100 - score. */
  inverted: boolean;
  weight: number;
  active: boolean;
  sortOrder: number;
  levels: FactorLevel[];
}

export interface Team {
  id: number;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface Opportunity {
  id: number;
  name: string;
  businessArea: string;
  businessGoal: string;
  description: string;
  active: boolean;
  sortOrder: number;
  teamIds: number[];
}

export interface Settings {
  impactWeight: number;
  feasibilityWeight: number;
}

/** What a business user needs to render the survey. No weights, no categories. */
export interface AssessmentForm {
  respondent: { id: number; name: string; email: string; teamId: number; teamName: string };
  scale: number[];
  questions: {
    id: number;
    name: string;
    question: string;
    levels: FactorLevel[];
  }[];
  opportunities: {
    id: number;
    name: string;
    businessArea: string;
    businessGoal: string;
    description: string;
    /** Previously saved answers, factorId -> score, so a returning user resumes. */
    scores: Record<number, number>;
    submitted: boolean;
  }[];
}

export interface ScoreTriplet {
  impact: number | null;
  feasibility: number | null;
  overall: number | null;
}

/** One respondent's completed scoring of one opportunity, as the admin sees it. */
export interface ResponseRow extends ScoreTriplet {
  responseId: number;
  respondentId: number;
  respondentName: string;
  respondentEmail: string;
  teamId: number | null;
  teamName: string;
  opportunityId: number;
  opportunityName: string;
  businessArea: string;
  submittedAt: string | null;
  updatedAt: string;
  submitted: boolean;
  scores: Record<number, number>;
}

/** Opportunity-level aggregate: the mean of each respondent's computed scores. */
export interface OpportunityAggregate extends ScoreTriplet {
  opportunityId: number;
  name: string;
  businessArea: string;
  businessGoal: string;
  teamNames: string[];
  respondentCount: number;
  /** factorId -> mean raw score across respondents. */
  factorMeans: Record<number, number>;
}

export interface AnalyticsPayload {
  factors: Factor[];
  settings: Settings;
  aggregates: OpportunityAggregate[];
  totals: { respondents: number; responses: number; submitted: number };
  generatedAt: string;
}
