/**
 * 列舉型別定義
 *
 * 定義系統中使用的各種列舉值，使用 const enum-like objects
 * 以保持 JavaScript 執行時可存取且具備型別安全性。
 */

/**
 * 對話類型
 */
export const DialogType = {
  /** 私人聊天 */
  Private: 'private',
  /** 一般群組 */
  Group: 'group',
  /** 超級群組 */
  Supergroup: 'supergroup',
  /** 頻道 */
  Channel: 'channel',
  /** 機器人對話 */
  Bot: 'bot',
} as const;

export type DialogType = (typeof DialogType)[keyof typeof DialogType];

/**
 * 對話遷移狀態
 */
export const DialogStatus = {
  /** 等待處理 */
  Pending: 'pending',
  /** 處理中 */
  InProgress: 'in_progress',
  /** 部分遷移（因 FloodWait 超時中斷，可從斷點恢復） */
  PartiallyMigrated: 'partially_migrated',
  /** 已完成 */
  Completed: 'completed',
  /** 失敗 */
  Failed: 'failed',
  /** 已跳過 */
  Skipped: 'skipped',
} as const;

export type DialogStatus = (typeof DialogStatus)[keyof typeof DialogStatus];

/**
 * 日誌等級
 */
export const LogLevel = {
  /** 偵錯資訊 */
  Debug: 'debug',
  /** 一般資訊 */
  Info: 'info',
  /** 警告 */
  Warn: 'warn',
  /** 錯誤 */
  Error: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/**
 * 遷移階段
 */
export const MigrationPhase = {
  /** 閒置狀態 */
  Idle: 'idle',
  /** 驗證中 */
  Authenticating: 'authenticating',
  /** 取得對話清單中 */
  FetchingDialogs: 'fetching_dialogs',
  /** 建立群組中 */
  CreatingGroups: 'creating_groups',
  /** 遷移訊息中 */
  MigratingMessages: 'migrating_messages',
  /** 已完成 */
  Completed: 'completed',
} as const;

export type MigrationPhase = (typeof MigrationPhase)[keyof typeof MigrationPhase];

/**
 * 進度合併策略
 */
export const MergeStrategy = {
  /** 跳過已完成的對話，保留既有進度 */
  SkipCompleted: 'skip_completed',
  /** 完全覆蓋，使用匯入的資料取代既有進度 */
  OverwriteAll: 'overwrite_all',
  /** 合併進度，保留進度較多的版本 */
  MergeProgress: 'merge_progress',
} as const;

export type MergeStrategy = (typeof MergeStrategy)[keyof typeof MergeStrategy];
