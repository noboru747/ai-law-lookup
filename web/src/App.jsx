import { useEffect, useMemo, useState } from 'react';
import { loadCorpus } from './lib/corpus.js';
import { createEngine } from './lib/engine.js';
import { tree } from './lib/tree.js';
import { runLeaf, runFreeform, activeValues } from './lib/retrieve.js';
import { checkHealth, MODES } from './lib/generate.js';
import { useRoute, hrefNode, hrefResult } from './lib/route.js';
import { ArticleList, ExternalRefs, Facts, Notes, RefList, Referral, Steps } from './components/Results.jsx';

const corpus = loadCorpus();
const engine = createEngine(corpus);

function Header({ health }) {
  return (
    <header className="site-header">
      <div className="bar">
        <a className="brand" href="#/">
          消費糾紛法規查詢助理
        </a>
        <span className={`mode mode-${health.mode}`} role="status" data-testid="mode">
          {health.label}
        </span>
      </div>
      <div className="disclaimer" data-testid="disclaimer">
        {tree.templates.disclaimer}
      </div>
    </header>
  );
}

function Footer() {
  const m = corpus.manifest;
  return (
    <footer className="site-footer">
      <p>
        <strong>法規資訊查詢，非法律意見。</strong>
        條文以快照日為準，之後的修正不會自動反映。
      </p>
      <p data-testid="snapshot">
        資料快照日：{m.snapshot_date}　資料出處：全國法規資料庫（法務部）、行政院全球資訊網（行政院）
      </p>
      <p className="muted">
        {m.attribution}；授權：{m.license}。詳見儲存庫的 NOTICE.md。
      </p>
    </footer>
  );
}

function Crumbs({ id }) {
  const path = tree.path(id).filter((n) => n.id !== 'root');
  return (
    <nav className="crumbs-nav" aria-label="位置">
      <a href="#/">首頁</a>
      {path.map((n, i) => (
        <span key={n.id}>
          {' › '}
          {i === path.length - 1 ? n.label : <a href={hrefNode(n.id)}>{n.label}</a>}
        </span>
      ))}
    </nav>
  );
}

function leafTarget(n) {
  if (n.kind === 'out_of_scope') return hrefResult(n.id);
  return hrefNode(n.id);
}

