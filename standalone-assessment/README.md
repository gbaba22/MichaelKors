# AI Opportunity Assessment: standalone scoring tool

A single self-contained web page for scoring AI opportunities against the
Michael Kors / Capri framework. No install, no server, no database: open
`index.html` directly in a browser and it works.

## Using it

1. **Open `index.html`** (double-click it, or drag it into a browser tab).
2. **AI Discovery**: fill in the **Stakeholders for Discovery** details
   (Facilitator Name, Business Owner Name, Executive Sponsor Name,
   Business Function), pick an AI opportunity, and score all 10 factors
   using the plain-language labels shown for each level. Every option shows
   the rubric wording for that level, and each factor has an optional
   comment box for any context worth capturing alongside the score. The
   Estimated Score panel updates as you go.
3. Click **Submit Assessment**.
   - **In Chrome or Edge**, the first time you submit you'll be asked to
     choose (or create) a folder. From then on every submission is saved
     straight into two files in that folder: `ai_opportunity_assessments.json`
     (the source-of-truth record) and `ai_opportunity_assessments.csv`
     (opens directly in Excel), with no further prompts. Each submission
     appends a row; you always end up with exactly one growing json and one
     growing csv per laptop, never a pile of per-response files. The "Saved
     responses" card at the bottom of the form shows which folder you're
     connected to and how many responses have been saved. Each submission
     also downloads a small standalone `.json` for just that one response,
     as a portable copy alongside the running file (handy for emailing a
     single interview to someone without sending the whole accumulated file).
   - **In Firefox, Safari, or if you cancel/decline the folder prompt**,
     direct saving isn't available, so each submission instead downloads its
     own `.json` and `.csv` pair, exactly as before. The status card
     explains this and lets you connect a folder at any time to switch to
     direct saving for future submissions.
   - The form clears for the next interview but keeps the facilitator's
     name, since one sitting usually covers several interviews.
4. To bring many people's responses together: open the **Analyze Results**
   tab and drop in the `.json` file(s) this tool has produced: either one
   laptop's whole accumulated file, or a batch of older per-submission
   files, or a mix of both (from this laptop or emailed in from others).
   You'll see every response, a per-opportunity summary (mean Impact/
   Feasibility/Overall across however many people scored it), and an
   Impact-vs-Feasibility chart, plus buttons to export both as CSV.

Nothing here ever calls out to a network. Files stay on the machine that
generated them until someone explicitly downloads, emails, or uploads one.

### Reconnecting after a browser restart

Chrome and Edge remember which folder you connected, but for security they
need you to re-confirm access after a full browser restart (reopening a
single tab doesn't trigger this). When that happens, the status card shows
a **Reconnect** button instead of silently resuming; click it to grant
access again and pick up appending to the same file. Until you reconnect,
submissions fall back to per-response downloads rather than blocking you.

### Limitations of direct saving

- **Chrome/Edge only.** This relies on the browser's File System Access
  API, which Firefox and Safari don't implement. Those browsers (and any
  browser where you decline the folder prompt) always use the per-response
  download behavior described above; the tool works fully either way.
- **One writer at a time.** If you have the same folder connected in two
  tabs or two browser windows at once, the last one to save wins. This
  isn't engineered around, so stick to one active tab per folder.
- Cross-restart reconnection is a browser guarantee, not something this
  tool can control; if in doubt, submit one response after reconnecting and
  check the file on disk.

## Updating the framework

`index.html` is generated from the workbook plus the page template; it is
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
   layout/behaviour change; never edit `index.html` directly, it gets
   overwritten).
3. The script prints a sanity check (opportunity/factor counts, whether both
   weight blocks sum to 1.0) and warns if something looks off.

You can also swap the framework **without regenerating anything**: open the
page, expand **Data source** at the top, and load a `config.json` file
there. This replaces the in-memory framework for that browser tab only (the
bundled one is restored on reload, or via the "Use bundled framework"
button); useful for trying a draft framework before baking it into a new
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
Cost, Annual OpEx Cost**. The other six factors are higher-is-better,
including Data Readiness and Process Readiness. The form shows plain-language
labels (tailored per factor) instead of raw scores; the underlying 0/5/20/
50/100 scale is only used for the backend calculation.

Dividing by the weight sum means the model stays on 0-100 even if the
weights in a future workbook version don't add up to exactly 1.0.

Overall is currently the **plain weighted sum** (`Impact×0.6 + Feasibility×0.4`),
matching the workbook as it stands. It is not a geometric mean: a highly
lopsided opportunity (e.g. very high impact, very low feasibility) can
currently outscore a balanced one. If you want the geometric mean discussed
separately (which penalises that imbalance), change `overallScore()` in
`scripts/index_template.html` to
`Math.pow(impact, iw/(iw+fw)) * Math.pow(feasibility, fw/(iw+fw))` and rebuild.

## Files in this folder

```
index.html                          the whole tool, generated, don't hand-edit
source/
  AI_Opportunity_Assessment_v2_WIP_3.xlsx   source workbook (framework of record)
  config.json                        the framework as data (also loadable at runtime)
scripts/
  build_config.py                    regenerates config.json + index.html from the workbook
  index_template.html                the real source for index.html's markup/CSS/JS
```

## Notes and limitations

- **Saved responses are per-laptop, not shared.** Two people scoring on two
  laptops each get their own local json/csv (or their own per-submission
  downloads on Firefox/Safari); combine everyone's `.json` files in the
  Analyze Results tab (or hand them to whoever's aggregating) to see
  everything together.
- **The Analyze Results view only re-imports `.json`**, not `.csv`: the CSV
  is for opening directly in a spreadsheet, not for round-tripping through
  this tool.
- **`Facilitator`/`Business owner` fields, not a team filter.** This build
  assumes the CoE-interview flow (one facilitator scores any opportunity
  while interviewing its business owner), so the opportunity picker is never
  filtered by team. The full team list is still captured on each
  opportunity's record for reference.
- Direct-to-file saving uses the File System Access API (Chrome/Edge), with
  IndexedDB to remember the connected folder between reloads. Every browser
  tested (current Chrome/Edge/Firefox/Safari) still supports the fallback
  path (`Blob`, `URL.createObjectURL`, and `FileReader`), so the tool works
  everywhere either way. No build step, no bundler, no dependencies.
