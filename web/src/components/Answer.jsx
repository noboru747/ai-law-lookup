// Generated answer + the traceability widgets of the full mode.
// Everything here is presentation of data that was already validated in lib/generate.js.

/** Scroll to an article card, open it and flash it. Cards carry data-unit-id (ArticleCard). */
export function jumpToUnit(id) {
  const el = Array.from(document.querySelectorAll('[data-unit-id]')).find((n) => n.dataset.unitId === id);
  if (!el) return false;
  if (el.tagName === 'DETAILS') el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('flash');
  el.querySelector('summary')?.focus({ preventScroll: true });
  return true;
}

export function AnswerPanel({ gen, units }) {
  if (gen.status === 'off') return null;
  if (gen.status === 'loading') {
    return (
      <section className="panel answer answer-loading" aria-label="AI 整理回答" aria-busy="true" data-testid="answer-loading">
        <h2>AI 整理回答</h2>
        <p className="muted">正在整理回答…（最多等待 15 秒；下方原文不受影響）</p>
      </section>
    );
  }
  if (gen.status === 'failed') {
    return (
      <section className="panel answer answer-failed" aria-label="AI 整理回答" data-testid="answer-failed">
        <h2>AI 整理回答</h2>
        <p>
          這次沒有產生 AI 回答（原因：{gen.reason}）。以下僅顯示法規原文，內容與降級版相同。
        </p>
      </section>
    );
  }
  return (
    <section className="panel answer" aria-label="AI 整理回答" data-testid="answer">
      <div className="answer-head">
        <h2>AI 整理回答</h2>
        <span className="badge badge-ai">AI 整理，以下方原文為準</span>
      </div>
      <div className="answer-text" lang="zh-Hant">
        {gen.answer.split(/\n+/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {gen.caveats.length > 0 && (
        <div className="caveats" role="note" data-testid="caveats">
          <strong>請特別留意</strong>
          <ul>
            {gen.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="citations" data-testid="citations">
        {gen.citations.length > 0 ? (
          <>
            <span className="muted">引用條文（點擊跳到下方原文）：</span>
            {gen.citations.map((id) => {
              const u = units.get(id);
              return (
                <button key={id} type="button" className="cite" data-cite={id} onClick={() => jumpToUnit(id)}>
                  {u ? `${u.law_name} ${u.no_label}` : id}
                </button>
              );
            })}
          </>
        ) : (
          <span className="muted">這則回答沒有引用特定條文，請直接閱讀下方原文。</span>
        )}
      </div>
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
