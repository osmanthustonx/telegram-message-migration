# Requirements Document

## Project Description (Input)
我有個Telegram的A帳號,想要把裡面所有的聊天訊息,包含機器人,群組,個人訊息,Channel等等的所有每個訊息都遷移到B帳號裡面。 那遷移的方式就有點像是forward,就是forward訊息那種方式。 但是每一個聊天室,像是什麼Channel啊,Private Channel,Private Chat啊,Group Chat啊,等等等等的,每一個Chat的訊息都是上千上萬則。 那我該用什麼樣的方式可以有效的把這些訊息forward到B帳號裡面?比較希望「A的chat(個人/群組) → 對應B那邊create多個chat group + forward」。整體流程設計

你要做的其實是這幾步：

用 A 帳號 登入（Userbot，不是 Bot token）

抓出 A 的所有 dialogs（個人、群組、頻道）

為每個 dialog 建立一個新群組（group / megagroup），並讓 B 在群組中

把該 dialog 的所有訊息，從 A 那裡 forward 到「對應的新群組」

做好 FloodWait（節流）處理、斷點續傳等機制

⚠️ 建群組的動作技術上是 A 在創建群組，然後把 B 加進去，所以 B 也會看到這些群。

整個技術採用 GramJS

## Introduction
本文件定義 Telegram 訊息遷移工具的功能需求。此工具使用 GramJS 函式庫，實現將 A 帳號的所有對話（包含私人聊天、群組、頻道、機器人對話）遷移至 B 帳號可存取的新群組中。遷移採用訊息轉發（forward）方式，並具備流量控制與斷點續傳機制，確保大量訊息能穩定且完整地遷移。

## Requirements

### Requirement 1: 帳號驗證與連線
**Objective:** 作為使用者，我希望能以 Userbot 方式登入 A 帳號，以便取得完整的 API 存取權限進行訊息遷移。

#### Acceptance Criteria
1. When 使用者提供 API ID、API Hash 及電話號碼, the Migration Service shall 初始化 GramJS TelegramClient 並發送驗證碼請求
2. When 使用者輸入正確的驗證碼, the Migration Service shall 完成登入並建立已驗證的 session
3. If 驗證碼輸入錯誤, the Migration Service shall 顯示錯誤訊息並允許重新輸入
4. If 帳號啟用兩步驟驗證, the Migration Service shall 提示使用者輸入 2FA 密碼
5. When 登入成功, the Migration Service shall 儲存 session 資訊以供後續重新連線使用
6. If 網路連線中斷, the Migration Service shall 自動嘗試重新連線最多 3 次

### Requirement 2: 對話探索與列舉
**Objective:** 作為使用者，我希望工具能自動抓取 A 帳號的所有對話，以便了解需要遷移的完整範圍。

#### Acceptance Criteria
1. When 登入成功後, the Migration Service shall 使用 GetDialogsRequest 取得所有對話清單
2. The Migration Service shall 支援以下對話類型：私人聊天、群組、超級群組、頻道、機器人對話
3. When 對話數量超過單次 API 回應上限, the Migration Service shall 使用分頁機制完整取得所有對話
4. The Migration Service shall 為每個對話記錄：對話 ID、對話類型、對話名稱、訊息總數
5. When 對話列舉完成, the Migration Service shall 自動開始遷移流程，無需使用者確認

### Requirement 3: 目標群組建立
**Objective:** 作為使用者，我希望工具能為每個原始對話建立對應的新群組，並將 B 帳號加入成員，以便接收遷移的訊息。

#### Acceptance Criteria
1. When 開始遷移某個對話, the Migration Service shall 以 A 帳號建立對應的新群組
2. The Migration Service shall 使用原始對話名稱加上識別前綴作為新群組名稱
3. When 新群組建立成功, the Migration Service shall 將 B 帳號加入該群組作為成員
4. If B 帳號的使用者名稱或電話號碼未設定, the Migration Service shall 提示錯誤並中止該對話的遷移
5. When 群組建立完成, the Migration Service shall 記錄原始對話與新群組的對應關係
6. If 群組建立失敗, the Migration Service shall 記錄錯誤並繼續處理下一個對話

