import { useCallback, useEffect, useState } from 'react';
import { Catalog } from './Catalog';
import { Chat } from './Chat';
import { Loans } from './Loans';
import { RequestSheet } from './RequestSheet';
import { ChatStatus, chatStatus, Equipment, getRules, listEquipment, listLoans, Loan, Rules } from './api';
import { BoxIcon, ChatIcon, CheckIcon, ClockIcon, ShieldIcon, UserIcon } from './icons';

type Tab = 'catalog' | 'assistant' | 'loans';

export function App() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [studentInput, setStudentInput] = useState('s-2001');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<Equipment | null>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('catalog');
  const studentId = studentInput.trim();

  const refresh = useCallback(async () => {
    setEquipment(await listEquipment());
    setLoans(studentId ? await listLoans(studentId) : []);
  }, [studentId]);

  useEffect(() => {
    refresh()
      .then(() => setError(null))
      .catch(() => setError('Cannot reach the LabLend server. Is it running?'))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    getRules().then(setRules).catch(() => undefined);
    chatStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const saved = (text: string) => {
    setToast(text);
    setRequesting(null);
    void refresh();
  };

  const held = loans.filter((l) => l.status === 'active').reduce((sum, l) => sum + l.quantity, 0);

  return (
    <div className="app" data-tab={tab}>
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M12 4v9L6 25a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3l-6-12V4M10 4h12M9 20h14" />
            </svg>
          </div>
          <div>
            <h1>LabLend</h1>
            <p className="muted small">Electronics lab · equipment loans</p>
          </div>
        </div>

        {rules && (
          <div className="rule-card" role="note" aria-label={`The rule: at most ${rules.maxItems} items, for at most ${rules.maxDays} days`}>
            <span className="rule-chip"><BoxIcon size={15} /> {rules.maxItems} items max</span>
            <span className="rule-chip"><ClockIcon size={15} /> {rules.maxDays} days max</span>
            <span className="rule-chip"><CheckIcon size={15} /> you approve</span>
          </div>
        )}

        <label className="student-card">
          <span className="avatar" aria-hidden><UserIcon size={16} /></span>
          <span className="student-text">
            <span className="xsmall muted">Student ID</span>
            <input value={studentInput} onChange={(e) => setStudentInput(e.target.value)} placeholder="s-2001" aria-label="Student ID" />
          </span>
          {rules && studentId && (
            <span className={`held ${held >= rules.maxItems ? 'full' : ''}`} title="Items held">{held}/{rules.maxItems}</span>
          )}
        </label>
      </header>

      {error && <div className="banner" role="alert"><ShieldIcon size={16} /> {error}</div>}

      <main className="layout">
        <div className="col-main">
          <div className="tab-catalog">
            <Catalog
              equipment={equipment}
              loading={loading}
              onRequest={setRequesting}
              onAsk={(item) => {
                setPrefill({ text: `I need 1 ${item.name} for ${rules?.maxDays ?? 7} days.`, nonce: Date.now() });
                setTab('assistant');
              }}
            />
          </div>
          <div className="tab-loans">
            {rules && <Loans studentId={studentId} loans={loans} equipment={equipment} rules={rules} />}
          </div>
        </div>
        <div className="col-side tab-assistant">
          <Chat key={studentId} studentId={studentId} status={status} prefill={prefill} onSaved={saved} />
        </div>
      </main>

      <footer className="footer muted xsmall">
        <ShieldIcon size={13} /> The server checks the rule for the UI, the API, the MCP server and the assistant. Only an Approve button saves a loan.
      </footer>

      <nav className="tabbar" aria-label="Sections">
        <button className={tab === 'catalog' ? 'on' : ''} onClick={() => setTab('catalog')}><BoxIcon /> Equipment</button>
        <button className={tab === 'assistant' ? 'on' : ''} onClick={() => setTab('assistant')}><ChatIcon /> Assistant</button>
        <button className={tab === 'loans' ? 'on' : ''} onClick={() => setTab('loans')}><ClockIcon /> My loans</button>
      </nav>

      {requesting && rules && (
        <RequestSheet item={requesting} studentId={studentId} held={held} rules={rules} onClose={() => setRequesting(null)} onSaved={saved} />
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckIcon /> {toast}
        </div>
      )}
    </div>
  );
}
