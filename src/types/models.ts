/**
 * 資料模型定義
 *
 * 定義系統中使用的核心資料結構，包含對話資訊、群組資訊、
 * 遷移進度與應用程式設定等。
 */

import type { DialogType, DialogStatus, LogLevel, MigrationPhase } from './enums.js';

// ============================================================================
// 對話相關模型
// ============================================================================

/**
 * 對話基本資訊
 */
export interface DialogInfo {
  /** 對話 ID */
  id: string;
  /** 存取雜湊值 */
  accessHash: string;
  /** 對話類型 */
  type: DialogType;
  /** 對話名稱 */
  name: string;
  /** 訊息總數 */
  messageCount: number;
  /** 未讀訊息數 */
  unreadCount: number;
  /** 是否已封存 */
  isArchived: boolean;
  /** GramJS Entity 物件（用於 API 呼叫） */
  entity: unknown;
}

/**
 * 對話過濾條件
 *
 * 過濾優先順序：
 * 1. ID 過濾（includeIds 先套用，再套用 excludeIds）
 * 2. 類型過濾（includeTypes 先套用，再套用 excludeTypes）
 * 3. 訊息數量過濾（minMessageCount, maxMessageCount）
 */
export interface DialogFilter {
  /** 僅包含這些對話 ID（白名單） */
  includeIds?: string[];
  /** 排除這些對話 ID（黑名單） */
  excludeIds?: string[];
  /** 僅包含這些對話類型（舊欄位，向下相容，等同 includeTypes） */
  types?: DialogType[];
  /** 僅包含這些對話類型 */
  includeTypes?: DialogType[];
  /** 排除這些對話類型 */
  excludeTypes?: DialogType[];
  /** 最小訊息數量（包含邊界值） */
  minMessageCount?: number;
  /** 最大訊息數量（包含邊界值） */
  maxMessageCount?: number;
}

// ============================================================================
// 群組相關模型
// ============================================================================

/**
 * 目標群組資訊
 */
export interface GroupInfo {
  /** 群組 ID */
  id: string;
  /** 存取雜湊值 */
  accessHash: string;
  /** 群組名稱 */
  name: string;
  /** 來源對話 ID */
  sourceDialogId: string;
  /** 建立時間（ISO 8601 格式） */
  createdAt: string;
  /** GramJS Entity 物件（用於 API 呼叫） */
  entity: unknown;
}

/**
 * 群組設定
 */
export interface GroupConfig {
  /** 群組名稱前綴 */
  namePrefix: string;
}

// ============================================================================
// 進度追蹤模型
// ============================================================================

/**
 * 對話遷移錯誤記錄
 */
export interface DialogError {
  /** 錯誤發生時間（ISO 8601 格式） */
  timestamp: string;
  /** 相關訊息 ID（若適用） */
  messageId: number | null;
  /** 錯誤類型 */
  errorType: string;
  /** 錯誤訊息 */
  errorMessage: string;
}

/**
 * 單一對話的遷移進度
 */
export interface DialogProgress {
  /** 對話 ID */
  dialogId: string;
  /** 對話名稱 */
  dialogName: string;
  /** 對話類型 */
  dialogType: DialogType;
  /** 遷移狀態 */
  status: DialogStatus;
  /** 目標群組 ID（若已建立） */
  targetGroupId: string | null;
  /** 最後處理的訊息 ID */
  lastMessageId: number | null;
  /** 已遷移訊息數 */
  migratedCount: number;
  /** 訊息總數 */
  totalCount: number;
  /** 錯誤記錄 */
  errors: DialogError[];
  /** 開始時間（ISO 8601 格式） */
  startedAt: string | null;
  /** 完成時間（ISO 8601 格式） */
  completedAt: string | null;
}

/**
 * FloodWait 事件記錄
 */
export interface FloodWaitEvent {
  /** 事件發生時間（ISO 8601 格式） */
  timestamp: string;
  /** 等待秒數 */
  seconds: number;
  /** 觸發的操作 */
  operation: string;
}

/**
 * 遷移統計資訊
 */
export interface MigrationStats {
  /** 對話總數 */
  totalDialogs: number;
  /** 已完成對話數 */
  completedDialogs: number;
  /** 失敗對話數 */
  failedDialogs: number;
  /** 已跳過對話數 */
  skippedDialogs: number;
  /** 訊息總數 */
  totalMessages: number;
  /** 已遷移訊息數 */
  migratedMessages: number;
  /** 失敗訊息數 */
  failedMessages: number;
  /** FloodWait 事件次數 */
  floodWaitCount: number;
  /** FloodWait 總等待秒數 */
  totalFloodWaitSeconds: number;
}

