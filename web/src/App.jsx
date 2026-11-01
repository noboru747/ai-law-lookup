import { useEffect, useMemo, useState } from 'react';
import { loadCorpus } from './lib/corpus.js';
import { createEngine } from './lib/engine.js';
import { tree } from './lib/tree.js';
import { runLeaf, runFreeform, activeValues } from './lib/retrieve.js';
import { checkHealth, MODES } from './lib/generate.js';
import { assistFreeform, routableLeaf, SKIPPED } from './lib/assist.js';
import { planQuery } from './lib/glossary.js';
import { citableIds, freeformRequest, HealthContext, useGeneration, useHealth } from './lib/useGeneration.js';
import { KeyCard, QueryTrace, RoutedBanner } from './components/Answer.jsx';
import { splitEvidence, SHORT_NAMES } from './lib/present.js';
import { useRoute, hrefNode, hrefResult } from './lib/route.js';
import { Cards, ExternalRefs, FactsLine, Notes, Referral, Steps } from './components/Results.jsx';

const corpus = loadCorpus();
const engine = createEngine(corpus);

function Header({ health }) {
  return (
    <header className="site-header">
      <div className="bar">
        <a className="brand" href="#/">
          消費糾紛法規查詢助理
        </a>
        <span className={`mode mode-${health.mode}`} role="status" data-testid="mode" title={health.model ? `模型：${health.model}` : undefined}>
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
      <p data-testid="snapshot">
        條文以 {m.snapshot_date} 快照為準，之後的修正不會自動反映。資料出處：全國法規資料庫（法務部）、行政院全球資訊網（行政院）。
      </p>
      <p className="muted">
        {m.attribution}；授權：{m.license}。詳見儲存庫的 NOTICE.md。
      </p>
    </footer>
  );
}

