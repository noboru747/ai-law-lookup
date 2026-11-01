import { firstSentence, shortRef } from '../lib/present.js';

// The key-points card of a result + the traceability widgets of the full mode.
// Everything here is presentation of data that was already validated in lib/generate.js.

/** Scroll to an article card, open it (and every collapsed section around it) and flash it. */
export function jumpToUnit(id) {
  const el = Array.from(document.querySelectorAll('[data-unit-id]')).find((n) => n.dataset.unitId === id);
  if (!el) return false;
  for (let n = el; n; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
  el.querySelector('summary')?.focus({ preventScroll: true });
  return true;
}

function CiteChip({ id, units, docs }) {
  const u = units.get(id);
  return (
    <button type="button" className="cite" data-cite={id} onClick={() => jumpToUnit(id)}>
      {u ? shortRef(u, docs[u.doc_id]) : id}
    </button>
  );
}

/** No AI text: list the most relevant articles (heading + first sentence) instead. */
function FallbackList({ core, docs, note }) {
  return (
    <>
      <h2>這個情況最相關的條文</h2>
      {core.length > 0 ? (
        <ul className="core-list">
          {core.map((it) => (
            <li key={it.unit.id}>
              <button type="button" className="core-row" onClick={() => jumpToUnit(it.unit.id)}>
                <span className="core-ref">{shortRef(it.unit, docs[it.unit.doc_id])}</span>
                <span className="core-text">{it.unit.title?.trim() ? `${it.unit.title}｜${firstSentence(it.unit.text, 36)}` : firstSentence(it.unit.text, 60)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">沒有找到相關條文。</p>
      )}
      <p className="muted small" data-testid="ai-off-note">
        {note}
      </p>
    </>
  );
}

/**
 * gen: from useGeneration. core: the evidence items (used for the no-AI version).
 * offNote overrides the "AI is off" sentence.
 */
export function KeyCard({ gen, core, units, docs, offNote }) {
  if (gen.status === 'loading') {
    return (
      <section className="panel keycard keycard-loading" aria-label="重點" aria-busy="true" data-testid="answer-loading">
        <p className="muted">正在整理重點…（最多 15 秒，下方原文不受影響）</p>
      </section>
    );
  }
  if (gen.status !== 'ok') {
    const note = gen.status === 'failed' ? `這次沒有產生 AI 整理（${gen.reason}），以下為原文。` : (offNote ?? 'AI 整理目前未啟用，以下為原文。');
    return (
      <section className="panel keycard" aria-label="重點" data-testid={gen.status === 'failed' ? 'answer-failed' : 'keycard-fallback'}>
        <FallbackList core={core} docs={docs} note={note} />
      </section>
    );
  }
  const hasPoints = gen.points.length > 0;
  return (
    <section className="panel keycard" aria-label="重點" data-testid="answer">
      {hasPoints ? (
        <>
          {gen.summary && <p className="summary">{gen.summary}</p>}
          <ul className="points" data-testid="points">
            {gen.points.map((p, i) => (
              <li key={i}>
                <span>{p.text}</span>{' '}
                {p.citations.map((id) => (
                  <CiteChip key={id} id={id} units={units} docs={docs} />
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="answer-text" lang="zh-Hant">
          {gen.answer.split(/\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {gen.citations.length > 0 && (
            <div className="chips" data-testid="citations">
              {gen.citations.map((id) => (
                <CiteChip key={id} id={id} units={units} docs={docs} />
              ))}
            </div>
          )}
        </div>
      )}
      {gen.caveats.length > 0 && (
        <p className="caveat-line" data-testid="caveats">
          {gen.caveats.slice(0, 2).map((c, i) => (
            <span key={i} className="caveat-item">
              {c}
            </span>
          ))}
        </p>
      )}
      <p className="ai-tag">AI 整理，以原文為準</p>
    </section>
  );
}

/** "實際用來檢索的詞": where every term of the BM25 query came from. */
export function QueryTrace({ plan, assist, scope }) {
  const rw = assist.rewrite;
  return (
    <details className="trace" data-testid="query-trace">
      <summary>實際用來檢索的詞（可追溯）</summary>
      <dl>
        <dt>你輸入的原文</dt>
        <dd>{plan.original}</dd>
        <dt>同義詞表展開（固定規則，離線也有效）</dt>
        <dd>
          {plan.applied.length === 0 ? (
            <span className="muted">沒有命中任何對照</span>
          ) : (
            <ul>
              {plan.applied.map((a, i) => (
                <li key={i} title={a.note}>
                  「{a.matched}」→ {a.to.join('、')}
                </li>
              ))}
            </ul>
          )}
        </dd>
        <dt>AI 改寫的檢索詞</dt>
        <dd>
          {rw.status === 'ok' && (plan.rewriteTerms.length ? plan.rewriteTerms.join('、') : <span className="muted">沒有新增的詞</span>)}
          {rw.status === 'failed' && <span className="muted">未使用（{rw.reason}），只用同義詞表</span>}
          {rw.status === 'skipped' && <span className="muted">未使用（降級版）</span>}
        </dd>
        <dt>實際送進檢索的字串</dt>
        <dd>
          <code data-testid="final-query">{plan.query}</code>
        </dd>
        <dt>檢索範圍</dt>
        <dd>{scope}</dd>
      </dl>
    </details>
  );
}

export function RoutedBanner({ route, leaf, path, leaves, value, onChange }) {
  const note =
    route.status === 'failed'
      ? `導向服務無法使用（${route.reason}），已在全部條文中檢索。`
      : route.status === 'low'
        ? route.reason ?? '無法確定問題類型，已在全部條文中檢索。'
        : null;
  return (
    <section className="panel routed" aria-label="導向結果" data-testid="routed">
      {leaf ? (
        <p>
          <strong data-testid="routed-to">已導向：{path}</strong>
          {route.status === 'high' && <span className="muted">（AI 判斷，信心高）</span>}
          {route.status !== 'high' && <span className="muted">（你手動選擇）</span>}
        </p>
      ) : (
        note && <p className="muted">{note}</p>
      )}
      <label className="field inline">
        <span className="field-label">{leaf ? '不對？改選：' : '想指定問題類型：'}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} data-testid="route-select">
          <option value="">（不指定，搜尋全部條文）</option>
          {leaves.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
