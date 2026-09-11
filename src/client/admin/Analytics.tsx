import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatScore } from '../api.js';
import type { AnalyticsPayload, OpportunityAggregate } from '../../shared/types.js';
import { ScatterChart } from './ScatterChart.js';

interface Props {
  revision: number;
}

type SortKey = 'name' | 'businessArea' | 'impact' | 'feasibility' | 'overall' | 'respondentCount';

/**
 * The prioritisation view: scores per AI opportunity, the impact-vs-feasibility
 * map, and a table of the same numbers. Refetches whenever the live stream says
 * something changed.
 */
export function Analytics({ revision }: Props) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [team, setTeam] = useState('');
  const [scoredOnly, setScoredOnly] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'overall',
    dir: 'desc',
  });

  const load = useCallback(() => {
    api
      .get<AnalyticsPayload>('/api/admin/analytics')
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load analytics.'));
  }, []);

  useEffect(load, [load, revision]);

  const areas = useMemo(
    () => [...new Set(data?.aggregates.map((a) => a.businessArea) ?? [])].filter(Boolean).sort(),
    [data],
  );
  const teams = useMemo(
    () => [...new Set(data?.aggregates.flatMap((a) => a.teamNames) ?? [])].sort(),
    [data],
  );

  const filtered = useMemo(() => {
    const rows = (data?.aggregates ?? []).filter((a) => {
      if (area && a.businessArea !== area) return false;
      if (team && !a.teamNames.includes(team)) return false;
      if (scoredOnly && a.respondentCount === 0) return false;
      return true;
    });
    const direction = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv)) * direction;
      }
      // Unscored opportunities always sort to the bottom, whichever direction.
      if (av == null) return 1;
      if (bv == null) return -1;
      return ((av as number) - (bv as number)) * direction;
    });
  }, [data, area, team, scoredOnly, sort]);

  if (error) return <p className="notice error">{error}</p>;
  if (!data) return <p className="muted">Loading analytics…</p>;

  const scored = filtered.filter((a) => a.respondentCount > 0);
  const quickWins = scored.filter((a) => (a.impact ?? 0) >= 50 && (a.feasibility ?? 0) >= 50).length;
  const topOverall = scored.reduce<OpportunityAggregate | null>(
    (best, a) => (best == null || (a.overall ?? 0) > (best.overall ?? 0) ? a : best),
    null,
  );

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'businessArea' ? 'asc' : 'desc' },
    );
  }

  const sortIndicator = (key: SortKey) =>
    sort.key === key ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <div className="stack">
      <div className="stat-row">
        <div className="stat">
          <div className="value">{data.totals.respondents}</div>
          <div className="label">Respondents</div>
        </div>
        <div className="stat">
          <div className="value">{scored.length}</div>
          <div className="label">Opportunities scored</div>
        </div>
        <div className="stat">
          <div className="value">{quickWins}</div>
          <div className="label">In quick wins</div>
        </div>
        <div className="stat">
          <div className="value" style={{ fontSize: '1.05rem', fontWeight: 600, paddingTop: 8 }}>
            {topOverall ? topOverall.name : '—'}
          </div>
          <div className="label">
            Highest overall{topOverall?.overall != null ? ` · ${formatScore(topOverall.overall)}` : ''}
          </div>
        </div>
      </div>

      <div className="filters">
        <label className="field">
          Business area
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All business areas</option>
            {areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Team
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="chip" style={{ cursor: 'pointer', alignSelf: 'flex-end', height: 38 }}>
          <input
            type="checkbox"
            checked={scoredOnly}
            onChange={(e) => setScoredOnly(e.target.checked)}
          />
          Hide opportunities with no scores
        </label>
      </div>

      <div className="chart-card">
        <div className="card-header">
          <div style={{ flex: 1 }}>
            <h2>Impact vs Feasibility</h2>
            <p className="small muted" style={{ marginTop: 2 }}>
              Each mark is one AI opportunity, placed by its average scores. Updates as scores
              arrive.
            </p>
          </div>
          <span className="chip">
            {scored.length} plotted · {data.totals.submitted} submitted responses
          </span>
        </div>
        <div style={{ padding: '12px 16px 0' }}>
          <ScatterChart points={scored} />
        </div>
      </div>

      <div className="card flush">
        <div className="card-header">
          <h2>Scores by AI Opportunity</h2>
          <span className="chip">
            Overall = Impact × {Math.round(data.settings.impactWeight * 100)}% + Feasibility ×{' '}
            {Math.round(data.settings.feasibilityWeight * 100)}%
          </span>
        </div>
        <div className="table-wrap" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggleSort('name')}>
                  AI Opportunity{sortIndicator('name')}
                </th>
                <th className="sortable" onClick={() => toggleSort('businessArea')}>
                  Business area{sortIndicator('businessArea')}
                </th>
                <th className="sortable num" onClick={() => toggleSort('respondentCount')}>
                  Responses{sortIndicator('respondentCount')}
                </th>
                <th className="sortable num" onClick={() => toggleSort('impact')}>
                  Impact{sortIndicator('impact')}
                </th>
                <th className="sortable num" onClick={() => toggleSort('feasibility')}>
                  Feasibility{sortIndicator('feasibility')}
                </th>
                <th className="sortable num" onClick={() => toggleSort('overall')}>
                  Overall{sortIndicator('overall')}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.opportunityId}>
                  <td style={{ fontWeight: 500 }}>{a.name}</td>
                  <td className="secondary-text">{a.businessArea}</td>
                  <td className="num secondary-text">{a.respondentCount}</td>
                  <td className="num">
                    <ScoreCell value={a.impact} color="var(--series-impact)" />
                  </td>
                  <td className="num">
                    <ScoreCell value={a.feasibility} color="var(--series-feasibility)" />
                  </td>
                  <td className="num">
                    <ScoreCell value={a.overall} color="var(--series-overall)" bold />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="empty">
              No scores yet. Share the assessment link with your teams and results appear here
              immediately.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The number always sits next to its bar - the bar is a quick visual ranking,
 * the digits carry the value so nothing depends on colour alone.
 */
function ScoreCell({
  value,
  color,
  bold,
}: {
  value: number | null;
  color: string;
  bold?: boolean;
}) {
  return (
    <span className="score-cell">
      <span className="score-bar">
        <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
      </span>
      <span style={{ fontWeight: bold ? 600 : 500, minWidth: 34, display: 'inline-block' }}>
        {formatScore(value)}
      </span>
    </span>
  );
}
