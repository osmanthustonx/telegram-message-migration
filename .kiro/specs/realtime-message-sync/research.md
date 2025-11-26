# Research & Design Decisions

## Summary
- **Feature**: `realtime-message-sync`
- **Discovery Scope**: Extension (整合至現有遷移流程)
- **Key Findings**:
  - GramJS 提供 `NewMessage` 事件與 `addEventHandler` API，支援依 chat 過濾訊息
  - 現有 `MigrationOrchestrator` 已有服務注入機制，可擴展支援 `IRealtimeSyncService`
  - 專案使用 `Result<T, E>` 模式進行錯誤處理，需定義 `RealtimeSyncError` 類型

## Research Log

### GramJS NewMessage Event API
- **Context**: 需瞭解如何監聽 Telegram 即時訊息事件
- **Sources Consulted**:
  - [GramJS NewMessage Documentation](https://gram.js.org/beta/classes/custom.NewMessage.html)
  - [GramJS NewMessageEvent Documentation](https://gram.js.org/beta/classes/custom.NewMessageEvent.html)
  - [GramJS Updates Events Guide](https://painor.gitbook.io/gramjs/getting-started/updates-events)
- **Findings**:
  - `NewMessage` 類別支援 `chats` 參數過濾特定對話
  - `NewMessageEvent.message` 提供 `id`, `senderId`, `date` 等資訊
  - `client.addEventHandler(handler, new NewMessage({ chats }))` 註冊監聽
  - 移除監聯器需使用 `client.removeEventHandler(handler, new NewMessage({}))`
- **Implications**:
  - 可依對話 ID 過濾事件，降低處理負擔
  - 需保存 handler reference 以便後續移除
  - `NewMessageEvent.message.id` 可作為排序與去重依據

### Existing Codebase Patterns
- **Context**: 確保設計符合現有架構慣例
- **Sources Consulted**:
  - `src/services/orchestrator.ts` - 協調器流程
  - `src/services/migration-service.ts` - 遷移服務實作
  - `src/types/interfaces.ts` - 服務介面定義
  - `src/types/errors.ts` - 錯誤類型定義
- **Findings**:
  - 服務透過 `OrchestratorServices` 介面注入
  - 所有服務實作對應的 `I*Service` 介面
  - 錯誤使用 discriminated union 定義（例如 `MigrationError`）
  - `Result<T, E>` 類型強制呼叫端處理錯誤
  - `RateLimiter` 已提供 FloodWait 處理機制
- **Implications**:
  - `RealtimeSyncService` 需實作 `IRealtimeSyncService` 介面
  - 新增 `RealtimeSyncError` 至 `errors.ts`
  - 與 `RateLimiter` 整合處理 FloodWait

### Queue Data Structure Selection
- **Context**: 選擇適合的佇列實作以維持訊息順序
- **Sources Consulted**:
  - TypeScript/JavaScript 原生資料結構
  - 專案現有程式碼風格
- **Findings**:
  - JavaScript `Array` 可作為 FIFO 佇列使用（`push` + `shift`）
  - `Map<string, QueuedMessage[]>` 可依對話 ID 分隔佇列
  - 訊息 ID 為遞增整數，可直接用於排序
- **Implications**:
  - 使用 `Map<string, QueuedMessage[]>` 維護對話專屬佇列
  - 處理前依 `messageId` 升序排序確保時間順序
  - 佇列上限檢查防止記憶體耗盡

### MigrationOrchestrator Integration Points
- **Context**: 確定與現有遷移流程的整合點
- **Sources Consulted**:
  - `src/services/orchestrator.ts` 流程分析
- **Findings**:
  - `runMigration` 方法遍歷對話並依序執行遷移
  - 每個對話遷移流程：`getOrCreateTargetGroup` → `inviteUser` → `migrateDialog`
  - `migrateDialog` 完成後標記 `markDialogComplete`
  - DryRun 模式不執行實際遷移
- **Implications**:
  - 在 `migrateDialog` 開始前啟動監聽
  - 在 `migrateDialog` 完成後處理佇列
  - 佇列處理完成後再執行 `markDialogComplete`
  - DryRun 模式跳過即時同步

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Observer Pattern | RealtimeSyncService 監聽事件，Orchestrator 呼叫處理 | 解耦清楚，符合現有架構 | 需協調生命週期 | 選用此模式 |
| Embedded Queue | 將佇列邏輯嵌入 MigrationService | 減少服務數量 | 違反單一職責，難以測試 | 不建議 |
| Event Emitter | 使用 Node.js EventEmitter 傳遞訊息 | 鬆耦合 | 增加複雜度，錯誤處理困難 | 過度設計 |

## Design Decisions

### Decision: Queue-based Delayed Forwarding Strategy
- **Context**: 需確保即時訊息在目標群組中保持正確時間順序
- **Alternatives Considered**:
  1. 即時轉發 - 收到訊息立即轉發
  2. 佇列延遲轉發 - 累積後批次處理
- **Selected Approach**: 佇列延遲轉發
  - 遷移期間將新訊息加入佇列
  - 等批次遷移完成後依 ID 升序處理
- **Rationale**:
  - 即時轉發會導致目標群組訊息順序與來源對話不一致
  - 延遲轉發確保歷史訊息（批次遷移）先於即時訊息出現
- **Trade-offs**:
  - 優點：訊息順序正確、邏輯簡單
  - 缺點：即時訊息有延遲、需管理佇列記憶體
- **Follow-up**: 監控佇列長度，設定上限防止記憶體耗盡

### Decision: Per-dialog Queue Isolation
- **Context**: 多對話同時遷移時的佇列管理
- **Alternatives Considered**:
  1. 全域單一佇列 - 所有對話共用
  2. 對話專屬佇列 - 每個對話獨立佇列
- **Selected Approach**: 對話專屬佇列
  - 使用 `Map<dialogId, QueuedMessage[]>` 結構
- **Rationale**:
  - 各對話遷移進度獨立，需獨立管理佇列
  - 避免對話 A 完成時誤處理對話 B 的訊息
  - 簡化狀態管理與錯誤隔離
- **Trade-offs**:
  - 優點：隔離清楚、狀態簡單
  - 缺點：記憶體使用較高（多個佇列）

### Decision: lastBatchMessageId Boundary for Deduplication
- **Context**: 避免批次遷移與即時同步的訊息重複
- **Alternatives Considered**:
  1. 時間戳比較 - 依訊息時間判斷
  2. 訊息 ID 比較 - 依 ID 判斷
- **Selected Approach**: 訊息 ID 比較
  - 批次遷移完成後取得 `lastBatchMessageId`
  - 佇列處理時跳過 ID <= `lastBatchMessageId` 的訊息
- **Rationale**:
  - Telegram 訊息 ID 為遞增整數，可靠性高於時間戳
  - 避免時區或時鐘偏移問題
- **Trade-offs**:
  - 優點：簡單可靠
  - 缺點：需從 MigrationService 取得最後處理的 ID

### Decision: Service Interface Design
- **Context**: 定義 `IRealtimeSyncService` 介面
- **Selected Approach**:
  - `startListening(client, dialogId)` - 啟動監聽
  - `stopListening(dialogId)` - 停止監聽
  - `registerMapping(sourceDialogId, targetGroupId)` - 註冊映射
  - `processQueue(dialogId, lastBatchMessageId)` - 處理佇列
  - `getQueueStatus(dialogId)` - 查詢狀態
  - `getStats()` - 整體統計
- **Rationale**:
  - 符合 requirements.md 7.x 需求
  - 方法粒度適中，便於測試與 mock
  - 與 Orchestrator 整合點清晰

## Risks & Mitigations
- **記憶體耗盡** - 佇列無上限可能耗盡記憶體
  - Mitigation: 設定佇列上限（預設 1000 則），超過時丟棄最舊訊息並記錄警告
- **事件遺漏** - 監聯器初始化時機不當可能遺漏訊息
  - Mitigation: 在批次遷移開始前先啟動監聽
- **FloodWait 中斷** - 佇列處理期間遇到 FloodWait
  - Mitigation: 暫停處理並等待，期間繼續累積訊息
- **併發競爭** - 多對話同時處理可能產生競爭
  - Mitigation: 對話專屬佇列隔離狀態

## References
- [GramJS NewMessage](https://gram.js.org/beta/classes/custom.NewMessage.html) - NewMessage 類別文件
- [GramJS NewMessageEvent](https://gram.js.org/beta/classes/custom.NewMessageEvent.html) - NewMessageEvent 類別文件
- [GramJS Updates Events](https://painor.gitbook.io/gramjs/getting-started/updates-events) - 事件處理指南
