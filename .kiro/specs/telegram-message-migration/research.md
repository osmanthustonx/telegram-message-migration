# Research & Design Decisions

---
**Purpose**: 記錄技術探索階段的發現與設計決策依據。
---

## Summary
- **Feature**: `telegram-message-migration`
- **Discovery Scope**: New Feature (新功能開發)
- **Key Findings**:
  - GramJS 提供完整的 Telegram MTProto API 支援，包含 Userbot 驗證、對話列舉、群組建立與訊息轉發
  - FloodWaitError 是最常見的 API 錯誤，GramJS 內建自動等待機制（預設 60 秒內自動處理）
  - 訊息轉發會保留原始發送者資訊但時間戳記為轉發時間

## Research Log

### GramJS 驗證機制 (Authentication)
- **Context**: 需要以 Userbot 方式登入 A 帳號取得完整 API 權限
- **Sources Consulted**:
  - [GramJS Authentication Guide](https://gram.js.org/getting-started/authorization)
  - [GitHub: gramjs/client/auth.ts](https://github.com/gram-js/gramjs/blob/master/gramjs/client/auth.ts)
- **Findings**:
  - 使用 `TelegramClient.start()` 進行互動式驗證
  - 支援回呼函式取得電話號碼、驗證碼、2FA 密碼
  - `StringSession` 用於持久化 session，避免重複登入
  - `session.save()` 回傳可儲存的 session 字串
  - `connectionRetries` 參數控制重連次數
- **Implications**:
  - AuthService 需實作回呼機制處理驗證流程
  - 需設計 session 檔案儲存機制
  - 2FA 密碼需在驗證流程中動態請求

### 對話列舉 API (GetDialogs)
- **Context**: 需取得 A 帳號所有對話清單以進行遷移
- **Sources Consulted**:
  - [GramJS GetDialogs](https://gram.js.org/tl/messages/GetDialogs)
  - [GitHub: gramjs/client/dialogs.ts](https://github.com/gram-js/gramjs/blob/master/gramjs/client/dialogs.ts)
- **Findings**:
  - `client.getDialogs()` 提供高階封裝，自動處理分頁
  - 支援篩選：`dialog.isChannel`, `dialog.isGroup`, `className`
  - 回傳包含 `dialogs`, `messages`, `chats`, `users` 向量
  - `folderId=1` 用於取得封存對話
  - 已知問題：訊息為 null 時可能導致錯誤
- **Implications**:
  - DialogService 應使用高階 `getDialogs()` 方法
  - 需處理各種對話類型的判別邏輯
  - 考慮封存對話的處理策略

### 群組建立 API
- **Context**: 需為每個來源對話建立對應的目標群組
- **Sources Consulted**:
  - [messages.CreateChat](https://gram.js.org/tl/messages/CreateChat)
  - [channels.CreateChannel](https://gram.js.org/tl/channels/CreateChannel)
  - [channels.InviteToChannel](https://gram.js.org/tl/channels/InviteToChannel)
- **Findings**:
  - **基本群組**: `messages.CreateChat({ users, title })` - 需至少 1 位使用者
  - **超級群組**: `channels.CreateChannel({ megagroup: true, title, about })`
  - **頻道**: `channels.CreateChannel({ broadcast: true, title, about })`
  - `channels.InviteToChannel({ channel, users })` 邀請使用者
  - Bot 無法使用這些 API，必須使用 Userbot
  - 錯誤碼：`USER_RESTRICTED` (被標記為垃圾郵件)、`USERS_TOO_FEW`
- **Implications**:
  - GroupService 需根據來源對話類型選擇對應的建立方法
  - 統一使用超級群組（megagroup）可簡化實作
  - 需處理 B 帳號邀請失敗的情境

### 訊息轉發 API (ForwardMessages)
- **Context**: 需批次轉發訊息至目標群組
- **Sources Consulted**:
  - [messages.ForwardMessages](https://gram.js.org/tl/messages/ForwardMessages)
  - [messages.GetHistory](https://gram.js.org/tl/messages/GetHistory)
- **Findings**:
  - **ForwardMessages 參數**:
    - `fromPeer`: 來源對話
    - `id`: 訊息 ID 向量（批次轉發）
    - `toPeer`: 目標對話
    - `randomId`: 防止重複發送的唯一識別碼
    - `silent`: 靜音轉發
    - `dropAuthor`: 移除原始作者資訊
  - **GetHistory 參數**:
    - `peer`, `offsetId`, `offsetDate`, `addOffset`, `limit`, `maxId`, `minId`
    - 單次最多回傳約 100 則訊息
  - **限制**:
    - 啟用慢速模式的群組無法批次轉發
    - 受保護的聊天無法轉發
    - Bot 無法使用 GetHistory
- **Implications**:
  - MigrationService 需實作分頁取得歷史訊息
  - 批次大小建議設為 100 則
  - 需生成 randomId 防止重複

### FloodWait 錯誤處理
- **Context**: 需妥善處理 Telegram API 流量限制
- **Sources Consulted**:
  - [GramJS Error Handling](https://painor.gitbook.io/gramjs/getting-started/handling-errors)
  - [grammY Flood Limits](https://grammy.dev/advanced/flood)
- **Findings**:
  - `FloodWaitError` 包含 `.seconds` 屬性表示等待時間
  - GramJS 內建自動等待：`client.floodSleepThreshold = 60`（預設）
  - 可調整為 `floodSleepThreshold = 300` 自動處理更長等待
  - 最長等待時間為 86400 秒（一天）
  - **經驗數據**:
    - 批次通知約 30 訊息/秒
    - 同一群組約 20 訊息/分鐘
  - 不應加入人為延遲，應尊重 FloodWait 錯誤
- **Implications**:
  - 設定較高的 `floodSleepThreshold`（如 300 秒）
  - 實作顯性 try-catch 提供使用者回饋
  - 記錄所有 FloodWait 事件供分析
  - 實作自適應速率調整機制

### Session 持久化
- **Context**: 需支援重新啟動後免重新登入
- **Sources Consulted**:
  - [GramJS Sessions](https://gram.js.org/getting-started/authorization)
- **Findings**:
  - `StringSession` 將驗證狀態序列化為字串
  - `session.save()` 取得 session 字串
  - 重新連線時傳入已儲存的 session 字串
  - Session 包含加密的驗證資料，需安全儲存
- **Implications**:
  - 設計獨立的 session 檔案儲存
  - 進度檔案與 session 檔案分離
  - 考慮敏感資料加密

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Layered Service | 分層服務架構，各服務職責單一 | 清晰邊界、易於測試、並行開發 | 服務間耦合需謹慎設計 | **選擇此方案** |
| Monolithic Script | 單一腳本處理所有邏輯 | 簡單直接、無需設計 | 難以維護、難以測試、不易擴展 | 不適合此規模專案 |
| Event-Driven | 事件驅動架構 | 鬆耦合、可擴展 | 過度設計、增加複雜度 | 對單機 CLI 工具過於複雜 |

## Design Decisions

### Decision: 統一使用超級群組 (Megagroup)
- **Context**: 需為不同來源對話類型（私聊、群組、頻道）建立對應目標群組
- **Alternatives Considered**:
  1. 基本群組 (Chat) - 使用 `messages.CreateChat`
  2. 超級群組 (Megagroup) - 使用 `channels.CreateChannel({ megagroup: true })`
  3. 混合策略 - 根據來源類型選擇
- **Selected Approach**: 統一使用超級群組
- **Rationale**:
  - 超級群組支援更多成員、更多訊息歷史
  - API 一致性，簡化實作
  - 未來可轉換為頻道
- **Trade-offs**: 基本群組功能更輕量，但功能受限
- **Follow-up**: 確認超級群組建立頻率限制

### Decision: 批次大小 100 則訊息
- **Context**: 需決定每批次轉發的訊息數量
- **Alternatives Considered**:
  1. 小批次 (10-20) - 降低單次錯誤影響
  2. 中批次 (50-100) - 平衡效率與風險
  3. 大批次 (200+) - 最大化效率
- **Selected Approach**: 100 則訊息/批次
- **Rationale**:
  - GetHistory 單次回傳約 100 則，與之對齊
  - ForwardMessages 支援向量傳入
  - 經驗值顯示 100 為合理上限
- **Trade-offs**: 單批次失敗影響較大，但整體效率較高
- **Follow-up**: 實作時驗證實際 API 限制

### Decision: JSON 格式進度檔案
- **Context**: 需持久化遷移進度以支援斷點續傳
- **Alternatives Considered**:
  1. JSON 檔案 - 人類可讀、易於除錯
  2. SQLite - 交易支援、查詢能力
  3. Binary - 效能最佳
- **Selected Approach**: JSON 檔案
- **Rationale**:
  - CLI 工具無需資料庫
  - 便於人工檢查與修復
  - Node.js 原生支援
- **Trade-offs**: 大量資料時 I/O 效能較差
- **Follow-up**: 考慮定期寫入而非每次操作都寫入

### Decision: 自適應速率限制
- **Context**: 需在效率與避免封鎖間取得平衡
- **Alternatives Considered**:
  1. 固定延遲 - 每批次固定等待
  2. 僅回應 FloodWait - 不主動延遲
  3. 自適應 - 根據錯誤頻率調整
- **Selected Approach**: 自適應速率限制
- **Rationale**:
  - 遵循 GramJS 建議：不加人為延遲，尊重 FloodWait
  - 連續錯誤時自動降速
  - 平穩運行時維持效率
- **Trade-offs**: 實作較複雜
- **Follow-up**: 定義具體的降速策略參數

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| A 帳號被暫時封鎖 | High | Medium | 尊重 FloodWait、自適應速率、提供手動中止選項 |
| 大量訊息導致長時間執行 | Medium | High | 斷點續傳、即時進度顯示、預估剩餘時間 |
| B 帳號無法被邀請 | Medium | Low | 驗證階段檢查 B 帳號可及性、清晰錯誤訊息 |
| 受保護內容無法轉發 | Low | Medium | 記錄失敗訊息、繼續處理後續、最終報告統計 |
| Session 洩漏 | High | Low | 安全儲存提醒、檔案權限建議、敏感資料處理 |
| 進度檔案損毀 | Medium | Low | 原子寫入、備份機制、手動修復選項 |

## References

- [GramJS Official Documentation](https://gram.js.org/) - 主要 API 參考
- [GramJS GitBook](https://painor.gitbook.io/gramjs/) - 詳細使用指南
- [GramJS GitHub Repository](https://github.com/gram-js/gramjs) - 原始碼與問題追蹤
- [Telegram MTProto API](https://core.telegram.org/api) - 官方 API 規格
- [grammY Flood Limits](https://grammy.dev/advanced/flood) - 流量限制最佳實踐
