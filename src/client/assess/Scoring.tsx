import { useMemo, useState } from 'react';
import { api } from '../api.js';
import type { AssessmentForm } from '../../shared/types.js';

interface Props {
  form: AssessmentForm;
  onSubmitted: () => void;
}

type Answers = Record<number, Record<number, number>>; // opportunityId -> factorId -> score

/**
 * One opportunity per screen, every question answered on the same 7-point
 * scale. Each option carries that factor's own rubric wording, so the scale
 * explains itself without the respondent needing to know the model behind it.
 */
export function Scoring({ form, onSubmitted }: Props) {
  const [index, setIndex] = useState(() => firstUnansweredIndex(form));
  const [answers, setAnswers] = useState<Answers>(() =>
    Object.fromEntries(form.opportunities.map((o) => [o.id, { ...o.scores }])),
  );
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opportunity = form.opportunities[index];
  const current = answers[opportunity.id] ?? {};

  const completedCount = useMemo(
    () =>
      form.opportunities.filter(
        (o) => Object.keys(answers[o.id] ?? {}).length === form.questions.length,
      ).length,
    [answers, form.opportunities, form.questions.length],
  );

  const allComplete = completedCount === form.opportunities.length;
  const currentComplete = Object.keys(current).length === form.questions.length;

  function choose(factorId: number, score: number) {
    const updated = { ...current, [factorId]: score };
    setAnswers((prev) => ({ ...prev, [opportunity.id]: updated }));
    void save(updated);
  }

  // Autosave on every answer, so a closed tab never loses work.
  async function save(scores: Record<number, number>) {
    setSaveState('saving');
    try {
      await api.put(`/api/session/${form.respondent.id}/responses/${opportunity.id}`, {
        scores,
        submitted: false,
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/api/session/${form.respondent.id}/submit`);
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container stack">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row">
          <span className="eyebrow">
            Opportunity {index + 1} of {form.opportunities.length}
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          <span className="small muted">
            {completedCount} of {form.opportunities.length} complete
          </span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={completedCount}
          aria-valuemin={0}
          aria-valuemax={form.opportunities.length}
          aria-label="Opportunities completed"
        >
          <span style={{ width: `${(completedCount / form.opportunities.length) * 100}%` }} />
        </div>
      </div>

      <div className="card stack">
        <div className="opportunity-head">
          <span className="eyebrow">
            {opportunity.businessArea}
            {opportunity.businessGoal ? ` · ${opportunity.businessGoal}` : ''}
          </span>
          <h1>{opportunity.name}</h1>
          {opportunity.description && (
            <p className="secondary-text">{opportunity.description}</p>
          )}
        </div>

        <div>
          {form.questions.map((question) => (
            <fieldset
              className="question"
              key={question.id}
              style={{ border: 'none', margin: 0, padding: 0 }}
            >
              <legend style={{ padding: 0, width: '100%' }}>
                <span className="question-head">
                  <span className="name">{question.name}</span>
                  {question.question && <span className="small muted">{question.question}</span>}
                </span>
              </legend>
              <div className="scale">
                {question.levels.map((level) => {
                  const selected = current[question.id] === level.score;
                  return (
                    <button
                      type="button"
                      key={level.score}
                      className="scale-option"
                      aria-pressed={selected}
                      onClick={() => choose(question.id, level.score)}
                    >
                      <span className="score">{level.score}</span>
                      <span className="desc">{level.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="save-state" aria-live="polite">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && 'Answers saved'}
          {saveState === 'error' && 'Could not save — check your connection and try again.'}
        </div>

        <div className="nav-bar">
          <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
            Previous
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => setIndex((i) => i + 1)}
            disabled={index >= form.opportunities.length - 1}
          >
            {currentComplete ? 'Next opportunity' : 'Skip for now'}
          </button>
          <div className="spacer" />
          {allComplete ? (
            <button type="button" className="primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit assessment'}
            </button>
          ) : (
            <span className="small muted">
              Answer every question on each opportunity to submit.
            </span>
          )}
        </div>

        {error && <p className="notice error">{error}</p>}
      </div>

      <div className="card stack" style={{ gap: 12 }}>
        <span className="eyebrow">Jump to an opportunity</span>
        <div className="opportunity-pager">
          {form.opportunities.map((o, i) => {
            const done = Object.keys(answers[o.id] ?? {}).length === form.questions.length;
            return (
              <button
                type="button"
                key={o.id}
                className={`pager-dot${done ? ' done' : ''}`}
                aria-current={i === index}
                aria-label={`${o.name}${done ? ' (complete)' : ''}`}
                title={o.name}
                onClick={() => setIndex(i)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Opens on the first opportunity that still needs answers. */
function firstUnansweredIndex(form: AssessmentForm): number {
  const index = form.opportunities.findIndex(
    (o) => Object.keys(o.scores).length < form.questions.length,
  );
  return index === -1 ? 0 : index;
}
