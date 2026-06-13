# 架構說明 ARCHITECTURE

本文件說明 AI 小說生成器的整體架構、各元件職責、請求流程，以及幾個「不直覺但重要」的設計決策（多半是實測 Ollama 行為後才定案的）。

> README 是給使用者看的；本文件是給維護／開發者看的。

---

## 1. 總覽

一個極簡的本地小說生成工具，沒有資料庫、沒有前端框架、沒有建置步驟。三層：

```
┌──────────────┐   HTTP / fetch    ┌──────────────┐   HTTP stream   ┌──────────────┐
│   瀏覽器      │ ───────────────►  │   FastAPI     │ ──────────────► │   Ollama      │
│ (原生 JS UI) │ ◄───────────────  │  (app.py)     │ ◄────────────── │ (本機 LLM)    │
└──────────────┘   text/JSON       └──────────────┘   NDJSON         └──────────────┘
                                          │
                                          ▼
                                    data/*.json
                                 (歷史、自訂範本)
```

- **前端**：純 HTML/CSS/JS，由 FastAPI 當靜態檔提供。無框架、無打包。
- **後端**：FastAPI，主要做兩件事 —— 把瀏覽器請求**串流轉發**給 Ollama，並提供歷史/範本的 CRUD。
- **模型**：本機 Ollama，後端從不內嵌模型，只透過 HTTP 與其溝通。
- **儲存**：兩個 JSON 檔（`data/history.json`、`data/templates.json`），掛載為 Docker volume 持久化。

設計原則：**後端薄、前端自足、零外部相依（除了 Ollama）**。

---

## 2. 檔案地圖

```
.
├── app.py                # FastAPI 後端：models / generate(串流) / history / templates
├── requirements.txt      # fastapi, uvicorn, httpx
├── Dockerfile            # python:3.12-slim
├── docker-compose.yml    # 對外 6789、掛 ./data、host-gateway 連主機 Ollama
├── static/
│   ├── index.html        # UI 結構，所有文字標 data-i18n
│   ├── style.css         # 深色主題、分頁、歷史、可搜尋下拉樣式
│   ├── app.js            # 全部前端邏輯（IIFE 包裹）
│   └── i18n.js           # 語言字典 + 題材對照 + prompt 模板（IIFE 包裹）
├── data/                 # 執行時產生（gitignored），volume 掛載
│   ├── history.json
│   └── templates.json
├── README.md
├── ARCHITECTURE.md       # 本文件
└── LICENSE               # GPL-3.0
```

---

## 3. 後端（app.py）

### 3.1 API 一覽

| 方法 | 路徑 | 說明 |
|---|---|---|
| `GET` | `/` | 回傳 index.html（帶 no-cache） |
| `GET` | `/api/models` | 向 Ollama `/api/tags` 取已安裝模型，回排序後清單 |
| `POST` | `/api/generate` | **串流**生成小說（回 `text/plain` 串流，非 JSON） |
| `GET` | `/api/history` | 歷史列表（摘要：不含全文，附 preview） |
| `POST` | `/api/history` | 新增一筆歷史 |
| `GET` | `/api/history/{id}` | 取單筆（含全文與設定） |
| `DELETE` | `/api/history/{id}` | 刪除單筆 |
| `DELETE` | `/api/history` | 清空全部 |
| `GET` | `/api/templates` | 範本列表（內建 + 自訂） |
| `POST` | `/api/templates` | 新增自訂範本 |
| `DELETE` | `/api/templates/{id}` | 刪除自訂範本（內建不可刪） |

### 3.2 靜態檔與快取

`NoCacheStaticFiles`（繼承 `StaticFiles`）對每個回應加 `Cache-Control: no-cache, must-revalidate`。
> 為什麼自訂子類別而非 middleware：早期版本用 `@app.middleware` 包 StaticFiles，是 Starlette 的已知雷區；改用子類別覆寫 `get_response`，不經 middleware、零風險。配合 index.html 內的 `?v=` 版本參數雙保險，徹底解決「改了 JS/CSS 卻沒反應」。

### 3.3 儲存層

- `_load_json_list(path)` / `_save_json_list(path, records)`：通用 JSON 陣列讀寫。
- **原子寫入**：先寫 `*.json.tmp` 再 `rename`，避免中途崩潰留下壞檔。
- **執行緒鎖**：`_history_lock`、`_templates_lock`（FastAPI 同步 endpoint 跑在 threadpool，需保護並發寫入）。
- 歷史每筆：`{id, created_at, title, settings, content}`；列表只回 `_summary()`（含 `preview`、`char_count`，不含全文）。
- 範本：內建 5 個寫死在 `BUILTIN_TEMPLATES`（`name` 是 i18n key，前端依語言顯示）；自訂存在 `templates.json`。`GET` 時回「內建 + 自訂」合併，內建的 `id` 以 `builtin-` 開頭、不可刪。

