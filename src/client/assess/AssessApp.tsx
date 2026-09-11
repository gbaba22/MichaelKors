import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { AssessmentForm } from '../../shared/types.js';
import { Intro } from './Intro.js';
import { Scoring } from './Scoring.js';
import { Done } from './Done.js';

const STORAGE_KEY = 'aica.respondentId';

type Stage = 'intro' | 'scoring' | 'done';

/**
 * The business-user experience: identify yourself, score your team's
 * opportunities, submit. It never requests or displays a single score,
 * weight or ranking.
 */
export function AssessApp() {
  const [form, setForm] = useState<AssessmentForm | null>(null);
  const [stage, setStage] = useState<Stage>('intro');
  const [restoring, setRestoring] = useState(true);

  // Resume after a reload rather than making people re-enter their details.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setRestoring(false);
      return;
    }
    api
      .get<AssessmentForm>(`/api/session/${stored}`)
      .then((resumed) => {
        setForm(resumed);
        setStage('scoring');
      })
      .catch(() => window.localStorage.removeItem(STORAGE_KEY))
      .finally(() => setRestoring(false));
  }, []);

  function start(next: AssessmentForm) {
    window.localStorage.setItem(STORAGE_KEY, String(next.respondent.id));
    setForm(next);
    setStage('scoring');
  }

  function finish() {
    setStage('done');
  }

  function startOver() {
    window.localStorage.removeItem(STORAGE_KEY);
    setForm(null);
    setStage('intro');
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          AI Capability Assessment <small>Opportunity scoring</small>
        </div>
        <div className="spacer" />
        {form && stage === 'scoring' && (
          <span className="small muted">
            {form.respondent.name} · {form.respondent.teamName}
          </span>
        )}
      </header>

      {restoring ? (
        <div className="container narrow">
          <p className="muted">Loading…</p>
        </div>
      ) : stage === 'intro' || !form ? (
        <Intro onStart={start} />
      ) : stage === 'scoring' ? (
        <Scoring form={form} onSubmitted={finish} />
      ) : (
        <Done form={form} onStartOver={startOver} />
      )}
    </div>
  );
}