/**
 * 完整遷移進度狀態
 */
export interface MigrationProgress {
  /** 進度檔案版本 */
  version: string;
  /** 遷移開始時間（ISO 8601 格式） */
  startedAt: string;
  /** 最後更新時間（ISO 8601 格式） */
  updatedAt: string;
  /** 來源帳號（遮蔽後） */
  sourceAccount: string;
  /** 目標帳號 */
  targetAccount: string;
  /** 當前遷移階段 */
  currentPhase: MigrationPhase;
  /** 各對話的遷移進度 */
  dialogs: Map<string, DialogProgress>;
  /** FloodWait 事件記錄 */
  floodWaitEvents: FloodWaitEvent[];
  /** 統計資訊 */
  stats: MigrationStats;
}

// ============================================================================
// 設定模型
// ============================================================================

/**
 * 日期範圍
 */
export interface DateRange {
  /** 起始日期 */
  from?: Date;
  /** 結束日期 */
  to?: Date;
}

/**
 * 應用程式設定
 */
export interface AppConfig {
  /** Telegram API ID */
  apiId: number;
  /** Telegram API Hash */
  apiHash: string;
  /** A 帳號電話號碼 */
  phoneNumberA: string;
  /** B 帳號識別碼（使用者名稱或電話） */
  targetUserB: string;
  /** Session 檔案路徑 */
  sessionPath: string;
  /** 進度檔案路徑 */
  progressPath: string;
  /** 每批次訊息數量 */
  batchSize: number;
  /** 批次間延遲（毫秒） */
  batchDelay: number;
  /** FloodWait 自動處理門檻（秒） */
  floodWaitThreshold: number;
  /** 群組名稱前綴 */
  groupNamePrefix: string;
  /** 日誌等級 */
  logLevel: LogLevel;
  /** 日誌檔案路徑 */
  logFilePath: string;
  /** 對話過濾條件（選填） */
  dialogFilter?: DialogFilter;
  /** 日期範圍（選填） */
  dateRange?: DateRange;
}

/**
 * 驗證設定
 */
export interface AuthConfig {
  /** Telegram API ID */
  apiId: number;
  /** Telegram API Hash */
  apiHash: string;
  /** Session 檔案路徑 */
  sessionPath: string;
  /** 電話號碼（選填，若無則互動輸入） */
  phoneNumber?: string;
  /** 連線重試次數 */
  connectionRetries?: number;
  /** FloodWait 自動等待門檻（秒） */
  floodSleepThreshold?: number;
}

// ============================================================================
// 遷移結果模型
// ============================================================================

/**
 * 訊息批次資訊
 */
export interface MessageBatch {
  /** 訊息列表 */
  messages: MessageInfo[];
  /** 是否還有更多訊息 */
  hasMore: boolean;
  /** 下一批次的起始 ID */
  nextOffsetId: number | null;
}

/**
 * 訊息基本資訊
 */
export interface MessageInfo {
  /** 訊息 ID */
  id: number;
  /** 發送時間 */
  date: Date;
  /** 是否包含媒體 */
  hasMedia: boolean;
}

/**
 * 取得訊息的選項
 */
export interface GetMessagesOptions {
  /** 起始訊息 ID（用於分頁） */
  offsetId?: number;
  /** 每批次數量 */
  limit?: number;
  /** 最早日期 */
  minDate?: Date;
  /** 最晚日期 */
  maxDate?: Date;
}

/**
 * 轉發結果
 */
export interface ForwardResult {
  /** 成功轉發的訊息數 */
  successCount: number;
  /** 失敗的訊息 ID 列表 */
  failedIds: number[];
}

/**
 * 單一對話遷移結果
 */
export interface DialogMigrationResult {
  /** 對話 ID */
  dialogId: string;
  /** 是否成功 */
  success: boolean;
  /** 已遷移訊息數 */
  migratedMessages: number;
  /** 失敗訊息數 */
  failedMessages: number;
  /** 錯誤訊息列表 */
  errors: string[];
}

/**
 * 完整遷移結果
 */
export interface MigrationResult {
  /** 對話總數 */
  totalDialogs: number;
  /** 已完成對話數 */
  completedDialogs: number;
  /** 失敗對話數 */
  failedDialogs: number;
  /** 訊息總數 */
  totalMessages: number;
  /** 已遷移訊息數 */
  migratedMessages: number;
  /** 執行時間（毫秒） */
  duration: number;
}

