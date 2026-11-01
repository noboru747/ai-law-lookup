import ArticleCard from './ArticleCard.jsx';
import { jumpToUnit } from './Answer.jsx';
import { shortRef } from '../lib/present.js';

/** "還需要協助時": one compact line, the phone number is tappable. */
export function Referral({ templates }) {
  const r = templates.referral;
  return (
    <>
      {r.items.map((it) => (
        <p key={it.name} className="help-line">
          <a className="tel" href={`tel:${it.phone}`}>
            撥 {it.phone}
          </a>{' '}
          <strong>{it.name}</strong>
          <span className="muted">　{it.text}</span>
        </p>
      ))}
    </>
  );
}

/** What the user told us, as one muted line (plus the derived "N days since" remark when there is one). */
export function FactsLine({ facts, units }) {
  if (!facts?.length) return null;
  return (
    <div className="facts-line" aria-label="你提供的事實">
      <span>你的情況：{facts.map((f) => f.value).join('、')}</span>
      {facts
        .filter((f) => f.derived)
        .map((f) => (
          <div key={f.slot} className="derived">
            {f.derived}
            {f.cite && units.get(f.cite) ? `（見${units.get(f.cite).law_name}${units.get(f.cite).no_label}）` : ''}
          </div>
        ))}
    </div>
  );
}

export function Notes({ notes, open }) {
  if (!notes?.length) return null;
  return (
    <details className="notes" open={open} aria-label="依你的回答整理的提示">
      <summary>依你的回答，要特別對照（{notes.length}）</summary>
      <ul>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

/** Process leaves: the steps as a compact list; units are chips that jump to the card below. */
export function Steps({ steps, items, docs }) {
  const byId = new Map(items.map((i) => [i.unit.id, i]));
  return (
    <ol className="steps" aria-label="處理流程">
      {steps.map((st, idx) => (
        <li key={st.label} className={st.current ? 'step step-current' : 'step'}>
          <div className="step-head">
            <span className="step-n">{idx + 1}</span>
            <span>{st.label}</span>
            {st.current && <span className="badge badge-now">可能在這步</span>}
          </div>
          <div className="chips">
            {st.unitIds
              .map((id) => byId.get(id))
              .filter(Boolean)
              .map((it) => (
                <button key={it.unit.id} type="button" className="cite" onClick={() => jumpToUnit(it.unit.id)}>
                  {shortRef(it.unit, docs[it.unit.doc_id])}
                </button>
              ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Cards for a list of items (all collapsed). */
export function Cards({ items, engine }) {
  return items.map((it) => (
    <ArticleCard key={it.unit.id} unit={it.unit} doc={engine.docs[it.unit.doc_id]} marks={it.marks} via={it.via ?? []} units={engine.byId} />
  ));
}

export function ExternalRefs({ external, units }) {
  if (!external.length) return null;
  return (
    <div className="external-refs">
      <h3>引用了未收錄的法規</h3>
      <ul>
        {external.map((e) => {
          const from = units.get(e.from_id);
          return (
            <li key={`${e.from_id}|${e.law}|${e.number}`}>
              {e.law}第 {e.number} 條
              <span className="muted">
                {' '}
                （{from ? `${from.no_label}` : e.from_id}
                {e.relation === 'mutatis_mutandis' ? ' 準用' : ' 引用'}；本系統未收錄）
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
