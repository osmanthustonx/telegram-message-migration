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
  ProgressCallback,
  RateLimiterStats,
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
 * 速率限制器介面
 *
 * 管理 API 請求速率與 FloodWait 處理
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
}
