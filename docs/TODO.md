# 待辦清單

最後更新 2026-11-01，Phase 0–3 完成，正式站 https://ai-law-lookup.pages.dev

## Phase 4：目錄層＋轉介＋範圍判斷

- [ ] 目錄層：其他行業的應記載事項、周邊法規（民法買賣瑕疵擔保、公平交易法、食品安全衛生管理法、商品標示法等），只辨識名稱，說明不在收錄範圍後轉介（spec 2.2）
- [ ] 轉介資源表：人工維護、只收公部門／公益機構，每筆附 source 與 last_verified，內容包含 1950 消費者服務專線、各縣市消保官、法律扶助基金會、地方法院訴訟輔導、律師公會免費法律諮詢；前端目前 1950 是寫死的，要改成查表
- [ ] 範圍判斷 [1]：為非法律問題與緊急狀況（失火、自傷等）建立固定模板

## Phase 5：評測

- [ ] 建立評測題目，並與同義詞表、smoke 20 題、prompt 完全隔離（smoke 題同時是同義詞表和 tokenizer 的調參資料，不能拿來評測）
- [ ] 題目來源依序為：主管機關 FAQ、消保處爭議案例、新聞（注意當時的法規版本）、判決書事實
- [ ] 量測檢索：純 BM25 與加上 pin/seed 後的結果分開量
- [ ] 量測引用正確率
- [ ] 量測行為：該答、該追問、該拒答、該轉介
- [ ] 量測範圍外題組與跨範圍題組
- [ ] 量測模型品質問題：措辭偏肯定（如「可無條件退貨」）、語意超出條文（如禮券「已過期可依履約保障要求履約」）、/generate 偶發 502 的比例
- [ ] 依數據決定是否加向量檢索（候選 bge-m3）
- [ ] （選做）qwen2.5:7b 對 qwen3:14b 的比較

## Phase 6：展示

- [ ] README：正式站網址、架構圖、各層分工理由、設計取捨、已知限制（不處理緊急狀況、以快照日為準、未查立法院修正草案、模型語意錯誤無法由程式驗證）
- [ ] Demo 影片（避免面試時後端離線）

## 零碎待辦

- [ ] 健身中心公告令號差異：行政院列表頁寫 1100039418A，PDF 寫 1100039418D，待核對
- [ ] 全國法規資料庫的單條深連結格式尚未實測，目前每筆只連到法規頁
- [ ] 後端禁用詞表補上「違規」等詞；評估「summary 必須以『條文規定』開頭」是否過嚴、是否造成 502
- [ ] 冷啟動：Ollama keep_alive 30 分鐘後模型會卸載，第一個請求可能逾時並降級，可考慮延長 keep_alive
- [ ] （選配）後端開機自動啟動，目前要手動執行 `server\start.ps1`
- [ ] `C:\CODE\lab\ComfyUI_TGBOt_Web\docker\cloudflared-config.yml` 已加 law-api 路由，但在那個 repo 尚未 commit
- [ ] 正式站若改用自訂網域，後端 CORS 白名單（LAW_CORS_ORIGINS）要加上該網域
- [ ] （選配）wrangler 4.129 → 4.156 更新

## 下次啟動提醒

- 後端：`cd C:\CODE\ai-law-lookup\server; .\start.ps1`（127.0.0.1:8790，經 law-api.waniagent.top 對外）
- 重新部署前端：`cd C:/CODE/ai-law-lookup/web; npm run build`，再到 `C:/CODE/tool/wrangler-tools` 執行 `npx wrangler pages deploy C:/CODE/ai-law-lookup/web/dist --project-name=ai-law-lookup --branch=main`
