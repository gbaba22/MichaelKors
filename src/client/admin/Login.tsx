import { useState } from 'react';
import { api } from '../api.js';

interface Props {
  onSignedIn: () => void;
  passwordConfigured: boolean;
}

export function Login({ onSignedIn, passwordConfigured }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/login', { password });
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <div className="card stack">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>AI Capability Assessment</h1>
        </div>

        {passwordConfigured ? (
          <form className="form-grid" onSubmit={submit}>
            <label className="field">
              Admin password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="notice error">{error}</p>}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <p className="notice error">
            No admin password is configured. Set <code>ADMIN_PASSWORD</code> in the server's{' '}
            <code>.env</code> file and restart.
          </p>
        )}
      </div>
    </div>
  );
}
