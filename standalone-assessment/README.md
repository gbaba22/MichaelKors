# AI Opportunity Assessment — standalone scoring tool

A single self-contained web page for scoring AI opportunities against the
Michael Kors / Capri framework. No install, no server, no database — open
`index.html` directly in a browser and it works.

## Using it

1. **Open `index.html`** (double-click it, or drag it into a browser tab).
2. **Score an Opportunity** — fill in the facilitator and business owner
   details, pick an AI opportunity, and score all 10 factors on the 0/5/20/50/100
   scale. Every option shows the rubric wording for that level. The live
   score panel updates as you go.
3. Click **Save & download this response**. Two files download automatically:
   a `.json` (the source-of-truth record) and a `.csv` (opens directly in
   Excel). The form clears for the next interview but keeps the facilitator's
   name and email, since one sitting usually covers several interviews.
4. Everything you submit in a browser session is also listed under **This
   browser's session**, with a button to download it all as one CSV — handy
   at the end of a day of interviews. This uses `localStorage`, so it's
   private to that browser and doesn't survive clearing site data.
5. To bring many people's responses together: open the **Combine Results**
   tab and drop in any number of the `.json` files this tool has produced
   (from this browser or emailed in from others). You'll see every response,
   a per-opportunity summary (mean Impact/Feasibility/Overall across however
   many people scored it), and an Impact-vs-Feasibility chart — plus buttons
   to export both as CSV.

Nothing here ever calls out to a network. Files stay on the machine that
generated them until someone explicitly downloads, emails, or uploads one.

## Updating the framework

`index.html` is generated from the workbook plus the page template — it is
not meant to be hand-edited. To pick up changes to factors, weights, the
rubric, or the opportunity catalog:

1. Edit `source/AI_Opportunity_Assessment_v2_WIP_3.xlsx` (or replace it with a
   newer version of the workbook, same filename or pass a path explicitly).
2. Regenerate:
   ```bash
   pip install openpyxl   # if not already available
   python3 scripts/build_config.py
   # or: python3 scripts/build_config.py path/to/a-different-workbook.xlsx
   ```
   This writes `source/config.json` and rewrites `index.html` (rendered from
   `scripts/index_template.html`, which *is* the file to hand-edit for any
   layout/behaviour change — never edit `index.html` directly, it gets
   overwritten).
3. The script prints a sanity check (opportunity/factor counts, whether both
   weight blocks sum to 1.0) and warns if something looks off.

You can also swap the framework **without regenerating anything**: open the
page, expand **Data source** at the top, and load a `config.json` file
there. This replaces the in-memory framework for that browser tab only (the
bundled one is restored on reload, or via the "Use bundled framework"
button) — useful for trying a draft framework before baking it into a new
`index.html`.

## How the scores are calculated

Faithful to the `Weights` and `Rubric` sheets in the source workbook:

```
Impact      = Σ(score × weight) / Σ(weight)      over the 4 impact factors
Feasibility = Σ(effective × weight) / Σ(weight)   over the 6 feasibility factors
                where effective = inverted ? 100 - score : score
Overall     = (Impact × impactWeight + Feasibility × feasibilityWeight)
              / (impactWeight + feasibilityWeight)
```

Four feasibility factors are inverted (a high raw score is worse, so it's
flipped before weighting): **Implementation Complexity, Risk Profile, CapEx
Cost, Annual OpEx Cost**. Every inverted factor is labelled "higher = worse"
in the UI. The other six factors are higher-is-better, including Data
Readiness and Process Readiness.

Dividing by the weight sum means the model stays on 0–100 even if the
weights in a future workbook version don't add up to exactly 1.0.

Overall is currently the **plain weighted sum** (`Impact×0.6 + Feasibility×0.4`),
matching the workbook as it stands. It is not a geometric mean — a highly
lopsided opportunity (e.g. very high impact, very low feasibility) can
currently outscore a balanced one. If you want the geometric mean discussed
separately (which penalises that imbalance), change `overallScore()` in
`scripts/index_template.html` to
`Math.pow(impact, iw/(iw+fw)) * Math.pow(feasibility, fw/(iw+fw))` and rebuild.

## Files in this folder

```
index.html                          the whole tool — generated, don't hand-edit
source/
  AI_Opportunity_Assessment_v2_WIP_3.xlsx   source workbook (framework of record)
  config.json                        the framework as data (also loadable at runtime)
scripts/
  build_config.py                    regenerates config.json + index.html from the workbook
  index_template.html                the real source for index.html's markup/CSS/JS
```

## Notes and limitations

- **Session log is per-browser, not shared.** Two people scoring on two
  laptops each get their own local session; combine their downloaded `.json`
  files in the Combine Results tab (or hand them to whoever's aggregating)
  to see everything together.
- **The Combine view only re-imports `.json`**, not `.csv` — the CSV is for
  opening directly in a spreadsheet, not for round-tripping through this
  tool.
- **`Facilitator`/`Business owner` fields, not a team filter.** This build
  assumes the CoE-interview flow (one facilitator scores any opportunity
  while interviewing its business owner), so the opportunity picker is never
  filtered by team. The full team list is still captured on each
  opportunity's record for reference.
- Every browser tested (current Chrome/Edge/Firefox/Safari) supports
  everything this page uses — `Blob`, `URL.createObjectURL`, `FileReader`,
  and `localStorage`. No build step, no bundler, no dependencies.