/**
 * 遷移設定
 */
export interface MigrationConfig {
  /** 每批次訊息數量 */
  batchSize: number;
  /** 群組設定 */
  groupConfig: GroupConfig;
  /** B 帳號識別碼 */
  targetAccountB: string;
  /** 進度檔案路徑 */
  progressPath: string;
  /** 對話過濾條件 */
  dialogFilter?: DialogFilter;
  /** 日期範圍 */
  dateRange?: DateRange;
}

/**
 * 遷移選項
 */
export interface MigrationOptions {
  /** 預覽模式（不實際執行） */
  dryRun?: boolean;
  /** 從特定對話繼續 */
  resumeFrom?: string;
}

// ============================================================================
// 日誌與報告模型
// ============================================================================

/**
 * 日誌上下文
 */
export interface LogContext {
  /** 對話 ID */
  dialogId?: string;
  /** 對話名稱 */
  dialogName?: string;
  /** 訊息 ID */
  messageId?: number;
  /** 操作名稱 */
  operation?: string;
  /** 其他自訂欄位 */
  [key: string]: unknown;
}

/**
 * 對話報告項目
 */
export interface DialogReportEntry {
  /** 對話 ID */
  dialogId: string;
  /** 對話名稱 */
  dialogName: string;
  /** 狀態 */
  status: DialogStatus;
  /** 錯誤訊息 */
  errors: string[];
}

/**
 * FloodWait 摘要
 */
export interface FloodWaitSummary {
  /** 事件總次數 */
  totalEvents: number;
  /** 總等待秒數 */
  totalSeconds: number;
  /** 最長單次等待 */
  maxWaitSeconds: number;
  /** 最常觸發的操作 */
  mostFrequentOperation: string | null;
}

/**
 * 遷移報告（簡易版，用於 LogService）
 */
export interface MigrationReport {
  /** 摘要說明 */
  summary: string;
  /** 執行時間 */
  duration: string;
  /** 統計資訊 */
  statistics: MigrationStats;
  /** 失敗對話列表 */
  failedDialogs: DialogReportEntry[];
  /** FloodWait 摘要 */
  floodWaitSummary: FloodWaitSummary;
}

/**
 * 遷移報告錯誤項目
 */
export interface MigrationReportError {
  /** 對話 ID */
  dialogId: string;
  /** 對話名稱 */
  dialogName: string;
  /** 錯誤訊息 */
  error: string;
  /** 發生時間（ISO 8601 格式） */
  timestamp: string;
}

/**
 * 詳細遷移報告（用於 ReportService）
 */
export interface DetailedMigrationReport {
  /** 開始時間 */
  startedAt: Date;
  /** 完成時間 */
  completedAt: Date;
  /** 執行時間（秒） */
  duration: number;
  /** 對話總數 */
  totalDialogs: number;
  /** 已完成對話數 */
  completedDialogs: number;
  /** 失敗對話數 */
  failedDialogs: number;
  /** 已跳過對話數 */
  skippedDialogs: number;
  /** 訊息總數 */
  totalMessages: number;
  /** 已遷移訊息數 */
  migratedMessages: number;
  /** 失敗訊息數 */
  failedMessages: number;
  /** FloodWait 摘要 */
  floodWaitSummary: {
    /** 事件總數 */
    totalEvents: number;
    /** 總等待時間（秒） */
    totalWaitTime: number;
    /** 最長等待時間（秒） */
    longestWait: number;
    /** 事件列表 */
    events: FloodWaitEvent[];
  };
  /** 錯誤清單 */
  errors: MigrationReportError[];
}

// ============================================================================
// 進度回呼模型
// ============================================================================

/**
 * 進度事件類型
 */
export type ProgressEvent =
  | { type: 'dialog_started'; dialogId: string; totalMessages: number }
  | { type: 'batch_completed'; dialogId: string; count: number; total: number }
  | { type: 'dialog_completed'; dialogId: string; result: DialogMigrationResult }
  | { type: 'flood_wait'; seconds: number; operation: string };

/**
 * 進度回呼函式
 */
export type ProgressCallback = (event: ProgressEvent) => void;

// ============================================================================
// Rate Limiter 模型
// ============================================================================

/**
 * Rate Limiter 統計資訊
 */
export interface RateLimiterStats {
  /** 已執行的請求數 */
  totalRequests: number;
  /** FloodWait 事件數 */
  floodWaitCount: number;
  /** 總等待時間（毫秒） */
  totalWaitTime: number;
  /** 當前速率（請求/秒） */
  currentRate: number;
}
