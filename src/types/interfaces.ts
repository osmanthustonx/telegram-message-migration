/**
 * 服務介面定義
 *
 * 定義系統中各服務的公開介面，實現依賴反轉原則，
 * 讓服務間透過介面溝通而非具體實作。
 */

import type { TelegramClient } from 'telegram';
import type { Result } from './result.js';
import type {
  AuthError,
  DialogServiceError,
  GroupError,
  MigrationError,
  ProgressError,
  ConfigError,
  FileError,
  RealtimeSyncError,
} from './errors.js';
import type {
  DialogInfo,
  DialogFilter,
  GroupInfo,
  GroupConfig,
  MigrationProgress,
  AppConfig,
  AuthConfig,
  MigrationConfig,
  MigrationOptions,
  MigrationResult,
  DialogMigrationResult,
  MessageBatch,
  GetMessagesOptions,
  ForwardResult,
  LogContext,
  MigrationReport,
  DetailedMigrationReport,
  FloodWaitEvent,
  ProgressCallback,
  RateLimiterStats,
  QueueStatus,
  QueueProcessResult,
  RealtimeSyncStats,
} from './models.js';
import type { DialogStatus, LogLevel } from './enums.js';

// ============================================================================
// 驗證服務介面
// ============================================================================

/**
 * 驗證服務介面
 *
 * 管理 Telegram 帳號的 Userbot 驗證流程與 session 持久化
 */
export interface IAuthService {
  /**
   * 使用既有 session 或互動式驗證取得已驗證的 client
   *
   * @param config - 驗證設定
   * @returns 已驗證的 TelegramClient 或錯誤
   */
  authenticate(config: AuthConfig): Promise<Result<TelegramClient, AuthError>>;

  /**
   * 儲存當前 session 至檔案
   *
   * @param client - TelegramClient 實例
   * @param path - 儲存路徑
   * @returns 成功或檔案錯誤
   */
  saveSession(client: TelegramClient, path: string): Promise<Result<void, FileError>>;

  /**
   * 檢查 session 檔案是否存在且有效
   *
   * @param path - Session 檔案路徑
   * @returns 是否有效
   */
  hasValidSession(path: string): Promise<boolean>;

  /**
   * 中斷連線並清理資源
   *
   * @param client - TelegramClient 實例
   */
  disconnect(client: TelegramClient): Promise<void>;
}

// ============================================================================
// 對話服務介面
// ============================================================================

/**
 * 對話服務介面
 *
 * 列舉並過濾 A 帳號的所有對話
 */
export interface IDialogService {
  /**
   * 取得所有對話（自動處理分頁）
   *
   * @param client - 已驗證的 TelegramClient
   * @returns 對話清單或錯誤
   */
  getAllDialogs(client: TelegramClient): Promise<Result<DialogInfo[], DialogServiceError>>;

  /**
   * 根據過濾條件篩選對話
   *
   * @param dialogs - 原始對話清單
   * @param filter - 過濾條件
   * @returns 篩選後的對話清單
   */
  filterDialogs(dialogs: DialogInfo[], filter: DialogFilter): DialogInfo[];

  /**
   * 取得單一對話的詳細資訊
   *
   * @param client - 已驗證的 TelegramClient
   * @param dialogId - 對話 ID
   * @returns 對話資訊或錯誤
   */
  getDialogInfo(
    client: TelegramClient,
    dialogId: string
  ): Promise<Result<DialogInfo, DialogServiceError>>;
}

// ============================================================================
// 群組服務介面
// ============================================================================

/**
 * 群組服務介面
 *
 * 為來源對話建立對應的目標群組並邀請 B 帳號
 */
export interface IGroupService {
  /**
   * 為來源對話建立對應的目標群組
   *
   * @param client - 已驗證的 TelegramClient
   * @param sourceDialog - 來源對話資訊
   * @param config - 群組設定
   * @returns 新群組資訊或錯誤
   */
  createTargetGroup(
    client: TelegramClient,
    sourceDialog: DialogInfo,
    config: GroupConfig
  ): Promise<Result<GroupInfo, GroupError>>;

