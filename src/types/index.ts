/**
 * 型別模組 Barrel Export
 *
 * 統一匯出所有型別定義，方便其他模組引用。
 */

// Result 型別與輔助函式
export type { Result } from './result.js';
export { success, failure, isSuccess, isFailure } from './result.js';

// 列舉型別
export { DialogType, DialogStatus, LogLevel, MigrationPhase } from './enums.js';
// 也匯出列舉值的型別別名（用於型別標註）
export type {
  DialogType as DialogTypeValue,
  DialogStatus as DialogStatusValue,
  LogLevel as LogLevelValue,
  MigrationPhase as MigrationPhaseValue,
} from './enums.js';

// 錯誤型別
export type {
  AuthError,
  DialogServiceError,
  GroupError,
  MigrationError,
  ProgressError,
  ConfigError,
  FileError,
} from './errors.js';

// 資料模型
export type {
  // 對話相關
  DialogInfo,
  DialogFilter,
  // 群組相關
  GroupInfo,
  GroupConfig,
  // 進度追蹤
  DialogError,
  DialogProgress,
  FloodWaitEvent,
  MigrationStats,
  MigrationProgress,
  // 設定
  DateRange,
  AppConfig,
  AuthConfig,
  // 遷移結果
  MessageBatch,
  MessageInfo,
  GetMessagesOptions,
  ForwardResult,
  DialogMigrationResult,
  MigrationResult,
  MigrationConfig,
  MigrationOptions,
  // 日誌與報告
  LogContext,
  DialogReportEntry,
  FloodWaitSummary,
  MigrationReport,
  // 進度回呼
  ProgressEvent,
  ProgressCallback,
  // Rate Limiter
  RateLimiterStats,
} from './models.js';

// 服務介面
export type {
  IAuthService,
  IDialogService,
  IGroupService,
  IMigrationService,
  IProgressService,
  ILogService,
  IConfigLoader,
  IRateLimiter,
} from './interfaces.js';