### Requirement 4: 訊息轉發與遷移
**Objective:** 作為使用者，我希望工具能將原始對話的所有訊息轉發至對應的新群組，以便 B 帳號能存取完整的歷史訊息。

#### Acceptance Criteria
1. When 目標群組建立完成, the Migration Service shall 開始從原始對話取得訊息
2. The Migration Service shall 使用 GetHistoryRequest 按時間順序取得訊息
3. When 取得訊息後, the Migration Service shall 使用 ForwardMessagesRequest 轉發至對應群組
4. The Migration Service shall 支援批次轉發，每批次最多 100 則訊息
5. When 訊息包含媒體檔案, the Migration Service shall 確保媒體內容完整轉發
6. The Migration Service shall 保留原始訊息的發送者資訊與時間戳記
7. When 單一對話遷移完成, the Migration Service shall 輸出該對話的遷移統計資訊

### Requirement 5: 流量控制與節流機制
**Objective:** 作為使用者，我希望工具能妥善處理 Telegram API 的流量限制，以避免帳號被暫時封鎖。

#### Acceptance Criteria
1. The Migration Service shall 在每批次轉發後等待設定的間隔時間
2. When 收到 FloodWaitError, the Migration Service shall 自動等待錯誤指定的秒數後重試
3. While FloodWait 等待中, the Migration Service shall 顯示倒數計時資訊
4. The Migration Service shall 支援使用者設定的轉發速率上限
5. If 連續發生多次 FloodWait, the Migration Service shall 自動降低轉發速率
6. The Migration Service shall 記錄所有 FloodWait 事件供後續分析

### Requirement 6: 斷點續傳機制
**Objective:** 作為使用者，我希望工具能記錄遷移進度並支援從中斷點繼續，以便在大量訊息遷移過程中不會因中斷而需要重新開始。

#### Acceptance Criteria
1. The Migration Service shall 維護持久化的進度檔案記錄遷移狀態
2. When 成功轉發一批訊息, the Migration Service shall 更新進度檔案記錄最後處理的訊息 ID
3. When 程式重新啟動, the Migration Service shall 讀取進度檔案並從上次中斷點繼續
4. The Migration Service shall 為每個對話獨立記錄進度狀態
5. When 某對話遷移完成, the Migration Service shall 將該對話標記為已完成
6. If 進度檔案損毀, the Migration Service shall 提供從頭開始或跳過已處理對話的選項
7. The Migration Service shall 支援匯出與匯入進度狀態

### Requirement 7: 錯誤處理與日誌
**Objective:** 作為使用者，我希望工具能妥善處理各種錯誤情況並提供詳細日誌，以便追蹤問題與確認遷移結果。

#### Acceptance Criteria
1. The Migration Service shall 記錄所有操作的詳細日誌包含時間戳記
2. When 發生錯誤, the Migration Service shall 記錄錯誤類型、錯誤訊息及相關上下文
3. If 單一訊息轉發失敗, the Migration Service shall 記錄該訊息並繼續處理後續訊息
4. When 遷移完成, the Migration Service shall 輸出完整的遷移報告
5. The Migration Service shall 支援不同的日誌等級：DEBUG、INFO、WARN、ERROR
6. The Migration Service shall 將日誌同時輸出至主控台與檔案

### Requirement 8: 使用者介面與設定
**Objective:** 作為使用者，我希望工具提供清晰的操作介面與彈性的設定選項，以便根據需求調整遷移行為。

#### Acceptance Criteria
1. The Migration Service shall 提供命令列介面進行操作
2. The Migration Service shall 支援設定檔定義常用參數
3. When 遷移進行中, the Migration Service shall 顯示即時進度資訊包含：當前對話、已處理訊息數、預估剩餘時間
4. The Migration Service shall 支援指定僅遷移特定對話
5. The Migration Service shall 支援設定訊息日期範圍過濾
6. When 使用者按下中斷鍵, the Migration Service shall 安全地儲存進度並結束程式
