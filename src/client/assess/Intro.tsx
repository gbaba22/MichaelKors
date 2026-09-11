import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { AssessmentForm } from '../../shared/types.js';

interface Props {
  onStart: (form: AssessmentForm) => void;
}

/** Name, email and team - the only thing asked before the survey itself. */
export function Intro({ onStart }: Props) {
  const [teams, setTeams] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ id: number; name: string }[]>('/api/teams')
      .then(setTeams)
      .catch(() => setError('Could not load teams. Please refresh the page.'));
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const form = await api.post<AssessmentForm>('/api/session', {
        name,
        email,
        teamId: Number(teamId),
      });
      if (form.opportunities.length === 0) {
        setError(
          'No AI opportunities are assigned to that team yet. Please check with the assessment owner.',
        );
        return;
      }
      onStart(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container narrow stack">
      <div className="card stack">
        <div>
          <p className="eyebrow">Before you start</p>
          <h1>Score the AI opportunities for your team</h1>
        </div>
        <p className="secondary-text">
          You'll see the AI opportunities relevant to your team and rate each one against a short
          set of questions. Pick the level that your evidence actually supports — if you're between
          two, choose the lower one. It takes about a minute per opportunity, and your answers save
          as you go.
        </p>

        <form className="form-grid" onSubmit={submit}>
          <label className="field">
            Your name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              placeholder="Jane Smith"
            />
          </label>

          <label className="field">
            Work email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="jane.smith@company.com"
            />
          </label>

          <label className="field">
            Your team
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)} required>
              <option value="" disabled>
                Choose your team…
              </option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="notice error">{error}</p>}

          <div>
            <button className="primary" type="submit" disabled={busy || teams.length === 0}>
              {busy ? 'Starting…' : 'Start assessment'}
            </button>
          </div>
        </form>

        <p className="small muted">
          Returning with the same email picks up exactly where you left off.
        </p>
      </div>
    </div>
  );
}
