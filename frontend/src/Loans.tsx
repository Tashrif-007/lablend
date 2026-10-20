import { Equipment, Loan, Rules } from './api';
import { ClockIcon, ItemArt } from './icons';

const DAY = 24 * 60 * 60 * 1000;

interface Props {
  studentId: string;
  loans: Loan[];
  equipment: Equipment[];
  rules: Rules;
}

// The student's allowance (how many of the items they hold) and a timeline
// of their active loans with due dates.
export function Loans({ studentId, loans, equipment, rules }: Props) {
  const active = loans.filter((l) => l.status === 'active');
  const held = active.reduce((sum, l) => sum + l.quantity, 0);
  const left = Math.max(0, rules.maxItems - held);
  const nameOf = (id: string) => equipment.find((e) => e.id === id)?.name ?? id;

  return (
    <section className="panel" aria-labelledby="loans-title">
      <div className="panel-head">
        <div>
          <h2 id="loans-title">My loans</h2>
          <p className="muted small">{studentId ? `Student ${studentId}` : 'Enter a student ID'}</p>
        </div>
      </div>

      <div className="allowance">
        <div className="allowance-slots" aria-hidden>
          {Array.from({ length: Math.max(rules.maxItems, held) }, (_, i) => (
            <span key={i} className={`big-slot ${i < held ? 'used' : ''}`}>{i < held ? '●' : ''}</span>
          ))}
        </div>
        <div>
          <strong>{held} of {rules.maxItems} items in use</strong>
          <p className="muted small">
            {left > 0 ? `You can borrow ${left} more, for up to ${rules.maxDays} days.` : 'Limit reached. Return an item to borrow again.'}
          </p>
        </div>
      </div>

      {active.length === 0 ? (
        <p className="muted small empty-note">No active loans yet.</p>
      ) : (
        <ol className="timeline">
          {active.map((l) => {
            const start = new Date(l.createdAt).getTime();
            const due = start + l.days * DAY;
            const daysLeft = Math.ceil((due - Date.now()) / DAY);
            const progress = Math.min(100, Math.max(0, ((Date.now() - start) / (l.days * DAY)) * 100));
            return (
              <li key={l.id} className="loan">
                <div className="art-tile sm"><ItemArt id={l.itemId} name={nameOf(l.itemId)} size={34} /></div>
                <div className="loan-body">
                  <div className="loan-row">
                    <strong>{l.quantity} × {nameOf(l.itemId)}</strong>
                    <span className={`due ${daysLeft < 0 ? 'late' : daysLeft <= 1 ? 'soon' : ''}`}>
                      <ClockIcon size={13} />
                      {daysLeft < 0 ? `${-daysLeft}d overdue` : daysLeft === 0 ? 'due today' : `${daysLeft}d left`}
                    </span>
                  </div>
                  <div className="track" aria-hidden><div style={{ width: `${progress}%` }} /></div>
                  <p className="muted xsmall">
                    {l.days} days · due {new Date(due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