---

## 4. 生成串流：`/api/generate`（最關鍵的部分）

這是整個系統最複雜、也最多血淚的地方。`event_stream()` 是一個 async generator，逐塊處理 Ollama 的 NDJSON 回應，經過層層保護後 yield 純文字給瀏覽器。

### 4.1 流程

```
瀏覽器 POST {model, prompt, system, temperature, num_predict}
   │
   ▼
組 payload（stream:true）→ httpx 串流 POST 到 Ollama /api/generate
   │
   ▼  逐行 NDJSON chunk：
   ├─ chunk.error 含 "loading"  → 模型載入中，等 3s 重試（最多 60 次 ≈ 5 分鐘）
   ├─ chunk.error 其他          → yield 錯誤訊息並結束
   ├─ chunk.response            → 經 think 過濾器 → 經「實質內容」緩衝 → yield
   └─ chunk.done                → 若全程無實質內容 → 空輸出重試（最多 4 次）
```

### 4.2 四道保護（每一道都對應一個實測踩到的坑）

1. **載入中自動重試** (`max_loading=60`)
   大模型（20GB+）載入時，Ollama 對請求直接回 `{"error":"...loading model"}`。早期版本忽略這種 chunk → 前端一個字都收不到、看似卡死。現在偵測到就等 3 秒重試，對使用者透明（畫面維持「生成中…」）。

2. **空輸出自動重試** (`max_empty=4`)
   某些 merge 模型（如 `Qwen3.6-40B-Claude-...`）的第一個 token **隨機**就是結束符（EOS），導致 0 字輸出。實測同一 prompt 連跑數次、有些 0 字有些正常 → 確認是機率性。偵測到「正常結束但無實質內容」就立即重試。

3. **`<think>` 思考過濾器** (`_make_think_filter`)
   思考型模型把推理寫在 `response` 裡的 `<think>...</think>` 區塊，正文在後面。過濾器是一個**串流式狀態機**，可處理跨 chunk 被切斷的標籤（用 `_prefix_len` 暫存可能的標籤前綴），移除 `<think>...</think>` 與孤立的 `</think>`，對無標籤的一般模型完全透明。

4. **「實質內容」緩衝**
   實質（非空白）內容出現前，先存進 `buffer` 不 yield；一旦出現非空白字元才 flush 並切換為即時串流。好處：上面的空輸出重試可以「悄悄」重來，失敗的嘗試（只吐了空白或被過濾光）完全不會顯示給使用者。

> 另一個重要決定：**只取 `response`，忽略 `thinking` 欄位**。`thinking` 是模型的思考，不該當正文顯示；正文一律在 `response`。早期曾用 `response or thinking` fallback，會把思考垃圾當小說顯示，已移除。
>
> 還有：**不送 `think:false`**。當初為思考型模型加的，但實測它會讓某些模型直接吐 EOS（完全不輸出）；而思考內容本來就靠上面的過濾器處理，所以這個參數有害無益、已拿掉。

---

## 5. 前端

兩個檔案，都用 **IIFE `(function(){ ... })()` 包裹**。

> 為什麼 IIFE：兩個 `<script>` 共用同一個全域 lexical scope。`i18n.js` 頂層 `const LANGS` 與 `app.js` 頂層 `const { LANGS } = ...` 會撞成 `Identifier 'LANGS' has already been declared`，導致 app.js 整個解析失敗、所有 UI 死掉。IIFE 把內部變數關起來，只透過 `window.NOVEL_I18N` 溝通。

### 5.1 i18n.js — 語言與文案資料

匯出 `window.NOVEL_I18N = { LANGS, OUTPUT_LANGS, GENRES, I18N, PROMPT_TMPL, t }`：

- `LANGS`：5 種**介面**語言（zh-TW / en / ja / zh-CN / ko）。
- `OUTPUT_LANGS`：12 種**輸出**語言（含注入模型用的英文語言名）。
- `GENRES`：12 種題材，`key`（穩定值）＋ `labels`（各介面語言顯示）＋ `prompt`（中性英文描述）。
- `I18N`：介面字串字典，每語言 81 個 key，由 `t(key, lang)` 查詢（找不到回退 zh-TW，再回退 key 本身）。
- `PROMPT_TMPL`：**生成指令模板**，依 zh/ja/ko/en 分組（見 §6）。

### 5.2 app.js — 全部互動邏輯

