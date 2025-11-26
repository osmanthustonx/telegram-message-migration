# Requirements Document

## Introduction

本功能規格定義即時訊息同步機制，在執行訊息遷移 (forwarding) 過程中，監聽來源對話的新進訊息並在批次遷移完成後依序轉發至對應的目標群組。此功能確保遷移期間不會遺漏任何新訊息，同時保證訊息時間順序的正確性。

**範圍**：
- 即時監聽來源對話的新訊息事件
- 將新訊息暫存至佇列，等待批次遷移完成
- 批次完成後依時間順序轉發佇列中的訊息
- 與現有批次遷移流程整合
- 處理即時同步過程中的錯誤與流量限制

**時序策略**：佇列延遲轉發
- 新訊息在遷移期間先存入佇列
- 等該對話的批次遷移完成後再依序轉發
- 確保目標群組中的訊息時間順序正確

## Requirements

### Requirement 1: 新訊息事件監聽

**Objective:** 作為遷移工具使用者，我希望在遷移過程中能自動監聽新訊息，以確保不會遺漏遷移期間產生的任何訊息。

#### Acceptance Criteria

1. When 遷移服務開始處理某個對話時, the RealtimeSyncService shall 啟動該對話的新訊息事件監聽器。

2. When Telegram 客戶端收到 NewMessage 事件時, the RealtimeSyncService shall 檢查該訊息是否來自正在遷移的來源對話。

3. While 對話遷移正在進行中, the RealtimeSyncService shall 持續監聽該對話的所有新進訊息並加入待處理佇列。

4. When 對話遷移完成且佇列處理完畢後, the RealtimeSyncService shall 停止該對話的事件監聽器並釋放相關資源。

5. If 事件監聯器初始化失敗, then the RealtimeSyncService shall 記錄錯誤並回傳包含錯誤資訊的 `Result<void, RealtimeSyncError>`。

### Requirement 2: 訊息佇列與延遲轉發

**Objective:** 作為遷移工具使用者，我希望新訊息能在批次遷移完成後依正確順序轉發至目標群組，以維持訊息時間順序的正確性。

#### Acceptance Criteria

1. When 收到來自正在遷移對話的新訊息時, the RealtimeSyncService shall 將該訊息加入該對話專屬的待處理佇列，不立即轉發。

2. While 該對話的批次遷移仍在進行中, the RealtimeSyncService shall 持續累積新訊息至佇列，不執行任何轉發操作。

3. When 該對話的批次遷移完成後, the RealtimeSyncService shall 開始處理佇列中的訊息，按訊息 ID 升序（時間順序）依次轉發。

4. When 佇列中的訊息成功轉發後, the RealtimeSyncService shall 更新即時同步統計資訊（已同步訊息數）並從佇列移除該訊息。

5. The RealtimeSyncService shall 維護來源對話 ID 與目標群組 ID 的映射表，支援 O(1) 時間複雜度查詢。

6. If 佇列處理期間有新訊息到達, then the RealtimeSyncService shall 將新訊息加入佇列尾端，待當前佇列處理完畢後繼續處理。

### Requirement 3: 與現有遷移流程整合

**Objective:** 作為遷移工具使用者，我希望即時同步功能能無縫整合現有遷移流程，不需額外操作即可啟用。

#### Acceptance Criteria

1. When MigrationOrchestrator 開始遷移某對話時, the MigrationOrchestrator shall 呼叫 RealtimeSyncService 註冊該對話的即時監聽，開始累積新訊息至佇列。

2. When GroupService 成功建立目標群組時, the MigrationOrchestrator shall 更新 RealtimeSyncService 的對話-群組映射表。

3. When MigrationService 完成該對話的所有批次訊息轉發後, the MigrationOrchestrator shall 通知 RealtimeSyncService 開始處理佇列中累積的新訊息。

4. When 佇列處理完成後, the MigrationOrchestrator shall 呼叫 RealtimeSyncService 取消註冊並清理資源，此時對話遷移才算真正完成。

5. Where 使用者啟用 DryRun 模式時, the RealtimeSyncService shall 不啟動任何事件監聽器。

6. The MigrationOrchestrator shall 在進度報告中包含佇列狀態（待處理訊息數、已處理訊息數）。

### Requirement 4: 錯誤處理與恢復

