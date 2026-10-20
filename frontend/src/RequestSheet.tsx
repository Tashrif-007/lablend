import { useEffect, useRef, useState } from 'react';
import { checkStock, CheckResult, createLoan, Equipment, Rules } from './api';
import { CloseIcon, ShieldIcon } from './icons';
import { ItemArt } from './icons';

interface Props {
  item: Equipment;
  studentId: string;
  held: number;
  rules: Rules;
  onClose: () => void;
  onSaved: (text: string) => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A request for one item: pick how many and for how long, see the rule as
// you go, check it with the server, then Approve. The live preview is only a
// hint; the server's check decides, and only Approve saves.
export function RequestSheet({ item, studentId, held, rules, onClose, onSaved }: Props) {
  const [quantity, setQuantity] = useState(1);
  const [days, setDays] = useState(Math.min(7, rules.maxDays));
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const maxSlider = rules.maxDays * 2;
  const afterItems = held + quantity;
  const overItems = afterItems > rules.maxItems;
  const overDays = days > rules.maxDays;
  const overStock = quantity > item.available;

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (q: number, d: number) => {
    setQuantity(Math.max(1, Math.min(q, 10)));
    setDays(Math.max(1, Math.min(d, maxSlider)));
    setResult(null);
    setError(null);
  };

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setResult(await checkStock({ studentId, itemId: item.id, quantity, days }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!result?.ok) return;
    setBusy(true);
    try {
      const saved = await createLoan(result.proposal);
      if (saved.ok) {
        onSaved(`Saved: ${quantity} × ${item.name} for ${plural(days, 'day')}.`);
      } else {
        setResult(saved);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabIndex={-1} ref={dialog}>
        <button className="icon-btn sheet-close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        <div className="sheet-head">
          <div className="art-tile big"><ItemArt id={item.id} name={item.name} size={64} /></div>
          <div>
            <p className="eyebrow">Request</p>
            <h2 id="sheet-title">{item.name}</h2>
            <p className="muted small">{item.available} of {item.stock} available · for {studentId}</p>
          </div>
        </div>

        <div className="field">
          <div className="field-head">
            <span>How many</span>
            <span className={`hint ${overItems ? 'bad' : 'good'}`}>
              You would hold {afterItems} of {rules.maxItems}
            </span>
          </div>
          <div className="stepper">
            <button className="step" onClick={() => change(quantity - 1, days)} disabled={quantity <= 1} aria-label="One less">−</button>
            <output aria-live="polite">{quantity}</output>
            <button className="step" onClick={() => change(quantity + 1, days)} disabled={quantity >= 10} aria-label="One more">+</button>
            <div className="slots" aria-hidden>
              {Array.from({ length: Math.max(rules.maxItems, afterItems) }, (_, i) => (
                <span
                  key={i}
                  className={`slot ${i < held ? 'held' : i < afterItems ? (i < rules.maxItems ? 'new' : 'over') : ''}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <div className="field-head">
            <label htmlFor="days">For how long</label>
            <span className={`hint ${overDays ? 'bad' : 'good'}`}>{plural(days, 'day')} · limit {rules.maxDays}</span>
          </div>
          <div className="range-wrap" style={{ ['--limit' as string]: `${((rules.maxDays - 0.5) / maxSlider) * 100}%` }}>
            <input
              id="days"
              type="range"
              min={1}
              max={maxSlider}
              value={days}
              onChange={(e) => change(quantity, Number(e.target.value))}
              className={overDays ? 'over' : ''}
            />
            <div className="range-scale" aria-hidden>
              <span>1</span>
              <span className="limit-mark">{rules.maxDays} days max</span>
              <span>{maxSlider}</span>
            </div>
          </div>
        </div>

        {!result && (overItems || overDays || overStock) && (
          <p className="preview bad">
            This looks over the {overStock && !overItems && !overDays ? 'stock' : 'rule'}. You can still check it to see the server's answer.
          </p>
        )}

        {result?.ok && (
          <div className="verdict ok" role="status">
            <ShieldIcon />
            <div>
              <strong>Passes the rule.</strong> {quantity} × {item.name} for {plural(days, 'day')}. Nothing is saved until you approve.
            </div>
          </div>
        )}
        {result && !result.ok && (
          <div className="verdict bad" role="alert">
            <ShieldIcon />
            <div>
              <strong>Refused.</strong>
              <ul>
                {result.violations.map((v) => (
                  <li key={v.code}><code className="code">{v.code}</code> {v.reason}</li>
                ))}
              </ul>
              {result.suggestion && (
                <button className="btn soft" onClick={() => change(result.suggestion!.quantity, result.suggestion!.days)}>
                  Use {result.suggestion.quantity} for {plural(result.suggestion.days, 'day')} instead
                </button>
              )}
            </div>
          </div>
        )}
        {error && <p className="preview bad" role="alert">{error}</p>}

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {result?.ok ? (
            <button className="btn primary" onClick={approve} disabled={busy}>
              {busy ? 'Saving…' : 'Approve loan'}
            </button>
          ) : (
            <button className="btn primary" onClick={check} disabled={busy || !studentId}>
              {busy ? 'Checking…' : 'Check request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