主要區塊：
- **i18n 套用**：`applyI18n()` 掃 `[data-i18n]` / `[data-i18n-ph]` / `[data-i18n-title]` 替換文字；切換語言即時生效並寫入 `localStorage`。題材、模型首項提示也會重繪。
- **可搜尋下拉** `makeSearchable(select)`：見 §7。
- **模型 / 範本 / 歷史**：各自的載入、渲染、CRUD。
- **生成** `generate()`：組 prompt → fetch `/api/generate` → 讀串流 → 邊收邊顯示字數/秒數 → 完成自動存歷史。
- **分頁**：創作 / 歷史兩個 tab。

---

## 6. Prompt 組裝（多語言）

由 `buildPrompt()` 組成，送往後端的 `prompt` 欄位。關鍵決定：**指令用「輸出語言」本身撰寫**。

> 實測：用英文指令叫某些中文 merge 模型寫中文，模型會直接吐 EOS、完全不輸出。改用中文指令就正常。因此 `PROMPT_TMPL` 依輸出語言切換指令語言：zh-TW/zh-CN → `zh`，ja → `ja`，ko → `ko`，其餘 → `en`。

一段 prompt 由模板片語拼成：題材（`GENRES` 對應語言的 label）＋ 目標字數 ＋ 關鍵字/大綱 ＋（可選）參考範文 ＋ 寫作要求 ＋「請全程使用 {語言} 撰寫」。系統提示詞（`defaultSystem`）也用同一語言模板。

---

## 7. 可搜尋下拉選單（makeSearchable）

純原生 combobox，零套件，套用於全部 6 個 `<select>`（語言切換、模型、範本、類型、輸出語言、字數）。

設計重點 —— **包裝而非取代**：
- 原生 `<select>` 隱藏保留，仍是唯一的「值來源」；所有既有的 `change` 事件邏輯（套用範本、字數自訂欄連動、語言切換）完全不用改。
- 疊上一個 `<input>`（可打字）＋ 搜尋面板。打字即時過濾、↑↓ 移動、Enter 選取、Esc / 點外面關閉。
- 選取時 `select.value = v` 並 `dispatchEvent('change')`，與原邏輯無縫接軌。
- **自動同步**：用 `Object.defineProperty` 攔截 `select.value` 的 setter，再用 `MutationObserver` 監聽 options 變動 —— 所以程式動態填模型、切換語言、載入歷史設定時，輸入框顯示會自動更新，呼叫端不需特別處理。

模型下拉的首項是提示「— 共 N 個模型，請選擇 —」（`value=""`），引導選擇；未選時生成會被擋下並提示。

---

## 8. 資料與設定

### 持久化
`data/history.json`、`data/templates.json`，透過 compose 的 `./data:/app/data` volume 掛載，`docker compose down` 不會刪除。`app` 啟動時自動 `mkdir`。

### 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `OLLAMA_URL` | `http://host.docker.internal:11434` | Ollama API 位址 |
| `HOST` | `0.0.0.0`（容器內） | 監聽位址 |
| `PORT` | `6789` | 連接埠 |
| `DATA_DIR` | `./data` | 歷史與範本儲存目錄 |

### 容器連主機 Ollama
compose 用 `extra_hosts: host.docker.internal:host-gateway`，讓容器內能連到跑在主機上的 Ollama。

---

## 9. 設計決策摘要（為什麼這樣做）

| 決策 | 原因 |
|---|---|
| 不用前端框架 / 不打包 | 工具極簡，原生足夠，零建置、好維護 |
| 後端只做串流轉發 + CRUD | 模型由 Ollama 負責，後端保持薄 |
| JSON 檔而非資料庫 | 單人本地工具，資料量小，可直接備份/檢視 |
| 兩個 JS 檔都包 IIFE | 避免共用全域作用域的 `const` 重複宣告衝突 |
| 指令用輸出語言撰寫 | 英文指令會讓部分中文模型完全不輸出 |
| 不送 `think:false` | 對某些模型會造成 0 輸出；思考改用過濾器處理 |
| 只取 `response`、過濾 `<think>` | 思考內容不該當正文；正文一律在 response |
| 空輸出 / 載入中自動重試 | 吸收 Ollama 與 merge 模型的不穩定行為 |
| 可搜尋下拉用「包裝」而非「取代」 | 不動既有 change 邏輯，風險最小 |
| 靜態檔 no-cache + `?v=` | 確保改檔後瀏覽器一定拿到新版 |

---

## 10. 本地開發

```bash
# 直接跑（需先 pip install -r requirements.txt 與本機 Ollama）
python app.py            # 127.0.0.1:6789

# 或 Docker
docker compose up -d --build
```

前端是純靜態檔，改完 `static/` 內容後硬刷新瀏覽器（no-cache 會自動帶新版）即可，無需重建容器；改 `app.py` 才需重啟/重建。
