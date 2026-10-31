// One unit (article / point / preamble / table row) with its provenance.
// The text is shown verbatim; `marks` only highlight substrings of it.

export function markSegments(text, marks = []) {
  const ranges = [];
  for (const m of marks) {
    if (!m) continue;
    let i = text.indexOf(m);
    while (i >= 0) {
      ranges.push([i, i + m.length]);
      i = text.indexOf(m, i + m.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const out = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: text.slice(pos, a), mark: false });
    out.push({ text: text.slice(a, b), mark: true });
    pos = b;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out.length ? out : [{ text, mark: false }];
}

function fmtDate(iso) {
  return iso ? iso.slice(0, 10) : '';
}

export default function ArticleCard({ unit, doc, badges = [], marks = [], via = [], units, open = true }) {
  const deleted = unit.status === 'deleted';
  const crumbs = [unit.chapter, unit.section, unit.part].filter(Boolean);
  return (
    <details className={`card${deleted ? ' card-deleted' : ''}`} open={open} data-unit-id={unit.id}>
      <summary>
        <span className="card-title">
          <span className="card-no">{unit.no_label}</span>
          <span className="card-law">{unit.law_name}</span>
        </span>
        <span className="badges">
          {deleted && <span className="badge badge-deleted">已刪除</span>}
          {badges.map((b) => (
            <span key={b} className="badge">
              {b}
            </span>
          ))}
        </span>
      </summary>
      <div className="card-body">
        {unit.title && <div className="card-heading">{unit.title}</div>}
        {crumbs.length > 0 && <div className="crumbs">{crumbs.join(' › ')}</div>}
        {via.length > 0 && (
          <div className="via">
            被{' '}
            {via
              .map((v) => {
                const from = units?.get(v.from_id);
                return `${from ? `${from.law_name} ${from.no_label}` : v.from_id}（${v.relation === 'mutatis_mutandis' ? '準用' : '引用'}「${v.raw}」）`;
              })
              .join('、')}{' '}
            引用帶出
          </div>
        )}
        <div className="law-text" lang="zh-Hant">
          {markSegments(unit.text, marks).map((s, i) =>
            s.mark ? (
              <mark key={i}>{s.text}</mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </div>
        {deleted && <div className="muted">本條已刪除，僅為說明引用關係而列出。</div>}
        <dl className="prov">
          <dt>所屬文件</dt>
          <dd>{unit.law_name}</dd>
          <dt>主管機關</dt>
          <dd>{doc?.authority}</dd>
          <dt>資料發布</dt>
          <dd>{doc?.source?.publisher}</dd>
          <dt>出處</dt>
          <dd>
            <a href={unit.source_url} target="_blank" rel="noreferrer noopener">
              官方原文頁面
            </a>
            （擷取於 {fmtDate(unit.fetched_at)}）
          </dd>
        </dl>
      </div>
    </details>
  );
}
