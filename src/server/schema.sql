-- Configuration -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS opportunities (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  business_area  TEXT    NOT NULL DEFAULT '',
  business_goal  TEXT    NOT NULL DEFAULT '',
  description    TEXT    NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- One opportunity may be scored by several teams.
CREATE TABLE IF NOT EXISTS opportunity_teams (
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  team_id        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, team_id)
);

-- Factors are rows, not columns, so the admin can add, remove or reweight them
-- without a schema change.
CREATE TABLE IF NOT EXISTS factors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  question   TEXT    NOT NULL DEFAULT '',
  category   TEXT    NOT NULL CHECK (category IN ('impact', 'feasibility')),
  -- 1 when a high raw score is unfavourable (cost, risk, complexity).
  inverted   INTEGER NOT NULL DEFAULT 0,
  weight     REAL    NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- The rubric: what each point of the scale means for a given factor.
CREATE TABLE IF NOT EXISTS factor_levels (
  factor_id INTEGER NOT NULL REFERENCES factors(id) ON DELETE CASCADE,
  score     INTEGER NOT NULL,
  label     TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (factor_id, score)
);

-- The 7-point exponential scale (0, 5, 15, 30, 50, 75, 100 by default).
CREATE TABLE IF NOT EXISTS scale_points (
  score      INTEGER PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Responses ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS respondents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  -- Lower-cased on write so a returning user resumes their own answers.
  email      TEXT NOT NULL UNIQUE,
  team_id    INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS responses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  respondent_id  INTEGER NOT NULL REFERENCES respondents(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  submitted      INTEGER NOT NULL DEFAULT 0,
  submitted_at   TEXT,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (respondent_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS response_scores (
  response_id INTEGER NOT NULL REFERENCES responses(id) ON DELETE CASCADE,
  factor_id   INTEGER NOT NULL REFERENCES factors(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  PRIMARY KEY (response_id, factor_id)
);

CREATE INDEX IF NOT EXISTS idx_responses_opportunity ON responses(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_responses_respondent  ON responses(respondent_id);
CREATE INDEX IF NOT EXISTS idx_scores_response       ON response_scores(response_id);
CREATE INDEX IF NOT EXISTS idx_opp_teams_team        ON opportunity_teams(team_id);