function Crumbs({ id }) {
  const node = tree.node(id);
  // The free-text entry is reached from the home page, so don't show it under the third category.
  const path = node?.kind === 'freeform' ? [{ id, label: '自己描述' }] : tree.path(id).filter((n) => n.id !== 'root');
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

const FREEFORM_NODE = tree.leaves().find((l) => l.kind === 'freeform');

/** Home-page entry: describe the situation in your own words (routed by the service in full mode, plain BM25 otherwise). */
function HomeSearch() {
  const [text, setText] = useState('');
  function submit(e) {
    e.preventDefault();
    if (text.trim()) window.location.hash = hrefResult(FREEFORM_NODE.id, { q: text.trim() });
  }
  return (
    <form onSubmit={submit} className="slot-form home-search" aria-label="直接描述你遇到的狀況" data-testid="home-search">
      <label className="field">
        <span className="field-label">直接描述你遇到的狀況</span>
        <textarea
          name="q"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：網購的衣服尺寸不合想退"
        />
      </label>
      <button type="submit" className="primary" disabled={!text.trim()}>
        搜尋相關條文
      </button>
      <p className="muted small">用自己的話寫即可。</p>
    </form>
  );
}

function Menu({ node }) {
  const isRoot = node.id === 'root';
  // The free-text entry lives on the home page only; hide the duplicate under the third category.
  const children = node.children.filter((c) => c.kind !== 'freeform');
  return (
    <main>
      <Crumbs id={node.id} />
      {isRoot ? <HomeSearch /> : null}
      <h1>{isRoot ? '或從常見情況開始' : node.label}</h1>
      <ul className="choices">
        {children.map((c) => (
          <li key={c.id}>
            <a className="choice" href={c.kind === 'menu' ? hrefNode(c.id) : leafTarget(c)} data-node={c.id}>
              <span className="choice-label">{c.label}</span>
              {c.description && <span className="choice-desc">{c.description}</span>}
              {c.kind === 'out_of_scope' && <span className="choice-desc">不在收錄範圍</span>}
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
        <p className="muted small">不確定的可以選「不確定」或留白。</p>
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
      <p className="muted small">{tpl.banner}：{tpl.detail}</p>
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
    names.push(`${shortName(e.doc, d)}${extra ? `（${extra}）` : ''}`);
  }
  return <p className="muted small scope">檢索範圍：{names.join('、')}</p>;
}

const shortName = (docId, d) => SHORT_NAMES[docId] ?? d.short_name ?? d.law_name;

/**
 * The result layout shared by every result page. Key points on top, details folded away:
 *   key card -> what you can do -> evidence (cited / core articles, collapsed) -> more (collapsed)
 * `leaf` is null for un-routed free text. `aiNote` replaces the "AI is off" sentence.
 */
function ResultBody({ leaf, res, gen, aiNote, showSteps = true }) {
  const cited = gen.status === 'ok' ? gen.citations : [];
  const { core, more } = useMemo(
    () => splitEvidence({ items: res.items, refs: res.refs ?? [], cited }),
    [res, gen.status === 'ok' ? gen.citations.join('|') : ''],
  );
  const isProcess = leaf?.kind === 'process' && res.steps;
  const hasAi = gen.status === 'ok';
  const external = res.external ?? [];
  const empty = res.items.length === 0;
  return (
    <>
      <KeyCard gen={gen} core={core} units={engine.byId} docs={engine.docs} offNote={aiNote} />
      <Notes notes={res.notes} open={!hasAi} />

      <section className="panel todo" aria-label="你可以怎麼做">
        <h2>你可以怎麼做</h2>
        {isProcess && showSteps && <Steps steps={res.steps} items={res.items} docs={engine.docs} />}
        <Referral templates={tree.templates} />
      </section>

      {!empty && (
        <section aria-label="依據條文" className="evidence">
          <h2>依據條文（{core.length}）</h2>
          {leaf?.caveat && <p className="caveat">{leaf.caveat}</p>}
          <Cards items={core} engine={engine} />
        </section>
      )}

      {(more.length > 0 || external.length > 0 || leaf) && (
        <details className="more" data-testid="more">
          <summary>更多相關條文（{more.length}）</summary>
          {leaf && <ScopeLine leaf={leaf} />}
          <Cards items={more} engine={engine} />
          <ExternalRefs external={external} units={engine.byId} />
        </details>
      )}
    </>
  );
}

function QueryResult({ leaf, params }) {
  const res = useMemo(() => runLeaf(engine, leaf, params), [leaf, params]);
  const request = useMemo(
    () => ({ leafId: leaf.id, slots: res.vals, query: null, articleIds: citableIds(res.items) }),
    [leaf, res],
  );
  const gen = useGeneration(request);
  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <p className="lead">{leaf.intro}</p>
      <FactsLine facts={res.facts} units={engine.byId} />
      <ResultBody leaf={leaf} res={res} gen={gen} />
      <p className="back-links">
        <a href={hrefNode(leaf.id)}>修改回答</a>　<a href="#/">回到首頁</a>
      </p>
    </main>
  );
}

function OutOfScopePanel({ leaf }) {
  const t = tree.templates.out_of_scope;
  return (
    <section className="panel oos" aria-label="範圍外">
      <h2>{t.heading}</h2>
      <p>{t.body}</p>
      <h3>{t.related_label}</h3>
      <ul>
        {leaf.related_laws.map((l) => (
          <li key={l.name}>
            {l.name}
            {l.topic ? `（${l.topic}）` : ''}
          </li>
        ))}
      </ul>
      <p className="muted">{leaf.reason}</p>
    </section>
  );
}

function OutOfScope({ leaf }) {
  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <OutOfScopePanel leaf={leaf} />
      <section className="panel todo" aria-label="你可以怎麼做">
        <h2>你可以怎麼做</h2>
        <Referral templates={tree.templates} />
      </section>
      <p className="back-links">
        <a href="#/">回到首頁</a>
      </p>
    </main>
  );
}

const ROUTABLE = tree.leaves().filter((l) => ['query', 'process', 'out_of_scope'].includes(l.kind));

function FreeformResult({ leaf, params }) {
  const tpl = tree.templates.freeform;
  const health = useHealth();
  const text = params.q ?? '';
  const full = health.mode === 'full';

  // Step 1 (full mode only): ask the service where this belongs and for statute keywords.
  const [fetched, setFetched] = useState({ key: null });
  useEffect(() => {
    if (!full) return undefined;
    let alive = true;
    assistFreeform(text, { tree }).then((a) => alive && setFetched({ key: text, ...a }));
    return () => {
      alive = false;
    };
  }, [full, text]);
  const assist = !full ? SKIPPED : fetched.key === text ? fetched : null; // null = still waiting
  const waiting = health.mode === 'checking' || assist === null;

  // The user can override the router; `undefined` means "follow the router".
  const [override, setOverride] = useState(undefined);
  const autoId = assist?.route.status === 'high' ? assist.route.leafId : null;
  const routedId = override !== undefined ? override : autoId;
  const routedLeaf = routableLeaf(tree, routedId);

  // Step 2: deterministic retrieval over the plan (glossary + rewrite terms).
  const plan = useMemo(() => planQuery(text, { rewriteTerms: assist?.rewrite.terms ?? [] }), [text, assist]);
  const searchable = routedLeaf?.kind !== 'out_of_scope';
  const scoped = routedLeaf && searchable ? routedLeaf : null;
  const res = useMemo(() => {
    if (waiting || !searchable) return null;
    return scoped ? runLeaf(engine, scoped, {}, { extraQuery: plan.query }) : runFreeform(engine, text, { query: plan.query });
  }, [waiting, searchable, scoped, plan, text]);

  // Step 3 (full mode): generate from the articles that are actually on screen.
  const request = useMemo(() => (res ? freeformRequest({ routedLeaf: scoped, text, items: res.items }) : null), [res, scoped, text]);
  const gen = useGeneration(request);

  const scopeText = scoped ? `${scoped.label}（由問診節點決定的範圍）` : '全部收錄條文';
  const routePath = routedLeaf
    ? tree
        .path(routedLeaf.id)
        .filter((n) => n.id !== 'root')
        .map((n) => n.label)
        .join(' › ')
    : '';
  const aiNote = full && !scoped ? '未經問診，不產生 AI 整理；可在上方選擇問題類型。' : undefined;
  return (
    <main>
      <Crumbs id={leaf.id} />
      <h1>{leaf.label}</h1>
      <p className="lead" data-testid="freeform-banner">
        你輸入：<q>{text}</q>　<span className="tag-warn">{tpl.banner}</span>
      </p>
      {waiting ? (
        <p className="panel" role="status" data-testid="freeform-waiting">
          {health.mode === 'checking' ? '正在檢查生成服務…' : '正在判斷問題類型…（最多等約 15 秒，之後自動改用固定規則檢索）'}
        </p>
      ) : (
        <>
          {full && (
            <RoutedBanner
              route={assist.route}
              leaf={routedLeaf}
              path={routePath}
              leaves={ROUTABLE}
              value={routedId ?? ''}
              onChange={(v) => setOverride(v || null)}
            />
          )}
          {routedLeaf && !searchable && <OutOfScopePanel leaf={routedLeaf} />}
          {res &&
            (res.items.length === 0 ? (
              <>
                <p className="panel">{tpl.empty}</p>
                <section className="panel todo" aria-label="你可以怎麼做">
                  <h2>你可以怎麼做</h2>
                  <Referral templates={tree.templates} />
                </section>
              </>
            ) : (
              <ResultBody leaf={scoped} res={res} gen={gen} aiNote={aiNote} />
            ))}
          {!(routedLeaf && !searchable) && (
            <>
              <QueryTrace plan={plan} assist={assist} scope={scopeText} />
              {scoped && (
                <p className="muted small">
                  這是依導向節點檢索的結果，<a href={hrefNode(scoped.id)}>填寫問診</a>可讓條文更貼合你的情況。
                </p>
              )}
            </>
          )}
        </>
      )}
      {routedLeaf && !searchable && (
        <section className="panel todo" aria-label="你可以怎麼做">
          <h2>你可以怎麼做</h2>
          <Referral templates={tree.templates} />
        </section>
      )}
      <p className="back-links">
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
  const [health, setHealth] = useState({ ...MODES.checking, reason: 'checking' });
  useEffect(() => {
    let alive = true;
    checkHealth().then((h) => alive && setHealth(h));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <HealthContext.Provider value={health}>
      <div className="app">
        <Header health={health} />
        <Screen key={`${route.name}:${route.id}:${JSON.stringify(route.params)}`} route={route} />
        <Footer />
      </div>
    </HealthContext.Provider>
  );
}
