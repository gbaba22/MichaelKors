#!/usr/bin/env python3
"""
Regenerates source/config.json and index.html from the source workbook.

    python3 scripts/build_config.py [path/to/workbook.xlsx]

The workbook (default: source/AI_Opportunity_Assessment_v2_WIP_3.xlsx) is the
system of record for the assessment model:

  - "Weights"  -> which factors exist, their category (impact/feasibility)
                  and their weight, plus the Impact/Feasibility split for
                  the overall AI Opportunity Score.
  - "Rubric"   -> the scale points and the label + question for each factor
                  at each point.
  - "Assessment Template" -> the AI Opportunity catalog (columns A-D) and,
                  by column position, which factor each scoring column is
                  (columns E-M; column N is unused).

Run this again any time the workbook changes. It writes:
  - source/config.json   (the framework as data, also loadable at runtime via
                         the page's "Load a different data file" control)
  - index.html          (rendered from scripts/index_template.html with the
                         same JSON embedded inline, so the page also works
                         standalone with zero setup)

Column-position mapping, not name matching
-------------------------------------------
The three sheets spell factor names slightly differently (e.g. the
Assessment Template header for "Implementation Complexity" differs from the
Rubric/Weights sheets by a stray "/" and line break). Matching on text would
be brittle, so this script relies on the one thing that IS guaranteed: all
three sheets list the nine factors in the same fixed order -
    Financial Impact, Process Efficiency, Customer Experience, Strategic
    Priority  (impact, in that order)
    Data Readiness, Process Readiness, Implementation Complexity,
    Risk Profile, CapEx Cost  (feasibility, in that order)
which is also the order of Assessment Template columns E-M. If a future
version of the workbook reorders factors, this script's FACTOR_ORDER table
below is the one place to update.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_WORKBOOK = ROOT / "source" / "AI_Opportunity_Assessment_v2_WIP_3.xlsx"
CONFIG_OUT = ROOT / "source" / "config.json"
TEMPLATE_IN = Path(__file__).resolve().parent / "index_template.html"
INDEX_OUT = ROOT / "index.html"

# Fixed factor order shared by Weights (row order), Rubric (row order) and
# Assessment Template (column order E..N). `key` is used as a stable JSON
# key / CSV header; `inverted` reflects the (100-x) terms in the Feasibility
# formula, which is the only place the workbook records this.
FACTOR_ORDER = [
    {"key": "financial_impact", "category": "impact", "inverted": False, "column": "E"},
    {"key": "process_efficiency", "category": "impact", "inverted": False, "column": "F"},
    {"key": "customer_experience", "category": "impact", "inverted": False, "column": "G"},
    {"key": "strategic_priority", "category": "impact", "inverted": False, "column": "H"},
    {"key": "data_readiness", "category": "feasibility", "inverted": False, "column": "I"},
    {"key": "process_readiness", "category": "feasibility", "inverted": False, "column": "J"},
    {"key": "implementation_complexity", "category": "feasibility", "inverted": True, "column": "K"},
    {"key": "risk_profile", "category": "feasibility", "inverted": True, "column": "L"},
    {"key": "capex_cost", "category": "feasibility", "inverted": True, "column": "M"},
]

# Curated "Business Function" options for the interview form's autocomplete
# (sorted alphabetically when written out - see build_config()).
BUSINESS_FUNCTIONS = [
    "Leadership",
    "Legal",
    "Planning & Procurement",
    "Supply Chain",
    "Marketing & Branding",
    "Product & Engineering",
    "Finance",
    "Merchandising",
    "Store Operations",
    "eCommerce",
    "Customer Care",
    "Other",
]


def split_name(raw: str) -> tuple[str, str]:
    """Splits 'Financial Impact \\n(revenue/margin...)' into name + subtitle."""
    parts = [p.strip() for p in str(raw).split("\n") if p.strip()]
    name = parts[0]
    subtitle = " ".join(parts[1:]).strip()
    subtitle = subtitle.strip("()")
    return name, subtitle


def as_number(value) -> float:
    """Rubric/Weights sometimes store a number as text (e.g. the '100' scale
    point); coerce defensively rather than trusting the cell type."""
    if isinstance(value, (int, float)):
        return value
    return float(str(value).strip().replace(",", ""))


def read_weights(wb) -> tuple[list[float], dict]:
    ws = wb["Weights"]
    rows = [
        (r[0].value, r[1].value)
        for r in ws.iter_rows(min_row=1)
        if r[0].value is not None
    ]
    weights: list[float] = []
    overall = {}
    section = None
    for label, value in rows:
        label_norm = str(label).strip().lower()
        if label_norm in ("impact score", "feasibility score") and value is None:
            section = "factors"
            continue
        if label_norm == "ai opportunity score" and value is None:
            section = "overall"
            continue
        if section == "factors" and value is not None:
            weights.append(as_number(value))
        elif section == "overall" and value is not None:
            if label_norm == "impact score":
                overall["impactWeight"] = as_number(value)
            elif label_norm == "feasibility score":
                overall["feasibilityWeight"] = as_number(value)
    return weights, overall


def read_rubric(wb) -> tuple[list[int], list[dict]]:
    ws = wb["Rubric"]
    header = [ws.cell(1, c).value for c in range(3, 8)]  # C1:G1
    scale = [int(as_number(v)) for v in header]

    factors = []
    for row in range(2, 11):  # 9 factor rows
        raw_name = ws.cell(row, 1).value
        question = ws.cell(row, 2).value
        if raw_name is None:
            continue
        name, subtitle = split_name(raw_name)
        levels = []
        for i, score in enumerate(scale):
            label = ws.cell(row, 3 + i).value
            levels.append({"score": score, "label": (label or "").strip()})
        factors.append({"name": name, "subtitle": subtitle, "question": (question or "").strip(), "levels": levels})
    return scale, factors


def read_opportunities(wb) -> list[dict]:
    ws = wb["Assessment Template"]
    opportunities = []
    opp_id = 1
    for row in range(3, ws.max_row + 1):
        business_area = ws.cell(row, 1).value
        name = ws.cell(row, 2).value
        goal = ws.cell(row, 3).value
        team_cell = ws.cell(row, 4).value
        # Rows without a Business Area AND Relevant Team are scratch entries
        # left over from drafting (e.g. "Password Resets", "IMAI POC") -
        # not real catalog opportunities, so they're excluded.
        if not business_area or not team_cell:
            continue
        teams = [t.strip() for t in re.split(r"[,/]", str(team_cell)) if t.strip()]
        opportunities.append(
            {
                "id": opp_id,
                "businessArea": str(business_area).strip(),
                "name": str(name).strip(),
                "businessGoal": (str(goal).strip() if goal else ""),
                "relevantTeams": teams,
            }
        )
        opp_id += 1
    return opportunities


def build_config(workbook_path: Path) -> dict:
    wb = openpyxl.load_workbook(workbook_path, data_only=False)

    weights, overall = read_weights(wb)
    scale, rubric_factors = read_rubric(wb)
    opportunities = read_opportunities(wb)

    if len(weights) != len(FACTOR_ORDER):
        raise SystemExit(
            f"Expected {len(FACTOR_ORDER)} weights from the Weights sheet, found {len(weights)}. "
            "The workbook's factor list has changed - update FACTOR_ORDER in this script."
        )
    if len(rubric_factors) != len(FACTOR_ORDER):
        raise SystemExit(
            f"Expected {len(FACTOR_ORDER)} rows on the Rubric sheet, found {len(rubric_factors)}. "
            "The workbook's factor list has changed - update FACTOR_ORDER in this script."
        )

    factors = []
    for order, weight, rubric in zip(FACTOR_ORDER, weights, rubric_factors):
        factors.append(
            {
                "key": order["key"],
                "name": rubric["name"],
                "subtitle": rubric["subtitle"],
                "question": rubric["question"],
                "category": order["category"],
                "inverted": order["inverted"],
                "weight": weight,
                "column": order["column"],
                "levels": rubric["levels"],
            }
        )

    impact_sum = sum(f["weight"] for f in factors if f["category"] == "impact")
    feas_sum = sum(f["weight"] for f in factors if f["category"] == "feasibility")

    # Fixed, curated list for the "Business Function" field's autocomplete -
    # not derived from the workbook, so it stays stable regardless of what
    # teams happen to appear in the opportunity catalog.
    teams = sorted(BUSINESS_FUNCTIONS, key=str.lower)
    business_areas = sorted({o["businessArea"] for o in opportunities})

    return {
        "generatedFrom": workbook_path.name,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "generatedBy": "standalone-assessment/scripts/build_config.py",
        "scale": scale,
        "overall": overall,
        "factors": factors,
        "opportunities": opportunities,
        "teams": teams,
        "businessAreas": business_areas,
        "checks": {
            "impactWeightSum": round(impact_sum, 6),
            "feasibilityWeightSum": round(feas_sum, 6),
            "opportunityCount": len(opportunities),
        },
    }


def render_index(config: dict) -> None:
    template = TEMPLATE_IN.read_text(encoding="utf-8")
    payload = json.dumps(config, indent=2)
    if "__CONFIG_JSON__" not in template:
        raise SystemExit(f"{TEMPLATE_IN} is missing the __CONFIG_JSON__ placeholder.")
    rendered = template.replace("__CONFIG_JSON__", payload)
    INDEX_OUT.write_text(rendered, encoding="utf-8")


def main():
    workbook_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WORKBOOK
    config = build_config(workbook_path)

    CONFIG_OUT.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    render_index(config)

    print(f"wrote {CONFIG_OUT.relative_to(ROOT.parent)}")
    print(f"wrote {INDEX_OUT.relative_to(ROOT.parent)}")
    print(
        f"  {config['checks']['opportunityCount']} opportunities, "
        f"{len(config['factors'])} factors, "
        f"impact weights sum to {config['checks']['impactWeightSum']}, "
        f"feasibility weights sum to {config['checks']['feasibilityWeightSum']}, "
        f"overall = impact*{config['overall']['impactWeight']} + feasibility*{config['overall']['feasibilityWeight']}"
    )
    if abs(config["checks"]["impactWeightSum"] - 1.0) > 1e-6:
        print("  WARNING: impact weights do not sum to 1.0")
    if abs(config["checks"]["feasibilityWeightSum"] - 1.0) > 1e-6:
        print("  WARNING: feasibility weights do not sum to 1.0")


if __name__ == "__main__":
    main()