  /**
   * 邀請使用者加入群組
   *
   * @param client - 已驗證的 TelegramClient
   * @param group - 目標群組
   * @param userIdentifier - 使用者識別碼（username 或電話）
   * @returns 成功或錯誤
   */
  inviteUser(
    client: TelegramClient,
    group: GroupInfo,
    userIdentifier: string
  ): Promise<Result<void, GroupError>>;

  /**
   * 驗證使用者是否可被邀請
   *
   * @param client - 已驗證的 TelegramClient
   * @param userIdentifier - 使用者識別碼
   * @returns 是否可邀請或錯誤
   */
  canInviteUser(
    client: TelegramClient,
    userIdentifier: string
  ): Promise<Result<boolean, GroupError>>;
}

// ============================================================================
// 遷移服務介面
// ============================================================================

/**
 * 遷移服務介面
 *
 * 執行訊息遷移的核心邏輯，包含批次轉發與流量控制
 */
export interface IMigrationService {
  /**
   * 執行完整遷移流程
   *
   * @param client - 已驗證的 TelegramClient
   * @param config - 遷移設定
   * @param options - 遷移選項
   * @returns 遷移結果或錯誤
   */
  migrate(
    client: TelegramClient,
    config: MigrationConfig,
    options?: MigrationOptions
  ): Promise<Result<MigrationResult, MigrationError>>;

  /**
   * 遷移單一對話
   *
   * @param client - 已驗證的 TelegramClient
   * @param sourceDialog - 來源對話
   * @param targetGroup - 目標群組
   * @param config - 遷移設定
   * @param onProgress - 進度回呼
   * @returns 遷移結果或錯誤
   */
  migrateDialog(
    client: TelegramClient,
    sourceDialog: DialogInfo,
    targetGroup: GroupInfo,
    config: MigrationConfig,
    onProgress?: ProgressCallback
  ): Promise<Result<DialogMigrationResult, MigrationError>>;

  /**
   * 取得對話的歷史訊息（分頁）
   *
   * @param client - 已驗證的 TelegramClient
   * @param dialog - 對話資訊
   * @param options - 取得選項
   * @returns 訊息批次或錯誤
   */
  getMessages(
    client: TelegramClient,
    dialog: DialogInfo,
    options: GetMessagesOptions
  ): Promise<Result<MessageBatch, MigrationError>>;

  /**
   * 批次轉發訊息
   *
   * @param client - 已驗證的 TelegramClient
   * @param fromPeer - 來源 peer
   * @param toPeer - 目標 peer
   * @param messageIds - 訊息 ID 列表
   * @returns 轉發結果或錯誤
   */
  forwardMessages(
    client: TelegramClient,
    fromPeer: unknown,
    toPeer: unknown,
    messageIds: number[]
  ): Promise<Result<ForwardResult, MigrationError>>;
}

// ============================================================================
// 進度服務介面
// ============================================================================

/**
 * 進度服務介面
 *
 * 管理遷移進度的持久化與讀取，支援斷點續傳
 */
export interface IProgressService {
  /**
   * 載入進度檔案，不存在則回傳空狀態
   *
   * @param path - 進度檔案路徑
   * @returns 進度狀態或錯誤
   */
  load(path: string): Promise<Result<MigrationProgress, ProgressError>>;

  /**
   * 儲存進度至檔案（原子寫入）
   *
   * @param path - 進度檔案路徑
   * @param progress - 進度狀態
   * @returns 成功或錯誤
   */
  save(path: string, progress: MigrationProgress): Promise<Result<void, ProgressError>>;

  /**
   * 更新特定對話的遷移進度
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param lastMessageId - 最後處理的訊息 ID
   * @param messageCount - 已遷移的訊息數
   * @returns 更新後的進度
   */
  updateDialogProgress(
    progress: MigrationProgress,
    dialogId: string,
    lastMessageId: number,
    messageCount: number
  ): MigrationProgress;

  /**
   * 標記對話遷移完成
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @returns 更新後的進度
   */
  markDialogComplete(progress: MigrationProgress, dialogId: string): MigrationProgress;

  /**
   * 取得對話的遷移狀態
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @returns 對話狀態
   */
  getDialogStatus(progress: MigrationProgress, dialogId: string): DialogStatus;

