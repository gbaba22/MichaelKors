import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import type { Factor, Opportunity, Settings, Team } from '../../shared/types.js';
import { Analytics } from './Analytics.js';
import { Factors } from './Factors.js';
import { Login } from './Login.js';
import { Opportunities } from './Opportunities.js';
import { Responses } from './Responses.js';
import { Teams } from './Teams.js';
import { useEventStream } from './useEventStream.js';

export interface AdminConfig {
  teams: Team[];
  opportunities: Opportunity[];
  factors: Factor[];
  settings: Settings;
  scale: number[];
}

const TABS = [
  { id: 'analytics', label: 'Analytics' },
  { id: 'responses', label: 'Responses' },
  { id: 'opportunities', label: 'AI Opportunities' },
  { id: 'teams', label: 'Teams' },
  { id: 'factors', label: 'Factors & Weights' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function AdminApp() {
  const [status, setStatus] = useState<'checking' | 'out' | 'in'>('checking');
  const [passwordConfigured, setPasswordConfigured] = useState(true);
  const [tab, setTab] = useState<TabId>('analytics');
  const [config, setConfig] = useState<AdminConfig | null>(null);

  const loadConfig = useCallback(async () => {
    setConfig(await api.get<AdminConfig>('/api/admin/config'));
  }, []);

  const checkSession = useCallback(async () => {
    const me = await api.get<{ admin: boolean; passwordConfigured: boolean }>('/api/admin/me');
    setPasswordConfigured(me.passwordConfigured);
    setStatus(me.admin ? 'in' : 'out');
    if (me.admin) await loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  async function signOut() {
    await api.post('/api/admin/logout');
    setStatus('out');
    setConfig(null);
  }

  if (status === 'checking') {
    return (
      <div className="signin">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (status === 'out') {
    return <Login onSignedIn={checkSession} passwordConfigured={passwordConfigured} />;
  }

  return (
    <SignedInAdmin
      tab={tab}
      setTab={setTab}
      config={config}
      reloadConfig={loadConfig}
      onSignOut={signOut}
    />
  );
}

interface SignedInProps {
  tab: TabId;
  setTab: (tab: TabId) => void;
  config: AdminConfig | null;
  reloadConfig: () => Promise<void>;
  onSignOut: () => void;
}

/**
 * Split out so the SSE subscription only ever mounts for a signed-in admin
 * (the stream endpoint is behind the same auth as everything else).
 */
function SignedInAdmin({ tab, setTab, config, reloadConfig, onSignOut }: SignedInProps) {
  // Bumping this tells whichever tab is open to refetch its own data.
  const [revision, setRevision] = useState(0);
  const connected = useEventStream(
    useCallback(() => setRevision((r) => r + 1), []),
  );

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          AI Capability Assessment <small>Admin</small>
        </div>
        <nav className="tabs" aria-label="Admin sections">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="chip" title={connected ? 'Live updates connected' : 'Reconnecting…'}>
          <span className={`live-dot${connected ? '' : ' off'}`} />
          {connected ? 'Live' : 'Offline'}
        </span>
        <button className="ghost" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <div className="container stack">
        {!config ? (
          <p className="muted">Loading configuration…</p>
        ) : tab === 'analytics' ? (
          <Analytics revision={revision} />
        ) : tab === 'responses' ? (
          <Responses revision={revision} config={config} />
        ) : tab === 'opportunities' ? (
          <Opportunities config={config} reload={reloadConfig} />
        ) : tab === 'teams' ? (
          <Teams config={config} reload={reloadConfig} />
        ) : (
          <Factors config={config} reload={reloadConfig} />
        )}
      </div>
    </div>
  );
}
