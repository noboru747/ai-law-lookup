# ai-law-lookup

消費糾紛法規查詢助理（法規資訊查詢，非法律意見）

## 定位與免責

針對一般民眾常見的消費糾紛，透過問診引導，找出相關的官方條文，並整理成附有引用依據的回答。

本系統僅提供**法規資訊查詢**，不提供法律意見、不對個案下結論。所有條文以官方公布文字為準，法規版本以快照日為準（見 [ADR 0005](docs/decisions/0005-snapshot-date.md)）。本專案為作品集，目的是展示 AI 專案的規劃能力，不是完整的法律產品。

完整規格見 [docs/spec.md](docs/spec.md)；設計決策見 [docs/decisions/](docs/decisions/)；Phase 0 法規核對結果見 [docs/phase0-source-verification.md](docs/phase0-source-verification.md)；資料格式見 [data/README.md](data/README.md)；來源使用條款核對見 [docs/phase1-source-terms.md](docs/phase1-source-terms.md)。

## 進度

| Phase | 內容 | 狀態 |
|---|---|---|
| 0 | 核對候選法規的名稱與官方來源，確定版本快照日 | 完成 |
| 1 | 資料抓取與解析 → 條文 JSON | 完成（6 份文件、231 筆 unit、120 條引用邊；見 [data/README.md](data/README.md)） |
| 2 | 問診樹 JSON + 前端 + 前端檢索 | 完成（降級版可獨立運作，見下方「本機啟動」） |
| 3 | Ollama 生成層 + Tunnel + 降級切換 | 未開始 |
| 4 | 目錄層 + 轉介資源表 + 非法律模板 | 未開始 |
| 5 | 評測集與量測腳本 | 未開始 |
| 6 | README、設計取捨文件、Demo 影片 | 未開始 |

> 本 README 為簡短版，Phase 6 會重寫。

## 資料出處與授權

條文資料來自全國法規資料庫（法務部）與行政院全球資訊網（行政院），依政府資料開放授權條款－第1版使用。詳見 [NOTICE.md](NOTICE.md)。

## 重建資料

```
pip install -r scripts/requirements.txt
python scripts/fetch_moj.py && python scripts/fetch_ey.py   # 已有快取時不會重新下載，--force 可重抓
python scripts/build_corpus.py
python scripts/validate.py && python scripts/test_refs.py
```

## 本機啟動（Phase 2 前端）

需要 Node.js 20 以上。前端在 `web/`，條文（`data/laws/`）與問診樹（`data/tree.json`）在 build 時直接從原位置匯入，不會複製一份。

```
cd web
npm install
npm run dev        # 開發伺服器 http://localhost:5173
npm test           # tokenizer、問診樹完整性、各葉節點檢索、deleted 條文、降級邏輯
npm run build      # 輸出純靜態檔到 web/dist（尚未部署）
```

目前沒有生成服務：頁首會顯示「降級版（未連線生成服務）」。Phase 3 只需設定環境變數 `VITE_API_URL`（參考 `web/.env.example`）。設計說明見 [ADR 0007](docs/decisions/0007-chinese-tokenizer.md)、[ADR 0008](docs/decisions/0008-consultation-tree-as-data.md)。
