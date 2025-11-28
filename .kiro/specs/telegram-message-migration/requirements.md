# Requirements Document

## Introduction

本專案旨在將現有的 JS/GramJS Telegram 訊息轉發腳本打包成 Mac 可執行檔，讓使用者能夠透過圖形或命令列介面輸入必要資訊（API ID、API Hash、帳號登入憑證、目標帳號 B），自動執行帳號 A 到帳號 B 的訊息遷移作業。整個流程包含驗證登入、對話列舉、群組建立、批次訊息轉發、斷點續傳及流量控制，全部在單一可執行檔內完成。

## Requirements

### Requirement 1: 使用者驗證與帳號登入

**Objective:** 身為使用者，我希望能夠輸入 Telegram API 憑證並完成雙帳號登入，以便開始訊息遷移作業

#### Acceptance Criteria

1. When 使用者啟動應用程式，the Migration Tool shall 提示輸入 API ID 與 API Hash
2. When 使用者輸入 API 憑證後，the Migration Tool shall 驗證憑證格式正確性
3. When API 憑證驗證通過，the Migration Tool shall 引導使用者登入帳號 A（來源帳號）
4. When 帳號 A 登入成功，the Migration Tool shall 引導使用者登入或指定帳號 B（目標帳號）
5. If 帳號登入需要兩步驟驗證碼，then the Migration Tool shall 提示使用者輸入 2FA 密碼
6. If API 憑證格式錯誤或無效，then the Migration Tool shall 顯示明確錯誤訊息並允許重新輸入
7. If 帳號登入失敗（如驗證碼錯誤或帳號被封鎖），then the Migration Tool shall 顯示具體失敗原因
8. The Migration Tool shall 安全儲存 session 資料以支援後續斷點續傳

### Requirement 2: 對話列舉與過濾

**Objective:** 身為使用者，我希望能夠查看並選擇要遷移的對話，以便精確控制遷移範圍

#### Acceptance Criteria

1. When 雙帳號登入成功，the Migration Tool shall 自動列舉帳號 A 的所有對話
2. When 對話列舉完成，the Migration Tool shall 顯示對話清單（包含對話名稱、類型、訊息數量）
3. When 使用者指定對話 ID 過濾條件，the Migration Tool shall 僅列出符合條件的對話
4. When 使用者指定對話類型過濾（私聊、群組、頻道），the Migration Tool shall 僅列出該類型對話
5. When 使用者指定日期範圍過濾，the Migration Tool shall 僅包含該時間範圍內有訊息的對話
6. The Migration Tool shall 支援同時套用多個過濾條件
7. While 對話列舉進行中，the Migration Tool shall 顯示載入進度

### Requirement 3: 目標群組建立與管理

**Objective:** 身為使用者，我希望系統能自動為每個來源對話建立對應的目標群組，以便集中存放遷移後的訊息

#### Acceptance Criteria

1. When 使用者確認要遷移的對話清單，the Migration Tool shall 為每個來源對話建立對應的目標群組
2. When 建立目標群組時，the Migration Tool shall 使用來源對話名稱作為群組名稱（加上可識別前綴或後綴）
3. When 目標群組建立成功，the Migration Tool shall 自動邀請帳號 B 加入該群組
4. If 帳號 B 成功加入群組，then the Migration Tool shall 將帳號 B 設為群組管理員
5. If 群組建立失敗（如達到每日建立上限），then the Migration Tool shall 記錄失敗原因並於限制解除後重試
6. If 同名群組已存在，then the Migration Tool shall 詢問使用者選擇覆寫、跳過或重新命名
7. The Migration Tool shall 記錄來源對話與目標群組的對應關係

### Requirement 4: 批次訊息轉發

**Objective:** 身為使用者，我希望系統能批次轉發訊息到目標群組，以便高效完成大量訊息遷移

#### Acceptance Criteria

1. When 目標群組準備就緒，the Migration Tool shall 開始批次轉發來源對話的訊息
2. When 轉發訊息時，the Migration Tool shall 保留訊息的原始時間順序
3. When 轉發訊息時，the Migration Tool shall 使用 Telegram 原生 forward 功能以保留訊息來源資訊
4. While 批次轉發進行中，the Migration Tool shall 顯示目前進度（已轉發數量/總數量、預估剩餘時間）
5. The Migration Tool shall 支援設定每批次轉發的訊息數量
6. The Migration Tool shall 支援設定批次間的等待間隔
7. If 單則訊息轉發失敗，then the Migration Tool shall 記錄失敗訊息 ID 並繼續處理後續訊息

### Requirement 5: 斷點續傳

