import { useMemo, useState } from 'react';
import { api } from '../api.js';
import type { Opportunity } from '../../shared/types.js';
import type { AdminConfig } from './AdminApp.js';

interface Props {
  config: AdminConfig;
  reload: () => Promise<void>;
}

const BLANK = {
  name: '',
  businessArea: '',
  businessGoal: '',
  description: '',
  teamIds: [] as number[],
};

/** The AI opportunity catalog and its team mapping. */
export function Opportunities({ config, reload }: Props) {
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<typeof BLANK>(BLANK);
  const [filterTeam, setFilterTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const teamName = useMemo(
    () => new Map(config.teams.map((t) => [t.id, t.name])),
    [config.teams],
  );

  const visible = config.opportunities.filter(
    (o) => !filterTeam || o.teamIds.includes(Number(filterTeam)),
  );

  async function guard(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(o: Opportunity) {
    setEditingId(o.id);
    setDraft({
      name: o.name,
      businessArea: o.businessArea,
      businessGoal: o.businessGoal,
      description: o.description,
      teamIds: [...o.teamIds],
    });
  }

  function save() {
    if (!draft.name.trim()) return;
    const body = { ...draft, name: draft.name.trim() };
    void guard(() =>
      editingId === 'new'
        ? api.post('/api/admin/opportunities', body)
        : api.put(`/api/admin/opportunities/${editingId}`, body),
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <label className="field">
          Filter by team
          <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)}>
            <option value="">All teams</option>
            {config.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="primary"
          onClick={() => {
            setDraft(BLANK);
            setEditingId('new');
          }}
        >
          Add AI opportunity
        </button>
      </div>

      {error && <p className="notice error">{error}</p>}

      {editingId !== null && (
        <div className="card stack">
          <h2>{editingId === 'new' ? 'New AI opportunity' : 'Edit AI opportunity'}</h2>
          <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label className="field">
              Name
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Demand Forecasting"
              />
            </label>
            <label className="field">
              Business area
              <input
                type="text"
                list="business-areas"
                value={draft.businessArea}
                onChange={(e) => setDraft({ ...draft, businessArea: e.target.value })}
              />
            </label>
            <label className="field">
              Business goal
              <input
                type="text"
                list="business-goals"
                value={draft.businessGoal}
                onChange={(e) => setDraft({ ...draft, businessGoal: e.target.value })}
              />
            </label>
          </div>

          <datalist id="business-areas">
            {[...new Set(config.opportunities.map((o) => o.businessArea))].filter(Boolean).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="business-goals">
            {[...new Set(config.opportunities.map((o) => o.businessGoal))].filter(Boolean).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>

          <label className="field">
            Description shown to respondents (optional)
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>

          <div className="stack" style={{ gap: 6 }}>
            <span className="field" style={{ fontWeight: 500 }}>
              Teams that score this opportunity
            </span>
            <div className="team-picker">
              {config.teams.map((team) => {
                const on = draft.teamIds.includes(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        teamIds: on
                          ? draft.teamIds.filter((id) => id !== team.id)
                          : [...draft.teamIds, team.id],
                      })
                    }
                  >
                    {team.name}
                  </button>
                );
              })}
            </div>
            <span className="small muted">
              Pick as many as apply — an opportunity can be scored by several teams.
            </span>
          </div>

          <div className="row">
            <button className="primary" onClick={save} disabled={busy || !draft.name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button className="ghost" onClick={() => setEditingId(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card flush">
        <div className="card-header">
          <h2>AI Opportunities</h2>
          <span className="chip">{visible.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>AI Opportunity</th>
                <th>Business area</th>
                <th>Business goal</th>
                <th>Teams</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td className="secondary-text">{o.businessArea}</td>
                  <td className="secondary-text">{o.businessGoal}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 320 }}>
                    <span className="chip-list">
                      {o.teamIds.length === 0 ? (
                        <span className="chip">No team — not shown to anyone</span>
                      ) : (
                        o.teamIds.map((id) => (
                          <span className="chip" key={id}>
                            {teamName.get(id) ?? '—'}
                          </span>
                        ))
                      )}
                    </span>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={o.active}
                      aria-label={`${o.name} active`}
                      onChange={(e) =>
                        void guard(() =>
                          api.put(`/api/admin/opportunities/${o.id}`, { active: e.target.checked }),
                        )
                      }
                    />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                      <button className="ghost small" onClick={() => startEdit(o)}>
                        Edit
                      </button>
                      <button
                        className="danger small"
                        onClick={() => {
                          if (!window.confirm(`Delete "${o.name}" and all of its responses?`)) return;
                          void guard(() => api.del(`/api/admin/opportunities/${o.id}`));
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <p className="empty">No AI opportunities match this filter.</p>}
        </div>
      </div>
    </div>
  );
}
