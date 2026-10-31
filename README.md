# ai-law-lookup

消費糾紛法規查詢助理（法規資訊查詢，非法律意見）

## 定位與免責

針對一般民眾常見的消費糾紛，透過問診引導，找出相關的官方條文，並整理成附有引用依據的回答。

本系統僅提供**法規資訊查詢**，不提供法律意見、不對個案下結論。所有條文以官方公布文字為準，法規版本以快照日為準（見 [ADR 0005](docs/decisions/0005-snapshot-date.md)）。本專案為作品集，目的是展示 AI 專案的規劃能力，不是完整的法律產品。

完整規格見 [docs/spec.md](docs/spec.md)；設計決策見 [docs/decisions/](docs/decisions/)；Phase 0 法規核對結果見 [docs/phase0-source-verification.md](docs/phase0-source-verification.md)。

## 進度

| Phase | 內容 | 狀態 |
|---|---|---|
| 0 | 核對候選法規的名稱與官方來源，確定版本快照日 | 進行中 |
| 1 | 資料抓取與解析 → 條文 JSON | 未開始 |
| 2 | 問診樹 JSON + 前端 + 前端檢索 | 未開始 |
| 3 | Ollama 生成層 + Tunnel + 降級切換 | 未開始 |
| 4 | 目錄層 + 轉介資源表 + 非法律模板 | 未開始 |
| 5 | 評測集與量測腳本 | 未開始 |
| 6 | README、設計取捨文件、Demo 影片 | 未開始 |

> 本 README 為簡短版，Phase 6 會重寫。
