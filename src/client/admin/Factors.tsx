import { useState } from 'react';
import { api } from '../api.js';
import type { Factor, FactorCategory } from '../../shared/types.js';
import type { AdminConfig } from './AdminApp.js';

interface Props {
  config: AdminConfig;
  reload: () => Promise<void>;
}

/**
 * The scoring model: which factors exist, which side they sit on, how much each
 * one counts, and how impact and feasibility combine into the overall score.
 */
export function Factors({ config, reload }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function guard(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const impact = config.factors.filter((f) => f.category === 'impact');
  const feasibility = config.factors.filter((f) => f.category === 'feasibility');

  return (
    <div className="stack">
      {error && <p className="notice error">{error}</p>}

      <OverallWeights config={config} guard={guard} busy={busy} />

      <FactorGroup
        title="Impact factors"
        blurb="How much value the opportunity creates. Weights are relative — they are normalised, so they don't have to add up to exactly 100%."
        category="impact"
        factors={impact}
        scale={config.scale}
        expanded={expanded}
        setExpanded={setExpanded}
        guard={guard}
        busy={busy}
      />

      <FactorGroup
        title="Feasibility factors"
        blurb="How readily it can be delivered. Mark cost, risk and complexity as inverted — a high score there counts against feasibility."
        category="feasibility"
        factors={feasibility}
        scale={config.scale}
        expanded={expanded}
        setExpanded={setExpanded}
        guard={guard}
        busy={busy}
      />

      <ScaleEditor config={config} guard={guard} busy={busy} />
    </div>
  );
}

/* ---------------------------------------------------------- overall weights */

function OverallWeights({
  config,
  guard,
  busy,
}: {
  config: AdminConfig;
  guard: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [impactWeight, setImpactWeight] = useState(Math.round(config.settings.impactWeight * 100));

  // The two always trade off against each other, so one slider drives both.
  const feasibilityWeight = 100 - impactWeight;
  const dirty = impactWeight !== Math.round(config.settings.impactWeight * 100);

  return (
    <div className="card stack">
      <div>
        <h2>Overall score</h2>
        <p className="small muted">
          Overall = Impact × {impactWeight}% + Feasibility × {feasibilityWeight}%
        </p>
      </div>
      <div className="row" style={{ gap: 16 }}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={impactWeight}
          aria-label="Impact weight in the overall score"
          onChange={(e) => setImpactWeight(Number(e.target.value))}
          style={{ flex: 1, minWidth: 220, accentColor: 'var(--accent)' }}
        />
        <span className="weight-summary">
          <span style={{ color: 'var(--series-impact)' }}>Impact {impactWeight}%</span>
          <span className="muted">/</span>
          <span style={{ color: 'var(--series-feasibility)' }}>
            Feasibility {feasibilityWeight}%
          </span>
        </span>
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() =>
            void guard(() =>
              api.put('/api/admin/settings', {
                impactWeight: impactWeight / 100,
                feasibilityWeight: feasibilityWeight / 100,
              }),
            )
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ factor group */

function FactorGroup({
  title,
  blurb,
  category,
  factors,
  scale,
  expanded,
  setExpanded,
  guard,
  busy,
}: {
  title: string;
  blurb: string;
  category: FactorCategory;
  factors: Factor[];
  scale: number[];
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  guard: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const total = factors.filter((f) => f.active).reduce((sum, f) => sum + f.weight, 0);
  const totalPct = Math.round(total * 1000) / 10;
  const balanced = Math.abs(totalPct - 100) < 0.05;

  return (
    <div className="card flush">
      <div className="card-header">
        <div className="grow" style={{ flex: 1 }}>
          <h2>{title}</h2>
          <p className="small muted" style={{ marginTop: 2 }}>
            {blurb}
          </p>
        </div>
        <span className={`weight-summary ${balanced ? 'ok' : 'off'}`}>
          {balanced ? 'Weights total 100%' : `Weights total ${totalPct}%`}
        </span>
        <button
          disabled={busy}
          onClick={() =>
            void guard(() =>
              api.post('/api/admin/factors', {
                name: 'New factor',
                category,
                weight: 0,
                levels: scale.map((score) => ({ score, label: '' })),
              }),
            )
          }
        >
          Add factor
        </button>
      </div>

      <div className="config-list">
        {factors.length === 0 && <p className="empty">No {category} factors yet.</p>}
        {factors.map((factor) => (
          <div key={factor.id}>
            <div className="config-row">
              <input
                className="grow"
                type="text"
                defaultValue={factor.name}
                aria-label="Factor name"
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (!name || name === factor.name) {
                    e.target.value = factor.name;
                    return;
                  }
                  void guard(() => api.put(`/api/admin/factors/${factor.id}`, { name }));
                }}
              />
              <input
                type="text"
                style={{ flex: 1, minWidth: 160 }}
                defaultValue={factor.question}
                aria-label="Question shown to respondents"
                placeholder="Question shown to respondents"
                onBlur={(e) => {
                  if (e.target.value === factor.question) return;
                  void guard(() =>
                    api.put(`/api/admin/factors/${factor.id}`, { question: e.target.value }),
                  );
                }}
              />
              <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input
                  className="weight-input"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={Math.round(factor.weight * 1000) / 10}
                  aria-label={`${factor.name} weight`}
                  onBlur={(e) => {
                    const next = Number(e.target.value) / 100;
                    if (!Number.isFinite(next) || next === factor.weight) return;
                    void guard(() => api.put(`/api/admin/factors/${factor.id}`, { weight: next }));
                  }}
                />
                %
              </label>
              <label
                className="chip"
                style={{ cursor: 'pointer' }}
                title="A high score on this factor counts against the category (cost, risk, complexity)."
              >
                <input
                  type="checkbox"
                  checked={factor.inverted}
                  onChange={(e) =>
                    void guard(() =>
                      api.put(`/api/admin/factors/${factor.id}`, { inverted: e.target.checked }),
                    )
                  }
                />
                Inverted
              </label>
              <label className="chip" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={factor.active}
                  onChange={(e) =>
                    void guard(() =>
                      api.put(`/api/admin/factors/${factor.id}`, { active: e.target.checked }),
                    )
                  }
                />
                In use
              </label>
              <button
                className="ghost small"
                aria-expanded={expanded === factor.id}
                onClick={() => setExpanded(expanded === factor.id ? null : factor.id)}
              >
                {expanded === factor.id ? 'Hide rubric' : 'Rubric'}
              </button>
              <button
                className="danger small"
                onClick={() => {
                  if (!window.confirm(`Delete "${factor.name}" and every score recorded against it?`))
                    return;
                  void guard(() => api.del(`/api/admin/factors/${factor.id}`));
                }}
              >
                Delete
              </button>
            </div>

            {expanded === factor.id && (
              <div className="config-row" style={{ background: 'var(--surface-sunken)' }}>
                <div className="stack" style={{ gap: 8, width: '100%' }}>
                  <span className="small muted">
                    What each point on the scale means for this factor. Respondents see these labels
                    under each option.
                  </span>
                  <RubricEditor factor={factor} scale={scale} guard={guard} busy={busy} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------- rubric wording */

function RubricEditor({
  factor,
  scale,
  guard,
  busy,
}: {
  factor: Factor;
  scale: number[];
  guard: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const byScore = new Map(factor.levels.map((l) => [l.score, l.label]));
  const [labels, setLabels] = useState<Record<number, string>>(
    Object.fromEntries(scale.map((score) => [score, byScore.get(score) ?? ''])),
  );

  return (
    <div className="stack" style={{ gap: 10, width: '100%' }}>
      <div className="rubric-grid">
        {scale.map((score) => (
          <label key={score}>
            {score}
            <input
              type="text"
              value={labels[score] ?? ''}
              onChange={(e) => setLabels({ ...labels, [score]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div>
        <button
          className="primary small"
          disabled={busy}
          onClick={() =>
            void guard(() =>
              api.put(`/api/admin/factors/${factor.id}`, {
                levels: scale.map((score) => ({ score, label: labels[score] ?? '' })),
              }),
            )
          }
        >
          Save rubric
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ scale editor */

function ScaleEditor({
  config,
  guard,
  busy,
}: {
  config: AdminConfig;
  guard: (action: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = useState(config.scale.join(', '));
  const parsed = text
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
  const valid = parsed.length >= 2 && new Set(parsed).size === parsed.length;

  return (
    <div className="card stack">
      <div>
        <h2>Scoring scale</h2>
        <p className="small muted">
          The points respondents can choose from. The default is a 7-point exponential scale — the
          gaps widen as the score rises, so the top of the scale means something exceptional.
        </p>
      </div>
      <div className="row">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Scale points, comma separated"
          style={{ maxWidth: 360 }}
        />
        <button
          className="primary"
          disabled={busy || !valid || text === config.scale.join(', ')}
          onClick={() => void guard(() => api.put('/api/admin/scale', { scores: parsed }))}
        >
          Save scale
        </button>
        {!valid && <span className="small" style={{ color: 'var(--critical)' }}>
          Enter at least two distinct numbers.
        </span>}
      </div>
      <p className="small muted">
        Changing the scale doesn't rewrite answers already given. Add the new points to each
        factor's rubric afterwards so respondents see wording for every option.
      </p>
    </div>
  );
}
