import { useState } from 'react';
import { api } from '../api.js';
import type { AdminConfig } from './AdminApp.js';

interface Props {
  config: AdminConfig;
  reload: () => Promise<void>;
}

/** Which teams appear in the business user's team dropdown. */
export function Teams({ config, reload }: Props) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const opportunityCount = (teamId: number) =>
    config.opportunities.filter((o) => o.teamIds.includes(teamId)).length;

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>Add a team</h2>
          <p className="small muted">
            Teams appear in the assessment's team dropdown. A business user only sees the AI
            opportunities mapped to the team they pick.
          </p>
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            void guard(async () => {
              await api.post('/api/admin/teams', { name: newName.trim() });
              setNewName('');
            });
          }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Team name"
            style={{ maxWidth: 280 }}
          />
          <button className="primary" type="submit" disabled={busy || !newName.trim()}>
            Add team
          </button>
        </form>
        {error && <p className="notice error">{error}</p>}
      </div>

      <div className="card flush">
        <div className="card-header">
          <h2>Teams</h2>
          <span className="chip">{config.teams.length}</span>
        </div>
        <div className="config-list">
          {config.teams.length === 0 && <p className="empty">No teams yet.</p>}
          {config.teams.map((team) => (
            <div className="config-row" key={team.id}>
              <input
                className="grow"
                type="text"
                defaultValue={team.name}
                onBlur={(e) => {
                  const name = e.target.value.trim();
                  if (!name || name === team.name) {
                    e.target.value = team.name;
                    return;
                  }
                  void guard(() => api.put(`/api/admin/teams/${team.id}`, { name }));
                }}
              />
              <span className="chip">
                {opportunityCount(team.id)}{' '}
                {opportunityCount(team.id) === 1 ? 'opportunity' : 'opportunities'}
              </span>
              <label className="chip" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={team.active}
                  onChange={(e) =>
                    void guard(() =>
                      api.put(`/api/admin/teams/${team.id}`, { active: e.target.checked }),
                    )
                  }
                />
                Available
              </label>
              <button
                className="danger small"
                onClick={() => {
                  if (
                    !window.confirm(
                      `Delete "${team.name}"? Its opportunity mappings and any responses from its members are removed too.`,
                    )
                  )
                    return;
                  void guard(() => api.del(`/api/admin/teams/${team.id}`));
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
