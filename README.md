# GRE Roots

手機優先的 GRE Roots 字根背誦 App。使用者可以自由選擇第 1–5 份，以 Flashcard 翻面學習，並用「還不熟／有點模糊／記住了」標記記憶程度。

## 分類規則

原始資料共 2,078 字，包括 538 個一般字根家族與 464 個無字根（S）單字。新版五份使用下列規則：

1. 同一字根家族永遠放在同一份，不拆散相關單字。
2. 字根家族數配成 `108 / 108 / 108 / 107 / 107`。
3. 先以家族單字量做負荷平衡，再用 S 單字補齊每份總量。
4. 最終單字量為 `416 / 416 / 416 / 415 / 415`。
5. S 單字平均穿插在字根家族之間，避免集中成難以背誦的大區塊。

| Part | 字根家族 | 有字根單字 | S 單字 | 總單字 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 108 | 324 | 92 | 416 |
| 2 | 108 | 323 | 93 | 416 |
| 3 | 108 | 323 | 93 | 416 |
| 4 | 107 | 322 | 93 | 415 |
| 5 | 107 | 322 | 93 | 415 |

## 功能

- 五份學習卡自由選擇
- 正反面 Flashcard：音標、中文、英文定義、例句與字根
- 英文單字依可用寬度自動縮小並保持單行；詞性使用 `n.`、`v.`、`adj.` 等簡寫，放在音標或中文意思標題旁，不占用單字的寬度
- 卡片背面將來源中的同義字、反義字與記憶提示分開呈現，資料檢查會確認每段 `[類]` 同義字完整保留
- 英文一律使用裝置提供的高品質 `en-US` 合成語音，優先選擇 Natural、Neural、Premium、Enhanced 或 Google US English 等自然語音
- 可選擇翻到解釋時是否自動播放 AI／裝置合成中文發音，設定保存在目前裝置，亦可在卡片背面手動播放
- 中文一律使用裝置提供的高品質 `zh-TW` 合成語音；中英文使用相同播放介面與相同音量值
- 字卡自動連播：英文播完後翻面，可選 3–30 秒最低停留時間；等待所有語音播完才換卡，並可隨時暫停
- 英文發音完整播放後會記錄已聽進度；首頁最下方可展開查看各份進度
- 字卡可隨時回到目前清單的第一個單字
- 字卡上方只保留兩排精簡控制：「連播／一般／詳細」及「秒數／中文／篩選」；學習方式與背誦進度放在字卡下方，熟悉程度按鈕可停留在視窗下緣
- 1000 字 Part 1 固定順序的前 10 字，以及 Part 4、Part 5 全部單字（各 217 字），在解釋旁提供對應意思的 AI 圖片；正面與測驗不顯示圖片，其他單字維持原樣。圖片只表達其中一個意思，不取代完整解釋；預載目前及接下來 10 字的可用圖片，語音與換字不等待圖片。圖片讀取失敗時恢復純文字，字卡高度不變
- 首頁與每份字卡顯示背誦進度，包括已背、剩餘、總字數與完成百分比
- 使用 ChatGPT 帳號登入；新帳號先進入待審核，核准後才能讀取單字與發音資料
- 管理員可在 App 內核准、拒絕或撤銷帳號；指定管理員帳號受到保護，無法被撤銷
- 全部／待複習／已記住篩選
- 單字、中文意思與字根搜尋
- 字根家族快速切換、隨機排序、左右滑動
- App 不另設密碼，登入由 ChatGPT 處理
- 背誦與已聽進度依登入帳號及字書分開保存在裝置與 Sites 資料庫；選書首頁會讀取兩本字書的雲端進度
- 斷線後自動重試同步，恢復連線或回到網頁時會重新比對；同時更新會保留兩台裝置的紀錄
- 舊版未標記帳號的本機進度保留原檔，可在選書頁確認歸屬後匯入一次，不會自動混入其他帳號
- 待複習清單完成一張後接續下一張；英文定義、例句及記憶提示依來源標籤分欄，原始文字保留供核對

## 開發

配圖的提示詞、意思範圍、檔案雜湊與檢視記錄見 [前 10 字配圖記錄](docs/word-illustrations-first10.json)及 [Part 4、Part 5 配圖記錄](docs/word-illustrations-parts4-5.json)。Part 4、Part 5 共 434 張字卡使用 430 個圖檔，4 筆共用關係及原因逐筆記錄。發布用圖片保存在 `public/images/words/`；若有原始生成圖片，可用 `node scripts/prepare-word-image.mjs WORD_ID SOURCE_IMAGE [SHARP_MODULE_PATH]` 重新縮小與壓縮。此工具需要開發環境提供 `sharp`，不會覆寫既有圖片；網站執行不需此套件。重新生成 AI 圖片不保證得到相同畫面。執行 `node scripts/import-word-illustrations.mjs` 可由已提交的 Part 4、Part 5 配圖記錄重建前端對應表；`images:validate` 會檢查涵蓋範圍、圖片內容雜湊與替代文字是否一致。