  /**
   * 匯出進度為可分享格式
   *
   * @param progress - 進度狀態
   * @returns JSON 字串
   */
  exportProgress(progress: MigrationProgress): string;

  /**
   * 從匯出格式匯入進度
   *
   * @param data - JSON 字串
   * @returns 進度狀態或錯誤
   */
  importProgress(data: string): Result<MigrationProgress, ProgressError>;
}

// ============================================================================
// 日誌服務介面
// ============================================================================

/**
 * 日誌服務介面
 *
 * 提供結構化日誌記錄與遷移報告產生
 */
export interface ILogService {
  /**
   * 記錄偵錯資訊
   *
   * @param message - 訊息內容
   * @param context - 上下文資訊
   */
  debug(message: string, context?: LogContext): void;

  /**
   * 記錄一般資訊
   *
   * @param message - 訊息內容
   * @param context - 上下文資訊
   */
  info(message: string, context?: LogContext): void;

  /**
   * 記錄警告
   *
   * @param message - 訊息內容
   * @param context - 上下文資訊
   */
  warn(message: string, context?: LogContext): void;

  /**
   * 記錄錯誤
   *
   * @param message - 訊息內容
   * @param error - 錯誤物件
   * @param context - 上下文資訊
   */
  error(message: string, error?: Error, context?: LogContext): void;

  /**
   * 記錄 FloodWait 事件
   *
   * @param seconds - 等待秒數
   * @param operation - 觸發的操作
   */
  logFloodWait(seconds: number, operation: string): void;

  /**
   * 記錄訊息遷移事件
   *
   * @param dialogId - 對話 ID
   * @param messageCount - 訊息數量
   * @param success - 是否成功
   */
  logMessageMigration(dialogId: string, messageCount: number, success: boolean): void;

  /**
   * 產生遷移報告
   *
   * @param progress - 遷移進度
   * @returns 遷移報告
   */
  generateReport(progress: MigrationProgress): MigrationReport;

  /**
   * 設定日誌等級
   *
   * @param level - 日誌等級
   */
  setLevel(level: LogLevel): void;

  /**
   * 取得目前日誌等級
   *
   * @returns 目前的日誌等級
   */
  getLevel(): LogLevel;
}

// ============================================================================
// 設定載入器介面
// ============================================================================

/**
 * 設定載入器介面
 *
 * 載入與驗證應用程式設定
 */
export interface IConfigLoader {
  /**
   * 載入完整設定
   *
   * @param configPath - 設定檔路徑（選填）
   * @returns 設定或錯誤
   */
  load(configPath?: string): Result<AppConfig, ConfigError>;

  /**
   * 驗證設定完整性
   *
   * @param config - 部分設定
   * @returns 完整設定或錯誤
   */
  validate(config: Partial<AppConfig>): Result<AppConfig, ConfigError>;
}

// ============================================================================
// 速率限制器介面
// ============================================================================

/**
 * 速率限制器設定
 */
export interface RateLimitConfig {
  /** 批次間隔（毫秒），預設 1000 */
  batchDelay: number;
  /** 每分鐘最大請求數，預設 30 */
  maxRequestsPerMinute: number;
  /** FloodWait 自動處理門檻（秒），預設 300 */
  floodWaitThreshold: number;
  /** 是否啟用自適應速率調整，預設 true */
  adaptiveEnabled: boolean;
  /** 最小批次延遲（毫秒），預設 500 */
  minBatchDelay: number;
  /** 最大批次延遲（毫秒），預設 10000 */
  maxBatchDelay: number;
}

/**
 * 速率調整事件
 */
export interface RateAdjustmentEvent {
  /** 調整時間 */
  timestamp: Date;
  /** 調整前的延遲 */
  previousDelay: number;
  /** 調整後的延遲 */
  newDelay: number;
  /** 調整原因 */
  reason: string;
}