**Objective:** 身為使用者，我希望遷移進度能被保存，以便在中斷後能從上次位置繼續

#### Acceptance Criteria

1. The Migration Tool shall 持久化儲存當前遷移進度（已處理的對話、已轉發的訊息 ID）
2. When 遷移過程因任何原因中斷，the Migration Tool shall 在下次啟動時自動偵測未完成的遷移任務
3. When 偵測到未完成的遷移任務，the Migration Tool shall 提示使用者選擇繼續或重新開始
4. When 使用者選擇繼續，the Migration Tool shall 從上次中斷位置開始繼續遷移
5. When 遷移任務完成，the Migration Tool shall 清除該任務的進度記錄
6. The Migration Tool shall 每完成一個批次後自動儲存進度

### Requirement 6: 流量控制與速率限制處理

**Objective:** 身為使用者，我希望系統能智慧處理 Telegram API 限制，以便確保遷移過程穩定不被封鎖

#### Acceptance Criteria

1. When 收到 Telegram FloodWait 錯誤，the Migration Tool shall 自動暫停指定秒數後繼續
2. When 遇到 FloodWait，the Migration Tool shall 顯示等待時間與預計恢復時間
3. The Migration Tool shall 自適應調整請求速率以減少觸發 FloodWait 的機率
4. The Migration Tool shall 設定請求速率上限以符合 Telegram API 使用規範
5. While 處於 FloodWait 等待期間，the Migration Tool shall 顯示倒數計時
6. If 連續多次觸發 FloodWait，then the Migration Tool shall 降低請求速率並記錄警告日誌

### Requirement 7: 即時訊息同步

**Objective:** 身為使用者，我希望在遷移期間新收到的訊息也能被同步，以便確保不遺漏任何訊息

#### Acceptance Criteria

1. While 遷移進行中，the Migration Tool shall 監聽帳號 A 來源對話的新訊息
2. When 偵測到新訊息，the Migration Tool shall 將新訊息加入待轉發佇列
3. When 當前批次歷史訊息轉發完成，the Migration Tool shall 依序轉發佇列中的新訊息
4. The Migration Tool shall 確保新訊息與歷史訊息的轉發順序一致
5. If 即時同步功能發生錯誤，then the Migration Tool shall 記錄錯誤並繼續歷史訊息遷移

### Requirement 8: 進度報告與日誌

**Objective:** 身為使用者，我希望能清楚了解遷移狀態與歷程，以便追蹤遷移進度與排查問題

#### Acceptance Criteria

1. While 遷移進行中，the Migration Tool shall 即時顯示總體進度百分比
2. While 遷移進行中，the Migration Tool shall 顯示當前處理的對話名稱與進度
3. When 遷移完成，the Migration Tool shall 顯示完整的遷移報告（成功/失敗統計、耗時）
4. The Migration Tool shall 將所有操作記錄至日誌檔案
5. The Migration Tool shall 支援設定日誌詳細程度（debug、info、warn、error）
6. If 發生錯誤，then the Migration Tool shall 在日誌中記錄完整錯誤堆疊與上下文

### Requirement 9: Mac 可執行檔打包

**Objective:** 身為使用者，我希望能獲得單一可執行檔，以便無需安裝額外依賴即可使用

#### Acceptance Criteria

1. The Migration Tool shall 打包為 Mac 原生可執行檔（.app 或獨立二進位檔）
2. The Migration Tool shall 內嵌所有必要的 Node.js 執行環境與依賴
3. When 使用者雙擊執行檔，the Migration Tool shall 啟動命令列介面或互動式終端
4. The Migration Tool shall 支援 macOS 12 (Monterey) 及更新版本
5. The Migration Tool shall 支援 Intel (x64) 與 Apple Silicon (arm64) 架構
6. If 執行環境缺少必要權限，then the Migration Tool shall 顯示明確的權限要求說明

### Requirement 10: 安全性與資料保護

**Objective:** 身為使用者，我希望我的帳號憑證與訊息資料受到保護，以便安全地進行遷移

#### Acceptance Criteria

1. The Migration Tool shall 僅在本機儲存 session 資料，不傳輸至任何遠端伺服器
2. The Migration Tool shall 使用 Telegram 官方 MTProto 協定進行所有 API 通訊
3. When 使用者要求清除資料，the Migration Tool shall 安全刪除所有本機儲存的 session 與進度資料
4. The Migration Tool shall 不儲存使用者輸入的密碼或 2FA 驗證碼
5. If 偵測到 session 可能被竄改，then the Migration Tool shall 拒絕使用並提示重新登入
