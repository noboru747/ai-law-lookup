// The 20 lay-wording smoke queries first used for ADR 0007 (unigram weight). They were later
// ALSO used to decide which glossary entries to write (ADR 0010), so they are tuning data, not an
// evaluation set. Phase 5 must use a separate, isolated set.
export const SMOKE = [
  ['網購商品七天鑑賞期可以退貨嗎', ['cpa-019']],
  ['買生鮮食品不能退貨', ['cpa_ex-002']],
  ['百貨公司禮券過期不能用', ['gift-mustnot-001']],
  ['禮券遺失可以補發嗎', ['gift-must-003']],
  ['健身房倒閉了會費要退嗎', ['gym-must-013', 'gym-must-022']],
  ['健身房一直要我續約', ['gym-mustnot-011']],
  ['想轉讓健身房會員資格', ['gym-must-016']],
  ['跟店家談不攏想向消保官申訴', ['cpa-043']],
  ['怎麼申請調解', ['cpa-044', 'cpa_med-003']],
  ['拆封過的光碟可以退嗎', ['cpa_ex-002']],
  ['廣告不實', ['cpa-022']],
  ['消費訴訟可以請求懲罰性賠償金嗎', ['cpa-051']],
  ['定型化契約條款對消費者顯失公平', ['cpa-012']],
  ['健身房簽約後有審閱期嗎', ['gym-must-001']],
  ['客製化商品不能退', ['cpa_ex-002']],
  ['賣家要在幾天內退款給我', ['cpa-019-2']],
  ['7天內退貨', ['cpa-019']],
  ['電商不給退貨', ['cpa-019']],
  ['內衣褲拆了可以退嗎', ['cpa_ex-002']],
  ['線上課程可以退費嗎', ['cpa_ex-002']],
];