/**
 * 速率限制器介面
 *
 * 管理 API 請求速率與 FloodWait 處理
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export interface IRateLimiter {
  /**
   * 取得執行權限（若需等待則等待）
   *
   * @returns 等待完成後解析
   */
  acquire(): Promise<void>;

  /**
   * 記錄 FloodWait 事件並調整速率
   *
   * @param seconds - 等待秒數
   */
  recordFloodWait(seconds: number): void;

  /**
   * 取得統計資訊
   *
   * @returns 速率限制器統計
   */
  getStats(): RateLimiterStats;

  /**
   * 重置統計資訊
   */
  reset(): void;

  /**
   * 取得當前設定
   *
   * @returns 速率限制設定
   */
  getConfig(): RateLimitConfig;

  /**
   * 更新設定
   *
   * @param config - 部分設定
   */
  setConfig(config: Partial<RateLimitConfig>): void;

  /**
   * 取得速率調整事件記錄
   *
   * @returns 速率調整事件列表
   */
  getRateAdjustments(): RateAdjustmentEvent[];

  /**
   * FloodWait 倒數回呼（選填）
   * 當 FloodWait 進行中時，每秒呼叫一次
   *
   * @param secondsRemaining - 剩餘等待秒數
   * @param operation - 觸發的操作名稱
   */
  onFloodWait?: (secondsRemaining: number, operation?: string) => void;
}

// ============================================================================
// 報告服務介面
// ============================================================================

/**
 * FloodWait 統計資訊
 */
export interface FloodWaitStats {
  /** 事件總數 */
  totalEvents: number;
  /** 總等待時間（秒） */
  totalWaitTime: number;
  /** 最長等待時間（秒） */
  longestWait: number;
}

/**
 * 報告服務介面
 *
 * 追蹤 FloodWait 事件並產生遷移報告
 *
 * Requirements: 5.6, 7.4
 */
export interface IReportService {
  /**
   * 記錄 FloodWait 事件
   *
   * @param event - FloodWait 事件資訊
   */
  recordFloodWait(event: FloodWaitEvent): void;

  /**
   * 取得 FloodWait 統計資訊
   *
   * @returns FloodWait 統計
   */
  getFloodWaitStats(): FloodWaitStats;

  /**
   * 取得所有已記錄的 FloodWait 事件
   *
   * @returns FloodWait 事件列表
   */
  getFloodWaitEvents(): FloodWaitEvent[];

  /**
   * 清除所有已記錄的事件
   */
  clearEvents(): void;

  /**
   * 產生遷移報告
   *
   * @param progress - 遷移進度
   * @returns 詳細遷移報告
   */
  generateReport(progress: MigrationProgress): DetailedMigrationReport;

  /**
   * 將報告格式化為人類可讀的文字
   *
   * @param report - 詳細遷移報告
   * @returns 格式化的文字報告
   */
  formatReportAsText(report: DetailedMigrationReport): string;

  /**
   * 將報告儲存至檔案
   *
   * @param report - 詳細遷移報告
   * @param filePath - 檔案路徑
   * @returns 成功或錯誤
   */
  saveReportToFile(
    report: DetailedMigrationReport,
    filePath: string
  ): Promise<Result<void, FileError>>;
}

// ============================================================================
// Session 管理介面
// ============================================================================

/**
 * Session 權限驗證結果
 */
export interface SessionPermissionResult {
  /** 是否有效 */
  valid: boolean;
  /** 警告訊息（若權限過於寬鬆） */
  warning?: string;
}

/**
 * Session 管理服務介面
 *
 * 管理 Telegram session 檔案的儲存、載入與安全性
 *
 * Requirements: 1.5
 */
export interface ISessionManager {
  /**
   * 儲存 session 字串至檔案
   *
   * @param sessionString - Session 字串
   * @param filePath - 檔案路徑
   * @returns 成功或錯誤
   */
  saveSession(sessionString: string, filePath: string): Promise<Result<void, FileError>>;

  /**
   * 載入 session 檔案
   *
   * @param filePath - 檔案路徑
   * @returns Session 字串或 null（若不存在）或錯誤
   */
  loadSession(filePath: string): Promise<Result<string | null, FileError>>;

  /**
   * 刪除 session 檔案
   *
   * @param filePath - 檔案路徑
   * @returns 成功或錯誤
   */
  deleteSession(filePath: string): Promise<Result<void, FileError>>;

  /**
   * 檢查 session 檔案是否存在且有效
   *
   * @param filePath - 檔案路徑
   * @returns 是否存在且有效
   */
  sessionExists(filePath: string): Promise<boolean>;

