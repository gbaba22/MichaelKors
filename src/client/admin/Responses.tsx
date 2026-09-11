import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatScore } from '../api.js';
import type { Factor, ResponseRow } from '../../shared/types.js';
import type { AdminConfig } from './AdminApp.js';

interface Props {
  revision: number;
  config: AdminConfig;
}

/**
 * Every individual answer: one row per respondent x opportunity, showing the
 * raw score on each factor alongside the impact, feasibility and overall score
 * that row produces.
 */
export function Responses({ revision, config }: Props) {
  const [data, setData] = useState<{ factors: Factor[]; rows: ResponseRow[] } | null>(null);
  const [team, setTeam] = useState('');
  const [opportunity, setOpportunity] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ factors: Factor[]; rows: ResponseRow[] }>('/api/admin/responses')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load responses.'));
  }, []);

  useEffect(load, [load, revision]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (team && String(r.teamId) !== team) return false;
      if (opportunity && String(r.opportunityId) !== opportunity) return false;
      if (
        needle &&
        !`${r.respondentName} ${r.respondentEmail} ${r.opportunityName}`.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [data, team, opportunity, search]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Loading responses…</p>;

  const respondents = new Set(rows.map((r) => r.respondentId)).size;

  return (
    <div className="stack">
      <div className="filters">
        <label className="field">
          Team
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {config.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          AI Opportunity
          <select value={opportunity} onChange={(e) => setOpportunity(e.target.value)}>
            <option value="">All opportunities</option>
            {config.opportunities.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email or opportunity"
          />
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <a href="/api/admin/responses.csv" download>
          <button type="button">Export CSV</button>
        </a>
      </div>

      <div className="card flush">
        <div className="card-header">
          <h2>Individual responses</h2>
          <span className="chip">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
          <span className="chip">
            {respondents} {respondents === 1 ? 'respondent' : 'respondents'}
          </span>
        </div>

        <div className="table-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Respondent</th>
                <th>Team</th>
                <th>AI Opportunity</th>
                {data.factors.map((f) => (
                  <th key={f.id} className="num" title={`${f.name}${f.inverted ? ' (inverted)' : ''}`}>
                    {abbreviate(f.name)}
                  </th>
                ))}
                <th className="num">Impact</th>
                <th className="num">Feasibility</th>
                <th className="num">Overall</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.responseId}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.respondentName}</div>
                    <div className="small muted">{r.respondentEmail}</div>
                  </td>
                  <td className="secondary-text">{r.teamName}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.opportunityName}</div>
                    <div className="small muted">{r.businessArea}</div>
                  </td>
                  {data.factors.map((f) => (
                    <td key={f.id} className="num secondary-text">
                      {r.scores[f.id] ?? '—'}
                    </td>
                  ))}
                  <td className="num" style={{ color: 'var(--series-impact)', fontWeight: 600 }}>
                    {formatScore(r.impact)}
                  </td>
                  <td className="num" style={{ color: 'var(--series-feasibility)', fontWeight: 600 }}>
                    {formatScore(r.feasibility)}
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatScore(r.overall)}
                  </td>
                  <td>
                    <span className="chip">{r.submitted ? 'Submitted' : 'In progress'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="empty">
              No responses yet. Share the assessment link and scores will appear here as they arrive.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Keeps the factor columns narrow; the full name stays in the title attribute. */
function abbreviate(name: string): string {
  const words = name.split(/[\s/]+/).filter(Boolean);
  if (words.length === 1) return name.slice(0, 8);
  return words
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
