# AI Capability Assessment

An internal tool for scoring and prioritising AI opportunities.

- **Business users** open one link, enter their name, email and team, and score the AI
  opportunities assigned to their team against a 7-point scale. They never see a score, a weight
  or a chart.
- **Admins** open `/admin`, configure teams, opportunities, factors and weights, read every
  individual response, and watch an Impact vs Feasibility map that updates the moment anyone
  submits.

The scoring model is taken from `seed/AI_Opportunity_Assessment_v2.xlsx` and reproduces its
formulas exactly.

## Running it

Requires **Node 22.5 or newer** (the database uses Node's built-in `node:sqlite`).

```bash
npm install
cp .env.example .env        # then set ADMIN_PASSWORD and SESSION_SECRET
npm run build
npm start
```

| Link | Who it's for |
|---|---|
| `http://localhost:3000/` | Business users — share this one |
| `http://localhost:3000/admin` | Admin console (asks for `ADMIN_PASSWORD`) |

On first boot the database is created and seeded from `seed/catalog.json`: 10 factors with their
weights and full rubric, 36 AI opportunities, and the 16 teams named in the workbook.

For development with hot reload:

```bash
npm run dev                 # server on :3000, client on :5173 (proxies /api)
```

## Configuration

All of it is optional except the password. See `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | — | Required to use `/admin`. Without it the admin link is unusable. |
| `SESSION_SECRET` | random per boot | Signs the admin cookie. Set it, or admins are signed out on restart. |
| `PORT` | `3000` | Port to listen on. |
| `DATABASE_FILE` | `./data/assessment.db` | Where the data lives. |
| `COOKIE_SECURE` | `false` | Set `true` when serving over HTTPS. |

### The database is one file

Everything — configuration and responses — lives in `data/assessment.db` (plus the `-wal`/`-shm`
files SQLite keeps beside it). To back it up, copy those files. To start fresh, delete them and
restart. There is no database server to run.

## The scoring model

Respondents pick one of seven points — **0, 5, 15, 30, 50, 75, 100** — for each factor. The scale
is exponential so the top of it means something exceptional, and each point carries wording
specific to that factor (Data Readiness at 50 reads "Most available"; at 100, "Production ready").

Factors are split into impact and feasibility, each with a weight:

| Impact | | Feasibility | |
|---|---|---|---|
| Makes Money | 35% | Data Readiness | 30% |
| Saves Money | 35% | Process Readiness | 20% |
| Increases Loyalty | 15% | Implementation/System Complexity | 20% *(inverted)* |
| Protect/Grow Market Share | 15% | Ease of MVP | 15% |
| | | Change Risk | 10% *(inverted)* |
| | | Cost | 5% *(inverted)* |

An **inverted** factor is one where a high score is bad — cost, risk, complexity — so its
contribution is `100 - score`.

```
Impact      = Σ(score × weight) / Σ(weight)   over impact factors
Feasibility = Σ(score × weight) / Σ(weight)   over feasibility factors   (inverted factors flipped)
Overall     = Impact × 60% + Feasibility × 40%
```

Dividing by the weight sum is the one generalisation over the workbook: with the seeded weights
(which total 100% in each group) the divisor is 1 and the results are identical, but it means an
admin who reweights to something that doesn't total 100% still gets a 0–100 score instead of a
silently rescaled one. `tests/scoring.test.ts` asserts the match against the workbook formulas.

An **opportunity's** score is the mean of each respondent's computed scores — so someone who
answered every factor counts the same as anyone else, regardless of how many factors there are.

## What the admin can configure

- **Teams** — who can take the assessment, and which name appears in the dropdown.
- **AI Opportunities** — the catalog, each mapped to one *or more* teams. An opportunity with no
  team is shown to nobody.
- **Factors & Weights** — add, remove, rename or reweight any factor; move it between impact and
  feasibility; mark it inverted; edit its rubric wording for every point of the scale; set the
  Impact/Feasibility split for the overall score; change the scale points themselves.

Changing weights re-derives every score immediately — the raw answers are what's stored, not the
computed scores.

## Project layout

```
src/shared/scoring.ts     the scoring model, used by the server and the client
src/server/               Express API, SQLite access, seeding, SSE
src/client/assess/        the business-user assessment
src/client/admin/         the admin console and the Impact vs Feasibility chart
seed/catalog.json         seed data, generated from the workbook
scripts/import-xlsx.mjs   regenerates seed/catalog.json from the workbook
tests/scoring.test.ts     scoring asserted against the workbook's formulas
tests/e2e.mjs             optional browser walk-through of both flows
```

To change the seed data, edit the workbook and run `npm run import:xlsx`. Seeding only ever fills
empty tables, so re-running it never overwrites configuration an admin has since edited.

## Tests

```bash
npm test          # scoring, asserted against the workbook formulas
npm run typecheck # client and server
```

`tests/e2e.mjs` drives both flows in a real browser — a business user completing and submitting an
assessment, the admin seeing those answers, and the chart updating from a second submission with
no reload. It needs Playwright, which is not a project dependency:

```bash
npm install --no-save playwright && npx playwright install chromium
npm start &
BASE=http://localhost:3000 OUT=/tmp/shots node tests/e2e.mjs
```

## Notes

- `node:sqlite` prints an experimental warning on Node 22, which is why `npm start` passes
  `--no-warnings`. It is stable from Node 24 onward.
- Live updates use Server-Sent Events with a 15-second poll behind them, so the dashboard still
  refreshes if a proxy buffers or drops the stream.
- Admin auth is a single shared password, deliberately — there is one admin role and no user
  directory to integrate with. Put the app behind your normal network controls as well.