  /**
   * 驗證 session 檔案權限
   *
   * @param filePath - 檔案路徑
   * @returns 權限驗證結果
   */
  validateSessionPermissions(filePath: string): Promise<SessionPermissionResult>;
}

// ============================================================================
// 重連管理介面
// ============================================================================

/**
 * 重連狀態事件
 */
export interface ReconnectStatusEvent {
  /** 狀態：attempting（嘗試中）、connected（已連線）、failed（失敗） */
  status: 'attempting' | 'connected' | 'failed';
  /** 當前嘗試次數 */
  attempt: number;
  /** 最大嘗試次數 */
  maxAttempts: number;
  /** 錯誤訊息（若有） */
  error?: string;
}

/**
 * 重連狀態回呼函式
 */
export type ReconnectStatusCallback = (event: ReconnectStatusEvent) => void;

/**
 * 重連管理器配置
 */
export interface ReconnectionConfig {
  /** 最大重試次數，預設 3 */
  maxRetries?: number;
  /** 初始延遲時間（毫秒），預設 1000 */
  initialDelayMs?: number;
}

/**
 * 重連管理服務介面
 *
 * 管理 Telegram 連線的自動重連機制
 *
 * Requirements: 1.6
 */
export interface IReconnectionManager {
  /**
   * 嘗試重新連線
   *
   * @param client - TelegramClient 實例
   * @returns 成功或錯誤
   */
  attemptReconnect(client: TelegramClient): Promise<Result<void, AuthError>>;

  /**
   * 取得目前重連嘗試次數
   *
   * @returns 嘗試次數
   */
  getReconnectAttempts(): number;

  /**
   * 重置重連嘗試次數
   */
  resetAttempts(): void;

  /**
   * 註冊重連狀態回呼
   *
   * @param callback - 狀態回呼函式
   */
  onReconnectStatus(callback: ReconnectStatusCallback): void;
}

// ============================================================================
// 即時同步服務介面
// ============================================================================

/**
 * 即時同步服務介面
 *
 * 管理即時訊息監聽、佇列管理與延遲轉發功能。
 * 在遷移期間監聽來源對話的新訊息，累積至佇列，
 * 待批次遷移完成後依序轉發至目標群組。
 *
 * Requirements: 1.x, 2.x, 4.x, 5.x, 6.x, 7.x
 */
export interface IRealtimeSyncService {
  /**
   * 開始監聽對話的新訊息
   *
   * 使用 GramJS 的 NewMessage 事件監聽指定對話，
   * 將新訊息加入待處理佇列。
   *
   * @param client - TelegramClient 實例
   * @param dialogId - 來源對話 ID
   * @returns 成功或錯誤
   */
  startListening(
    client: TelegramClient,
    dialogId: string
  ): Result<void, RealtimeSyncError>;

  /**
   * 停止監聯對話並清理資源
   *
   * 移除事件監聽器、清空佇列、移除映射資料。
   *
   * @param dialogId - 對話 ID
   */
  stopListening(dialogId: string): void;

  /**
   * 註冊來源對話與目標群組的映射
   *
   * 建立對話 ID 到群組 ID 的映射，供轉發時查詢目標。
   *
   * @param sourceDialogId - 來源對話 ID
   * @param targetGroupId - 目標群組 ID
   */
  registerMapping(sourceDialogId: string, targetGroupId: string): void;

  /**
   * 處理對話的待轉發佇列
   *
   * 依訊息 ID 升序處理佇列中的訊息，跳過重複訊息，
   * 轉發至對應的目標群組。
   *
   * @param dialogId - 對話 ID
   * @param lastBatchMessageId - 批次遷移最後處理的訊息 ID
   * @returns 處理結果或錯誤
   */
  processQueue(
    dialogId: string,
    lastBatchMessageId: number
  ): Promise<Result<QueueProcessResult, RealtimeSyncError>>;

  /**
   * 取得對話的佇列狀態
   *
   * @param dialogId - 對話 ID
   * @returns 佇列狀態
   */
  getQueueStatus(dialogId: string): QueueStatus;

  /**
   * 取得整體同步統計
   *
   * @returns 統計資訊
   */
  getStats(): RealtimeSyncStats;
}
