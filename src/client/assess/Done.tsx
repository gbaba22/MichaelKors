import type { AssessmentForm } from '../../shared/types.js';

interface Props {
  form: AssessmentForm;
  onStartOver: () => void;
}

/**
 * The end of the business-user journey. No scores, no ranking, no chart -
 * results are the admin's view, not the respondent's.
 */
export function Done({ form, onStartOver }: Props) {
  return (
    <div className="container narrow stack">
      <div className="card stack">
        <div>
          <p className="eyebrow">Submitted</p>
          <h1>Thank you, {form.respondent.name.split(' ')[0]}</h1>
        </div>
        <p className="secondary-text">
          Your scores for {form.opportunities.length}{' '}
          {form.opportunities.length === 1 ? 'AI opportunity' : 'AI opportunities'} have been
          recorded for {form.respondent.teamName}. Nothing else is needed from you.
        </p>
        <p className="small muted">
          Spotted something you'd score differently? Reopen the assessment with the same email
          address and your answers will be there to change.
        </p>
        <div>
          <button type="button" onClick={onStartOver}>
            Take the assessment as someone else
          </button>
        </div>
      </div>
    </div>
  );
}
