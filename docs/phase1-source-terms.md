# Phase 1 來源使用條款核對

核對日期：2026-10-31。抓取前先讀完條款，結論是**允許抓取**。

## 行政院全球資訊網（www.ey.gov.tw）

- 「政府網站資料開放宣告」（https://www.ey.gov.tw/Page/2EADDBFEDDB6357E）：網站上刊載的所有資料與素材，其受著作權保護的部分採[政府資料開放授權條款－第1版](https://data.gov.tw/license)，以無償、非專屬、得再授權的方式提供，不限時間與地域，可重製、改作、編輯、公開傳輸或做其他利用，開發加值產品或服務，**不須另取得書面授權，使用時應註明出處**。
- 限制：僅及於著作權範圍；經機關特別聲明須經同意的影音、圖像等不在範圍（本專案只取公告文字與附件）；須尊重姓名表示權與禁止不當變更權；**不得惡意變更相關資訊**，利用後呈現的資訊若與原資料不符且可歸責，使用者自負責任；不得暗示機關背書。
- 「隱私權及網站安全政策」（https://www.ey.gov.tw/Page/806F6058055F6695）：禁止未經授權上載或更改網站服務與資訊，並以入侵偵測阻隔惡意行為；單純瀏覽與檔案下載不蒐集個人身分資料。未規定禁止自動化取得公開頁面。
- `robots.txt`（https://www.ey.gov.tw/robots.txt）：僅禁止 `/Upload` 與 `/Program/EY/Hope_decision.ascx`。`fetch_ey.py` 每次執行時以 `urllib.robotparser` 驗證要取得的每個網址皆被允許。
- 結論：可抓取；落實方式——註明出處（`NOTICE.md`）、原文不改寫（驗證腳本逐字比對）、請求間隔至少 3 秒、總共僅 4 個請求加 1 個 robots.txt、User-Agent 標明專案身分。

## 全國法規資料庫（law.moj.gov.tw）

- 「政府網站資料開放宣告」（https://law.moj.gov.tw/Service/Copyright.aspx）：同樣採政府資料開放授權條款－第1版，須註明出處，不得惡意變更資訊。
- `robots.txt` 對 HTML 頁面採預設禁止（`Disallow: /`，僅開放 `/News/NewsDetail.aspx`、`/LawClass/LawAll.aspx`、`/SearchEngineSitemap.aspx`）。本專案**不爬取 HTML 頁面**，只呼叫網站自己公告、供程式下載的 Open API 兩個端點（`/api/ch/law/json`、`/api/ch/order/json`），各下載一次並快取於 `data/raw/_cache/`。
- 說明：Phase 0 查證階段曾以瀏覽方式讀取過少量 HTML 頁面（法規頁、搜尋結果頁、宣告頁、API 文件頁）以確認名稱與使用條款；Phase 1 的抓取程式不含任何 HTML 爬取。
- 網站說明內容每週五更新，因此不需要高頻率重抓。

## 技術備註

Python 3.13 以後預設的嚴格憑證驗證會拒絕全國法規資料庫的憑證鏈（`Missing Subject Key Identifier`）。腳本改以 `curl` 下載（使用作業系統信任庫驗證完整憑證鏈），**沒有關閉驗證**。