function Menu({ node }) {
  return (
    <main>
      <Crumbs id={node.id} />
      <h1>{node.label}</h1>
      <ul className="choices">
        {node.children.map((c) => (
          <li key={c.id}>
            <a className="choice" href={c.kind === 'menu' ? hrefNode(c.id) : leafTarget(c)} data-node={c.id}>
              <span className="choice-label">{c.label}</span>
              {c.description && <span className="choice-desc">{c.description}</span>}
              {c.kind === 'out_of_scope' && <span className="badge badge-ext">不在收錄範圍</span>}
              {c.kind === 'freeform' && <span className="badge">未經問診</span>}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

function slotShown(slot, vals) {
  if (!slot.show_if) return true;
  return Object.entries(slot.show_if).every(([k, allowed]) => allowed.includes(vals[k]));
}

function SlotForm({ leaf }) {
  const [vals, setVals] = useState({});
  const shown = useMemo(() => {
    const act = activeValues(leaf, vals);
    return leaf.slots.filter((s) => slotShown(s, act));
  }, [leaf, vals]);
  const act = activeValues(leaf, vals);
  const missing = shown.some((s) => s.required && !act[s.id]);

  function submit(e) {
    e.preventDefault();
    if (missing) return;
    window.location.hash = hrefResult(leaf.id, act);
  }

  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <p className="lead">{leaf.description}</p>
      <form onSubmit={submit} className="slot-form" aria-label="補充情況">
        <p className="muted">只問會影響結果的欄位，一次填完。不確定的可以選「不確定」或留白。</p>
        {shown.map((s) => (
          <label key={s.id} className="field">
            <span className="field-label">
              {s.label}
              {s.required && <span className="req"> *</span>}
            </span>
            {s.type === 'date' ? (
              <input
                type="date"
                name={s.id}
                value={vals[s.id] ?? ''}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setVals({ ...vals, [s.id]: e.target.value })}
              />
            ) : (
              <select name={s.id} value={vals[s.id] ?? ''} onChange={(e) => setVals({ ...vals, [s.id]: e.target.value })}>
                <option value="">（請選擇）</option>
                {s.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </label>
        ))}
        <button type="submit" className="primary" disabled={missing}>
          查看相關條文
        </button>
      </form>
    </main>
  );
}

function FreeformInput({ node, initial = '' }) {
  const [text, setText] = useState(initial);
  const tpl = tree.templates.freeform;
  function submit(e) {
    e.preventDefault();
    if (text.trim()) window.location.hash = hrefResult(node.id, { q: text.trim() });
  }
  return (
    <main>
      <Crumbs id={node.id} />
      <h1>{node.label}</h1>
      <div className="banner" role="note">
        <strong>{tpl.banner}</strong>
        <div>{tpl.detail}</div>
      </div>
      <form onSubmit={submit} className="slot-form" aria-label="自由輸入">
        <label className="field">
          <span className="field-label">用自己的話描述你的情況</span>
          <textarea name="q" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="例如：網路買的課程想退費" />
        </label>
        <button type="submit" className="primary" disabled={!text.trim()}>
          搜尋條文
        </button>
      </form>
    </main>
  );
}

function ScopeLine({ leaf }) {
  const names = [];
  for (const e of leaf.law_scope ?? []) {
    const d = corpus.docs[e.doc];
    const extra = [e.part && [].concat(e.part).join('／'), e.section, e.chapter && e.chapter.replace(/^第.章\s*/, ''), e.ids && '指定條文']
      .filter(Boolean)
      .join('、');
    names.push(`${d.short_name || d.law_name}${extra ? `（${extra}）` : ''}`);
  }
  return <p className="muted scope">檢索範圍（由問診結果決定）：{names.join('、')}</p>;
}

function QueryResult({ leaf, params }) {
  const res = useMemo(() => runLeaf(engine, leaf, params), [leaf, params]);
  const pinned = res.items.filter((i) => i.source !== 'bm25');
  const rest = res.items.filter((i) => i.source === 'bm25');
  const isProcess = leaf.kind === 'process';
  const stepIds = new Set(res.steps.flatMap((s) => s.unitIds));
  const nonStepPinned = pinned.filter((i) => !stepIds.has(i.unit.id));
  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <p className="lead">{leaf.intro}</p>
      <Facts facts={res.facts} units={engine.byId} />
      <Notes notes={res.notes} />
      {leaf.caveat && <p className="caveat">{leaf.caveat}</p>}
      <ScopeLine leaf={leaf} />
      {isProcess ? (
        <>
          <Steps steps={res.steps} items={res.items} engine={engine} />
          <ArticleList items={nonStepPinned} engine={engine} heading="依你的回答帶出的條文" />
        </>
      ) : (
        <ArticleList items={pinned} engine={engine} heading="依你的情況帶出的條文" />
      )}
      <ArticleList items={rest.filter((i) => !stepIds.has(i.unit.id))} engine={engine} heading="其他相關條文（關鍵字檢索）" />
      <RefList refs={res.refs} engine={engine} />
      <ExternalRefs external={res.external} units={engine.byId} />
      <Referral templates={tree.templates} />
      <p>
        <a href={hrefNode(leaf.id)}>修改回答</a>　<a href="#/">回到首頁</a>
      </p>
    </main>
  );
}

function OutOfScope({ leaf }) {
  const t = tree.templates.out_of_scope;
  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <section className="panel oos" aria-label="範圍外">
        <h2>{t.heading}</h2>
        <p>{t.body}</p>
        <h3>{t.related_label}</h3>
        <ul>
          {leaf.related_laws.map((l) => (
            <li key={l.name}>
              {l.name}
              {l.topic ? `（${l.topic}）` : ''}
              <span className="badge badge-ext">不在收錄範圍</span>
            </li>
          ))}
        </ul>
        <p>{leaf.reason}</p>
      </section>
      <Referral templates={tree.templates} />
      <p>
        <a href="#/">回到首頁</a>
      </p>
    </main>
  );
}

function FreeformResult({ leaf, params }) {
  const tpl = tree.templates.freeform;
  const res = useMemo(() => runFreeform(engine, params.q ?? ''), [params.q]);
  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <div className="banner" role="note" data-testid="freeform-banner">
        <strong>{tpl.banner}</strong>
        <div>{tpl.detail}</div>
      </div>
      <p className="lead">
        你輸入的內容：<q>{params.q}</q>
      </p>
      {res.items.length === 0 ? (
        <p className="panel">{tpl.empty}</p>
      ) : (
        <ArticleList items={res.items} engine={engine} heading="關鍵字檢索結果（全部收錄條文）" />
      )}
      <RefList refs={res.refs} engine={engine} />
      <ExternalRefs external={res.external} units={engine.byId} />
      <Referral templates={tree.templates} />
      <p>
        <a href={hrefNode(leaf.id)}>重新輸入</a>　<a href="#/">回到首頁</a>
      </p>
    </main>
  );
}

function Screen({ route }) {
  const node = tree.node(route.id);
  if (!node) {
    return (
      <main>
        <h1>找不到這個頁面</h1>
        <a href="#/">回到首頁</a>
      </main>
    );
  }
  if (route.name === 'result') {
    if (node.kind === 'out_of_scope') return <OutOfScope leaf={node} />;
    if (node.kind === 'freeform') return <FreeformResult leaf={node} params={route.params} />;
    if (node.kind === 'menu') return <Menu node={node} />;
    return <QueryResult leaf={node} params={route.params} />;
  }
  if (node.kind === 'menu') return <Menu node={node} />;
  if (node.kind === 'out_of_scope') return <OutOfScope leaf={node} />;
  if (node.kind === 'freeform') return <FreeformInput node={node} />;
  return <SlotForm key={node.id} leaf={node} />;
}

export default function App() {
  const route = useRoute();
  const [health, setHealth] = useState({ ...MODES.degraded, reason: 'checking' });
  useEffect(() => {
    let alive = true;
    checkHealth().then((h) => alive && setHealth(h));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="app">
      <Header health={health} />
      <Screen key={`${route.name}:${route.id}:${JSON.stringify(route.params)}`} route={route} />
      <Footer />
    </div>
  );
}
