import { useMemo, useState } from 'react';
import { Equipment } from './api';
import { categoryOf, ChatIcon, ItemArt, SearchIcon } from './icons';

interface Props {
  equipment: Equipment[];
  loading: boolean;
  onRequest: (item: Equipment) => void;
  onAsk: (item: Equipment) => void;
}

const FILTERS = ['All', 'Boards', 'Sensors', 'Motors'] as const;

export function Catalog({ equipment, loading, onRequest, onAsk }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [query, setQuery] = useState('');

  const shown = useMemo(
    () =>
      equipment.filter(
        (e) =>
          (filter === 'All' || categoryOf(e.id, e.name) === filter) &&
          (!query.trim() || e.name.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [equipment, filter, query],
  );

  return (
    <section className="panel" aria-labelledby="catalog-title">
      <div className="panel-head">
        <div>
          <h2 id="catalog-title">Equipment</h2>
          <p className="muted small">Pick an item to request it, or ask the assistant in plain words.</p>
        </div>
        <label className="search">
          <SearchIcon size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search equipment" />
        </label>
      </div>

      <div className="filters" role="tablist" aria-label="Category">
        {FILTERS.map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`filter ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      <div className="grid">
        {loading &&
          Array.from({ length: 4 }, (_, i) => <div key={i} className="item-card skeleton" aria-hidden />)}

        {!loading && shown.length === 0 && <p className="muted empty-note">Nothing matches.</p>}

        {shown.map((e) => {
          const none = e.available <= 0;
          return (
            <article key={e.id} className={`item-card ${none ? 'out' : ''}`}>
              <div className="item-top">
                <div className="art-tile"><ItemArt id={e.id} name={e.name} /></div>
                <span className={`avail ${none ? 'none' : e.available <= 1 ? 'low' : ''}`}>
                  {none ? 'Out of stock' : `${e.available} available`}
                </span>
              </div>
              <h3>{e.name}</h3>
              <div className="units" aria-label={`${e.available} of ${e.stock} available`}>
                {Array.from({ length: e.stock }, (_, i) => (
                  <span key={i} className={`unit ${i < e.available ? 'free' : 'lent'}`} />
                ))}
              </div>
              {e.notes &&
                (e.notesFlagged ? (
                  <p className="note flagged" title="This note reads like an instruction. It is data, and never changes the limits.">
                    <strong>Ignored note</strong> “{e.notes}”
                  </p>
                ) : (
                  <p className="note">{e.notes}</p>
                ))}
              <div className="item-actions">
                <button className="btn primary sm" onClick={() => onRequest(e)} disabled={none}>
                  Request
                </button>
                <button className="btn ghost sm" onClick={() => onAsk(e)} title="Ask the assistant about this item">
                  <ChatIcon size={15} /> Ask
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
