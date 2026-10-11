# WorkMood 心情烘焙屋

把「我好煩」變成「我知道下一步」。依原簡報的員工端流程製作：對話釐清 → 事件／感受／需求 → A/B/C → 修改確認 → 保存與行動回顧。

## 立即試用

打開 `docs/index.html` 即可使用**規則展示模式**。如果瀏覽器不允許檔案儲存，請啟動本機服務：

```sh
python server.py
```

使用 Python 3.10 以上，本機不需額外套件。開啟 `http://127.0.0.1:8780`。

先按「試試期限突然提前」並送出，再回答「想先確認三項工作的優先順序」，就會出現可修改的整理卡。勾選確認後保存，到「我的紀錄」標記行動完成。

**規則模式只用來試流程，不是真正 Chatbot 的模型效果。** 真正 AI 模式由下面的後端串接啟用。這份專案尚未使用真實 API 金鑰完成模型實測。

## 放上 GitHub

1. 新建一個 GitHub 儲存庫，例如 `workmood`。
2. 將**本資料夾內的內容**放在儲存庫根目錄。根目錄應直接看到 `docs`、`backend`、`README.md` 等，不要再多包一層資料夾。不要只上傳 ZIP。
3. 在儲存庫 `Settings → Pages`，Source 選 `Deploy from a branch`，Branch 選 `main`，資料夾選 `/docs`，儲存。
4. 等待部署完成，以 Pages 顯示的網址開啟。相對資源路徑支援 `https://帳號.github.io/workmood/` 這類專案網址。

GitHub Pages 只託管靜態網頁，不能執行 Python 或保管 AI 金鑰。因此這一步完成後是規則展示；要真正聊天，接著部署後端。[GitHub 官方說明](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

## 啟用真正 Chatbot

### 先在自己電腦測試

在專案資料夾的 PowerShell 設定環境變數：

```powershell
$env:OPENAI_MODEL = '填入你帳戶可使用且支援 Structured Outputs 的模型 ID'
$secret = Read-Host 'OpenAI API key' -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $secret).Password
python server.py
```

重新開啟網頁，狀態顯示 AI 對話；勾選本次對話傳送同意後即可聊天。金鑰不要填在網頁、GitHub、config.js、聊天訊息或截圖中。AI 狀態表示設定存在，需成功回覆才能確認帳戶與模型有效。

### GitHub Pages + AI 後端

後端可部署到支援 Python WSGI 的主機。以下以 Render 的 Web Service 為例；本次沒有建立雲端服務、付費資源或代填 API 金鑰。

1. 在 Render 建立 Python Web Service，連接同一個 GitHub 儲存庫。
2. Build command：`pip install -r requirements.txt`
3. Start command：`gunicorn backend.app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 70`
4. 在**主機後台**設定下表環境變數。
5. 成功後取得後端 HTTPS 網址，填入 `docs/config.js` 的 `apiBase`，提交 GitHub。
6. 重新開啟 Pages，在「設定與隱私」輸入試用碼，再以虛構案例完成真正模型對話測試。

| 變數 | 內容 |
|---|---|
| `OPENAI_API_KEY` | 你的模型 API 金鑰，只放主機後台 |
| `OPENAI_MODEL` | 帳戶可用且支援 Responses + Structured Outputs 的模型 ID |
| `WORKMOOD_PUBLIC` | `1` |
| `DEMO_ACCESS_CODE` | 自訂至少 12 個字元的私密試用碼，與 API 金鑰不同 |
| `PUBLIC_URL` | 後端 HTTPS origin，例如你實際的 Render 服務網址；Render 也會提供 `RENDER_EXTERNAL_URL` |
| `ALLOWED_ORIGINS` | 前端 origin，例如 `https://你的帳號.github.io`，**不含儲存庫路徑**；多個以逗號分隔 |

`docs/config.js` 範例（請替換成你實際的後端網址）：

```js
window.WORKMOOD_CONFIG = { apiBase: "https://你的後端服務網址" };
```

後端也能直接提供同一套網頁；若只用後端網站，`apiBase` 留空即可。不要在前端放 `DEMO_ACCESS_CODE`。試用码須透過適合的方式提供給試用者；它只是展示存取限制，不是員工登入系統。

Render 的 Python 建置及啟動方式參考[官方部署文件](https://render.com/docs/deploy-flask)。請自行確認主機方案與模型費用，本文不宣稱免費或已上線。

## 真正 AI 怎麼運作

```text
瀏覽器中的本次對話
  → 後端驗證來源、試用碼、同意與長度
  → 安全提示規則
  → OpenAI Responses API（傳入本次多輪對話）
  → 嚴格 JSON Schema ＋ 本機欄位驗證
  → 追問，或顯示可修改整理卡
  → 使用者確認後存於自己的瀏覽器
```

- 模型可讀本次前文；每次最多追問一個問題。使用者可隨時按「整理成下一步」。
- `backend/prompt.txt` 是可版本管理的系統規格；`backend/app.py` 定義格式、驗證與失敗處理。
- 模型拒答、逾時或格式錯誤時顯示錯誤並保留可重試的訊息；**不偷偷切成固定回覆**。
- 不永久儲存對話，不使用過往個人紀錄作為模型輸入。`store:false` 不等於所有供應商資料留存都關閉，仍適用其政策。
- [OpenAI 多輪對話文件](https://developers.openai.com/api/docs/guides/conversation-state)、[結構化輸出文件](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)。

## 與簡報的對應

| 簡報 | 本版 |
|---|---|
| 5、8、9：感受到行動 | 選擇感受、對話、整理卡、保存與回顧 |
| 7：A/B/C | 個人調整、溝通協調、組織／資源支持 |
| 10、11：Prompt 與結構輸出 | 多輪上下文、可追問、固定欄位、後端驗證 |
| 12：確認權與邊界 | 可修改、確認後才存、刪除、無企業分享、風險提示 |
| 13：模組化架構 | 前端 + Python API + LLM；n8n 及資料庫保留未來規劃，沒有宣稱已實作 |
| 14：验证 | 已附自動測試；真實使用者試用、模型品質與成本待驗證 |
| 15：企業試點 | 仍屬後續階段；本版不建立企業監控功能 |

## 限制與資料

這是單人 MVP，不是已通過隱私或心理安全驗證的正式企業服務。沒有登入、跨裝置同步或資料加密；共用瀏覽器的人可能讀到相同紀錄。不要用真實敏感事件測試。

公開模式必須配置試用碼；後端包含每程序 20 次/分鐘、200 次/24 小時的展示限制，重啟會重置。正式部署仍需身份系統、集中式配額與監控。不要把 CORS 當成身份驗證。

安全關鍵字可能誤判或漏判，模型也可能出錯。本產品不能診斷、裁定職場責任或自動處理危機。

## 檔案與驗證

```text
docs/                  GitHub Pages 網頁
backend/app.py         對話 API、Schema 與安全邊界
backend/prompt.txt     Prompt 規格
tests/test_api.py      後端行為測試，不呼叫真實模型
server.py              本機開發服務
.github/workflows/     GitHub 自動檢查
```

執行 `python -m unittest discover -s tests -v` 和 `node --check docs/app.js`。
專案未包含原始員工紀錄、API 金鑰或虛構成效數字。原始 Java 檔案未修改。
