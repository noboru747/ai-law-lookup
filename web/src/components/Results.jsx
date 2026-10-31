import ArticleCard from './ArticleCard.jsx';

const SOURCE_BADGE = {
  rule: '依你的回答帶出',
  seed: '核心條文',
  step: '流程相關',
  bm25: '檢索相關',
};

export function Referral({ templates }) {
  const r = templates.referral;
  return (
    <section className="panel referral" aria-label="轉介提示">
      <h2>{r.title}</h2>
      <ul>
        {r.items.map((it) => (
          <li key={it.name}>
            <strong>
              {it.name} {it.phone}
            </strong>
            <div>{it.text}</div>
          </li>
        ))}
      </ul>
      <p className="muted">{r.note}</p>
    </section>
  );
}

export function Facts({ facts, units }) {
  if (!facts.length) return null;
  return (
    <section className="panel" aria-label="你提供的事實">
      <h2>你提供的事實</h2>
      <dl className="facts">
        {facts.map((f) => (
          <div key={f.slot} className="fact">
            <dt>{f.label}</dt>
            <dd>
              {f.value}
              {f.derived && (
                <div className="derived">
                  {f.derived}
                  {f.cite && units.get(f.cite) ? `（見${units.get(f.cite).law_name}${units.get(f.cite).no_label}）` : ''}
                </div>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Notes({ notes }) {
  if (!notes.length) return null;
  return (
    <section className="panel notes" aria-label="依你的回答整理的提示">
      <h2>依你的回答，請特別對照</h2>
      <ul>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

export function ExternalRefs({ external, units }) {
  if (!external.length) return null;
  return (
    <section className="panel" aria-label="不在收錄範圍的引用">
      <h2>引用了其他法規（不在收錄範圍）</h2>
      <ul className="external">
        {external.map((e) => {
          const from = units.get(e.from_id);
          return (
            <li key={`${e.from_id}|${e.law}|${e.number}`}>
              <strong>
                {e.law}第 {e.number} 條
              </strong>
              <span className="badge badge-ext">不在收錄範圍</span>
              <div className="muted">
                {from ? `${from.law_name} ${from.no_label}` : e.from_id}
                {e.relation === 'mutatis_mutandis' ? ' 準用' : ' 引用'}
                「{e.raw}」，本系統未收錄該法規，不提供條文與連結。
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function badgesFor(item) {
  return [SOURCE_BADGE[item.source]].filter(Boolean);
}

/** Cards for a list of items, with the cited-article section underneath. */
export function ArticleList({ items, engine, heading }) {
  return (
    <section aria-label={heading}>
      {heading && <h2>{heading}</h2>}
      {items.map((it) => (
        <ArticleCard
          key={it.unit.id}
          unit={it.unit}
          doc={engine.docs[it.unit.doc_id]}
          badges={badgesFor(it)}
          marks={it.marks}
          units={engine.byId}
        />
      ))}
    </section>
  );
}

export function RefList({ refs, engine }) {
  if (!refs.length) return null;
  return (
    <section aria-label="被引用的條文">
      <h2>被引用的條文</h2>
      <p className="muted">以下條文沒有被檢索到，是因為上面的條文引用了它們。</p>
      {refs.map((r) => (
        <ArticleCard
          key={r.unit.id}
          unit={r.unit}
          doc={engine.docs[r.unit.doc_id]}
          badges={['被引用帶出']}
          via={r.via}
          units={engine.byId}
          open={r.unit.status !== 'deleted'}
        />
      ))}
    </section>
  );
}

export function Steps({ steps, items, engine }) {
  const byId = new Map(items.map((i) => [i.unit.id, i]));
  const seen = new Set();
  return (
    <section aria-label="處理流程">
      <h2>處理流程</h2>
      <ol className="steps">
        {steps.map((st, idx) => (
          <li key={st.label} className={st.current ? 'step step-current' : 'step'}>
            <div className="step-head">
              <span className="step-n">{idx + 1}</span>
              <span>{st.label}</span>
              {st.current && <span className="badge badge-now">你目前可能在這一步</span>}
            </div>
            {st.unitIds.map((id) => {
              const it = byId.get(id);
              if (!it) return null;
              if (seen.has(id)) {
                return (
                  <p key={id} className="muted see-above">
                    {it.unit.law_name} {it.unit.no_label}（全文見上）
                  </p>
                );
              }
              seen.add(id);
              return (
                <ArticleCard
                  key={id}
                  unit={it.unit}
                  doc={engine.docs[it.unit.doc_id]}
                  badges={badgesFor(it).filter((b) => b !== '流程相關')}
                  marks={it.marks}
                  units={engine.byId}
                  open={st.current || it.marks.length > 0}
                />
              );
            })}
          </li>
        ))}
      </ol>
    </section>
  );
}
