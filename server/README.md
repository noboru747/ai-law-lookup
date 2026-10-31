# server/ — 本機生成服務

FastAPI 服務，綁 `127.0.0.1:8790`，對外由 Cloudflare Tunnel 轉發。設計理由見 [ADR 0009](../docs/decisions/0009-generation-service-guardrails.md)。

## 啟動

前置：Ollama 已在 `:11434` 執行，且已 `ollama pull qwen3:14b`。

```powershell
cd server
.\start.ps1          # 安裝 requirements 並啟動；或手動：pip install -r requirements.txt; python -m app
```

檢查：`curl http://127.0.0.1:8790/health` → `{"status":"ok","model":"qwen3:14b"}`（Ollama 不可用或模型不存在時 503）。
不設開機自啟；要停止請關掉該終端機。

## API

| 路由 | 請求 | 回應 |
|---|---|---|
| `GET /health` | | `{"status":"ok","model":...}` / 503 |
| `POST /rewrite` | `{"query","leaf_id"?}` | `{"terms":[...]}` |
| `POST /route` | `{"text"}` | `{"leaf_id":str\|null,"confidence":"high"\|"low"}` |
| `POST /generate` | `{"leaf_id","slots","query"?,"article_ids"}` | `{"answer","citations","caveats"}` |

狀態碼：`400` 未知／已刪除條文或不可生成的葉節點；`422` 格式錯誤、`article_ids` 為空（不呼叫模型）、長度超限；`413` body 過大；`429` 超過頻率；`502` 模型輸出驗證失敗或 Ollama 錯誤（前端降級）；`503` 忙碌。

## 環境變數

`LAW_MODEL`（qwen3:14b）、`OLLAMA_URL`、`LAW_DATA_DIR`、`LAW_HOST`、`LAW_PORT`、`LAW_CORS_ORIGINS`（逗號分隔，支援 `https://*.pages.dev`）、`LAW_MAX_BODY_BYTES`（16384）、`LAW_MAX_QUERY_CHARS`（300）、`LAW_RATE_LIMIT`（每 IP 每窗口 20，0 關閉）、`LAW_RATE_WINDOW_S`（60）、`LAW_BUDGET_S`（14）、`LAW_MAX_CONCURRENCY`（2）、`LAW_KEEP_ALIVE`（30m）。

## 測試

```powershell
python -m pytest -q          # Ollama 以 mock 取代，不需模型
python smoke.py              # 需服務運行中，對真模型各葉節點跑一例並印出摘要
```
