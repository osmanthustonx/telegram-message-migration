/**
 * 錯誤型別定義
 *
 * 使用 discriminated union 定義各服務的錯誤類型，
 * 讓錯誤處理具備型別安全性與詳細的上下文資訊。
 */

// ============================================================================
// 驗證服務錯誤
// ============================================================================

/**
 * 驗證服務錯誤類型
 */
export type AuthError =
  | { type: 'INVALID_CREDENTIALS'; message: string }
  | { type: 'INVALID_CODE'; message: string; attemptsLeft: number }
  | { type: 'INVALID_2FA'; message: string }
  | { type: 'NETWORK_ERROR'; message: string; retryCount: number }
  | { type: 'SESSION_EXPIRED'; message: string };

// ============================================================================
// 對話服務錯誤
// ============================================================================

/**
 * 對話服務錯誤類型
 */
export type DialogServiceError =
  | { type: 'FETCH_FAILED'; message: string }
  | { type: 'NOT_FOUND'; dialogId: string }
  | { type: 'ACCESS_DENIED'; dialogId: string };

// ============================================================================
// 群組服務錯誤
// ============================================================================

/**
 * 群組服務錯誤類型
 */
export type GroupError =
  | { type: 'CREATE_FAILED'; message: string }
  | { type: 'USER_RESTRICTED'; message: string }
  | { type: 'INVITE_FAILED'; userIdentifier: string; message: string }
  | { type: 'USER_NOT_FOUND'; userIdentifier: string }
  | { type: 'FLOOD_WAIT'; seconds: number };

// ============================================================================
// 遷移服務錯誤
// ============================================================================

/**
 * 遷移服務錯誤類型
 */
export type MigrationError =
  | { type: 'DIALOG_FETCH_FAILED'; message: string }
  | { type: 'GROUP_CREATE_FAILED'; dialogId: string; message: string }
  | { type: 'INVITE_FAILED'; dialogId: string; message: string }
  | { type: 'FORWARD_FAILED'; dialogId: string; messageIds: number[]; message: string }
  | { type: 'FLOOD_WAIT'; seconds: number }
  | { type: 'ABORTED'; reason: string };

// ============================================================================
// 進度服務錯誤
// ============================================================================

/**
 * 進度服務錯誤類型
 */
export type ProgressError =
  | { type: 'FILE_NOT_FOUND'; path: string }
  | { type: 'FILE_CORRUPTED'; path: string; message: string }
  | { type: 'WRITE_FAILED'; path: string; message: string }
  | { type: 'INVALID_FORMAT'; message: string };

// ============================================================================
// 設定服務錯誤
// ============================================================================

/**
 * 設定服務錯誤類型
 */
export type ConfigError =
  | { type: 'MISSING_REQUIRED'; field: string }
  | { type: 'INVALID_VALUE'; field: string; message: string }
  | { type: 'FILE_NOT_FOUND'; path: string };

// ============================================================================
// 檔案操作錯誤
// ============================================================================

/**
 * 檔案操作錯誤類型
 */
export type FileError =
  | { type: 'READ_FAILED'; path: string; message: string }
  | { type: 'WRITE_FAILED'; path: string; message: string }
  | { type: 'NOT_FOUND'; path: string }
  | { type: 'PERMISSION_DENIED'; path: string };