**Objective:** 作為遷移工具使用者，我希望即時同步的錯誤不會中斷整體遷移流程，並能適當處理與記錄。

#### Acceptance Criteria

1. If 單一訊息轉發失敗, then the RealtimeSyncService shall 將該訊息加入重試佇列並繼續處理其他訊息。

2. When 轉發失敗次數達到最大重試次數（預設 3 次）時, the RealtimeSyncService shall 記錄該訊息為失敗並從重試佇列移除。

3. If 即時同步過程發生非預期錯誤, then the RealtimeSyncService shall 記錄錯誤日誌但不中斷批次遷移流程。

4. When 對話遷移結束時, the RealtimeSyncService shall 輸出該對話的即時同步統計（佇列累積數、成功數、失敗數、重試數）。

5. The RealtimeSyncService shall 將所有錯誤以 `Result<T, RealtimeSyncError>` 類型回傳，符合專案錯誤處理模式。

### Requirement 5: 流量控制與速率限制

**Objective:** 作為遷移工具使用者，我希望即時同步能遵守 Telegram API 速率限制，避免觸發 FloodWait。

#### Acceptance Criteria

1. When 處理佇列訊息時收到 FloodWait 錯誤, the RealtimeSyncService shall 暫停佇列處理指定秒數後自動恢復。

2. While FloodWait 等待期間, the RealtimeSyncService shall 繼續接收新訊息事件並加入待處理佇列。

3. When FloodWait 等待結束後, the RealtimeSyncService shall 從暫停點繼續依序處理佇列中的待轉發訊息。

4. The RealtimeSyncService shall 與現有 RateLimiter 服務整合，共享速率限制狀態。

5. When 佇列長度超過設定上限（預設 1000 則）時, the RealtimeSyncService shall 記錄警告並丟棄最舊的訊息以防止記憶體耗盡。

### Requirement 6: 訊息順序保證

**Objective:** 作為遷移工具使用者，我希望即時同步的訊息能保持正確的時間順序，確保對話歷史的完整性。

#### Acceptance Criteria

1. The RealtimeSyncService shall 為每則佇列中的訊息記錄原始訊息 ID 與時間戳記，用於排序依據。

2. When 批次遷移完成開始處理佇列時, the RealtimeSyncService shall 取得批次遷移最後處理的訊息 ID 作為分界點。

3. When 處理佇列中的訊息時, the RealtimeSyncService shall 按訊息 ID 升序（時間順序）轉發，確保在批次訊息之後依序出現。

4. If 偵測到佇列中的訊息 ID 小於或等於批次遷移最後處理的訊息 ID, then the RealtimeSyncService shall 跳過該訊息並記錄為重複（已在批次中處理）。

5. The RealtimeSyncService shall 追蹤每個對話最後處理的訊息 ID，確保不遺漏也不重複。

6. When 佇列處理完成後, the RealtimeSyncService shall 驗證目標群組的訊息順序與來源對話一致。

### Requirement 7: 服務介面定義

**Objective:** 作為開發者，我希望即時同步服務有明確的介面定義，便於測試與模組整合。

#### Acceptance Criteria

1. The RealtimeSyncService shall 實作 `IRealtimeSyncService` 介面，定義於 `types/interfaces.ts`。

2. The IRealtimeSyncService shall 包含 `startListening(client, dialogId): Result<void, RealtimeSyncError>` 方法，開始監聽並累積訊息至佇列。

3. The IRealtimeSyncService shall 包含 `stopListening(dialogId): void` 方法，停止監聽並清理資源。

4. The IRealtimeSyncService shall 包含 `registerMapping(sourceDialogId, targetGroupId): void` 方法，註冊對話與群組的映射。

5. The IRealtimeSyncService shall 包含 `processQueue(dialogId, lastBatchMessageId): Promise<Result<QueueProcessResult, RealtimeSyncError>>` 方法，處理佇列中累積的訊息。

6. The IRealtimeSyncService shall 包含 `getQueueStatus(dialogId): QueueStatus` 方法，回傳佇列狀態（待處理數、已處理數）。

7. The IRealtimeSyncService shall 包含 `getStats(): RealtimeSyncStats` 方法，回傳整體同步統計資訊。

8. The RealtimeSyncService shall 支援依賴注入，允許在測試時注入 mock 的 TelegramClient。