圖片使用最多 480 × 480 像素的靜態 WebP。預載會先讓文字與語音啟動，背景同時最多下載 2 張，範圍只含目前與接下來 10 字；換清單時取消過期下載，並釋放範圍外的圖片物件參照。每筆背景下載超過 8 秒會中止，後續可重試。圖片採低下載優先度與非同步解碼提示，不加入語音及連播的等待條件。`images:validate` 包含下載卡住、失敗重試、快速切換與連播獨立性的模擬檢查；這些檢查不等同於 Android Firefox 實機效能量測。

```bash
pnpm install
pnpm dev
```

完整檢查：

```bash
pnpm check
```

若要從 Excel 重新產生資料，預設會讀取專案上一層的最終工作簿；也可指定路徑：

```powershell
$env:GRE_SOURCE_XLSX = "C:\path\to\workbook.xlsx"
pnpm run data:export
```

GRE 單字資料的原始 PDF、工作簿與密碼不會納入此 repository。

## 詞性資料

兩本字書的詞性來自 Princeton WordNet 3.0 的完整單字索引；未收錄的 18 個字另行核對，來源見 `data/parts-of-speech-supplement.json`。同一單字的多種詞性以 `/` 並列。這是字典收錄的詞性，不是逐句判斷例句中的用法，也不宣稱涵蓋所有字典的每種用法。中文解釋、單字拼寫與學習進度識別碼均保持不變。

可重建的索引與來源檔案 SHA-256 見 `data/parts-of-speech.json`；授權全文隨網站保存在 `public/licenses/wordnet.txt`。依該檔記錄的網址下載並核對 WordNet ZIP，解壓後執行 `node scripts/import-parts-of-speech.mjs PATH_TO_WORDNET`，再執行 `node scripts/repair-vocabulary.mjs`。原始工作簿匯出流程亦會帶入同一份詞性索引。

核對時發現原中文解釋中 `drollness` 寫作「滑稽的」，但字典明確列為名詞；`mitigant` 的形容詞用法已被所查字典標為舊用法。此次只補詞性，不擅自改寫原教材解釋。`cosseted`、`flagged` 按所查字典列為動詞變化形式，未把原形名詞的詞性套用到這些字形。

來源：[WordNet 檔案格式](https://wordnet.princeton.edu/documentation/wndb5wn)、[WordNet 授權](https://wordnet.princeton.edu/license-and-commercial-use)、[droll／drollness](https://www.merriam-webster.com/dictionary/droll)、[mitigant](https://www.merriam-webster.com/dictionary/mitigant)。

## 英文發音

完整英文單字使用瀏覽器與作業系統提供的 `en-US` 合成語音。播放時先選名稱包含 Natural、Neural、Premium、Enhanced 或 Online 的聲音，再選 Google US English、Samantha、Ava、Jenny、Aria 或 Joanna 等常見自然語音；若裝置未提供這些聲音，則使用可用的美式英語合成語音。

## 發音模式

字卡可切換「一般發音／詳細發音」，設定保存在目前裝置。一般模式維持原本的單字發音與中文開關；詳細模式依序念完整單字、每個英文字母名稱、再念完整單字，然後自動翻面念中文。例如 `apple → A、P、P、L、E → apple → 蘋果`。重複字母會逐一念出，空格與連字號不念；帶重音的拉丁字母使用基本字母名稱。詳細模式包含中文，不會覆寫一般模式的中文開關。測驗維持一般發音，避免拼字測驗直接揭露答案。

自動連播會等待整段英文、拼字與中文結束；語音失敗時停止連播，不會默默跳到下一字。暫停、換字或切換模式會取消舊語音。

詳細模式的 A–Z 使用獨立美式真人字母錄音，不再以 `ay`、`bee` 等替代文字呼叫語音合成。26 個 WAV 音檔與網站一起發布，先預載及解碼，再使用同一個音訊時鐘排程；每個字母統一為 0.5 秒、字母間隔 0.1 秒、完整單字與拼讀間隔 0.3 秒。音檔已經過降噪、爆音處理與保留音高的時間調整，N 的底噪另行加強處理。重複字母會各自播放，取消時會停止目前及尚未播放的字母，下載失敗可重試。

來源與個別作者、授權、剪裁及音量調整紀錄見 [字母錄音授權](public/audio/letters-v2/attribution.json)。CC BY-SA 3.0 音檔的調整版本沿用該授權，其餘為公共領域。使用獨立語音辨識核對實際 WAV 的 A–Z、打亂順序及重複字母測例；此為音檔辨識驗證，不代表人工聽感評分，結果見 [驗證報告](docs/letter-audio-verification.json)及[降噪與長度檢查](docs/letter-audio-cleanup.json)。

原版保留在 `public/audio/letters-v1`；`python scripts/prepare-letter-audio.py` 會從原版重新產生 `letters-v2`。此開發流程需要 numpy、scipy、imageio-ffmpeg 及包含 rubberband 的 FFmpeg，手機不需安裝。新檔案使用不同網址，避免手機沿用舊快取。

## 中文發音

中文一律使用瀏覽器與作業系統提供的合成語音；先限定臺灣中文 `zh-TW`／`zh-Hant`，再挑選 Natural、Premium、Enhanced 等較自然的聲音。裝置沒有臺灣中文時才採其他中文語音。網站不再播放教育部或 Wikimedia Commons 的中文真人錄音。
