/**
 * ProgressService - 進度持久化服務
 *
 * 管理遷移進度的持久化與讀取，支援斷點續傳。
 * 實作原子寫入機制確保檔案不會因中斷而損毀。
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 *
 * @module services/progress-service
 */

import * as fs from 'fs';
import type { Result } from '../types/result.js';
import { success, failure } from '../types/result.js';
import type { ProgressError } from '../types/errors.js';
import type { IProgressService } from '../types/interfaces.js';
import type {
  MigrationProgress,
  DialogProgress,
  MigrationStats,
  FloodWaitEvent,
  DailyGroupCreation,
} from '../types/models.js';
import { DialogStatus, MigrationPhase, MergeStrategy } from '../types/enums.js';

/**
 * 支援的進度檔案版本
 */
const SUPPORTED_VERSION = '1.0';

/**
 * 支援的匯出格式版本
 */
const SUPPORTED_EXPORT_VERSION = '1.0';

/**
 * 進度持久化服務實作
 *
 * 提供進度檔案的讀取、儲存、更新與匯出/匯入功能。
 * 使用原子寫入機制（先寫入暫存檔再 rename）確保資料完整性。
 */
export class ProgressService implements IProgressService {
  /**
   * 載入進度檔案
   *
   * 若檔案不存在則回傳空狀態。
   * 載入時驗證 JSON schema 與版本相容性。
   *
   * @param path - 進度檔案路徑
   * @returns 進度狀態或錯誤
   */
  async load(path: string): Promise<Result<MigrationProgress, ProgressError>> {
    // 檢查檔案是否存在
    if (!fs.existsSync(path)) {
      return success(this.createEmptyProgress());
    }

    // 讀取檔案內容
    let content: string;
    try {
      content = fs.readFileSync(path, 'utf-8');
    } catch (error) {
      return failure({
        type: 'FILE_CORRUPTED',
        path,
        message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // 處理空檔案
    if (!content.trim()) {
      return failure({
        type: 'FILE_CORRUPTED',
        path,
        message: 'File is empty',
      });
    }

    // 解析 JSON
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch (error) {
      return failure({
        type: 'FILE_CORRUPTED',
        path,
        message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // 驗證 schema
    const validationResult = this.validateSchema(data);
    if (!validationResult.success) {
      return validationResult;
    }

    // 將物件轉換為 MigrationProgress 格式
    return success(this.parseProgressData(data as ProgressJson));
  }

  /**
   * 儲存進度至檔案
   *
   * 使用原子寫入機制：先寫入暫存檔再 rename，避免檔案損毀。
   *
   * @param path - 進度檔案路徑
   * @param progress - 進度狀態
   * @returns 成功或錯誤
   */
  async save(
    path: string,
    progress: MigrationProgress
  ): Promise<Result<void, ProgressError>> {
    const tmpPath = `${path}.tmp`;

    // 更新 updatedAt 時間戳記
    const updatedProgress: MigrationProgress = {
      ...progress,
      updatedAt: new Date().toISOString(),
    };

    // 將 MigrationProgress 轉換為 JSON 格式
    const jsonData = this.toJson(updatedProgress);

    // 寫入暫存檔
    try {
      await fs.promises.writeFile(tmpPath, JSON.stringify(jsonData, null, 2));
    } catch (error) {
      return failure({
        type: 'WRITE_FAILED',
        path,
        message: `Failed to write temp file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // 原子 rename
    try {
      await fs.promises.rename(tmpPath, path);
    } catch (error) {
      // 清理暫存檔
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        // 忽略清理失敗
      }
      return failure({
        type: 'WRITE_FAILED',
        path,
        message: `Failed to rename temp file: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return success(undefined);
  }

  /**
   * 更新特定對話的遷移進度
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param lastMessageId - 最後處理的訊息 ID
   * @param messageCount - 本批次遷移的訊息數
   * @returns 更新後的進度
   */
  updateDialogProgress(
    progress: MigrationProgress,
    dialogId: string,
    lastMessageId: number,
    messageCount: number
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      lastMessageId,
      migratedCount: dialogProgress.migratedCount + messageCount,
      status: DialogStatus.InProgress,
      startedAt: dialogProgress.startedAt ?? new Date().toISOString(),
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    // 更新統計資訊
    const newStats: MigrationStats = {
      ...progress.stats,
      migratedMessages: progress.stats.migratedMessages + messageCount,
    };

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 標記對話遷移完成
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @returns 更新後的進度
   */
  markDialogComplete(
    progress: MigrationProgress,
    dialogId: string
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      status: DialogStatus.Completed,
      completedAt: new Date().toISOString(),
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    // 更新統計資訊
    const newStats: MigrationStats = {
      ...progress.stats,
      completedDialogs: progress.stats.completedDialogs + 1,
    };

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 取得對話的遷移狀態
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @returns 對話狀態，若不存在回傳 pending
   */
  getDialogStatus(progress: MigrationProgress, dialogId: string): DialogStatus {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return DialogStatus.Pending;
    }
    return dialogProgress.status;
  }

  // ============================================================================
  // Task 5.2: 對話進度追蹤方法
  // Requirements: 6.2, 6.4, 6.5
  // ============================================================================

  /**
   * 初始化對話進度
   *
   * 建立新的對話進度記錄，狀態為 pending，並更新整體統計。
   *
   * @param progress - 目前進度
   * @param dialogInfo - 對話初始化資訊
   * @returns 更新後的進度
   */
  initializeDialog(
    progress: MigrationProgress,
    dialogInfo: {
      dialogId: string;
      dialogName: string;
      dialogType: import('../types/enums.js').DialogType;
      totalCount: number;
    }
  ): MigrationProgress {
    const { dialogId, dialogName, dialogType, totalCount } = dialogInfo;

    // 建立新的對話進度
    const newDialogProgress: DialogProgress = {
      dialogId,
      dialogName,
      dialogType,
      status: DialogStatus.Pending,
      targetGroupId: null,
      lastMessageId: null,
      migratedCount: 0,
      totalCount,
      errors: [],
      startedAt: null,
      completedAt: null,
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, newDialogProgress);

    // 更新統計資訊
    const newStats: MigrationStats = {
      ...progress.stats,
      totalDialogs: progress.stats.totalDialogs + 1,
      totalMessages: progress.stats.totalMessages + totalCount,
    };

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 標記對話開始遷移
   *
   * 將對話狀態設為 in_progress，設定目標群組 ID 與開始時間。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param targetGroupId - 目標群組 ID
   * @returns 更新後的進度
   */
  markDialogStarted(
    progress: MigrationProgress,
    dialogId: string,
    targetGroupId: string
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      status: DialogStatus.InProgress,
      targetGroupId,
      startedAt: new Date().toISOString(),
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    return {
      ...progress,
      dialogs: newDialogs,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 標記對話遷移失敗
   *
   * 將對話狀態設為 failed，記錄錯誤訊息，並更新失敗對話統計。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param error - 錯誤訊息
   * @returns 更新後的進度
   */
  markDialogFailed(
    progress: MigrationProgress,
    dialogId: string,
    error: string
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立錯誤記錄
    const errorRecord = {
      timestamp: new Date().toISOString(),
      messageId: null,
      errorType: 'MIGRATION_FAILED',
      errorMessage: error,
    };

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      status: DialogStatus.Failed,
      errors: [...dialogProgress.errors, errorRecord],
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    // 更新統計資訊
    const newStats: MigrationStats = {
      ...progress.stats,
      failedDialogs: progress.stats.failedDialogs + 1,
    };

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 標記對話為部分遷移狀態
   *
   * 當因 FloodWait 超時中斷時，將對話標記為 partially_migrated，
   * 記錄已遷移的進度，支援後續從斷點恢復。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param lastMigratedMessageId - 最後成功遷移的訊息 ID
   * @param floodWaitSeconds - FloodWait 等待秒數（用於記錄）
   * @returns 更新後的進度
   */
  markDialogPartiallyMigrated(
    progress: MigrationProgress,
    dialogId: string,
    lastMigratedMessageId: number | null,
    floodWaitSeconds?: number
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立中斷記錄
    const interruptRecord = {
      timestamp: new Date().toISOString(),
      messageId: lastMigratedMessageId,
      errorType: 'FLOOD_WAIT_TIMEOUT',
      errorMessage: floodWaitSeconds
        ? `FloodWait 超時中斷 (${floodWaitSeconds}s > 300s 限制)`
        : 'FloodWait 超時中斷',
    };

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      status: DialogStatus.PartiallyMigrated,
      lastMessageId: lastMigratedMessageId,
      errors: [...dialogProgress.errors, interruptRecord],
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    return {
      ...progress,
      dialogs: newDialogs,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 取得對話的恢復點資訊
   *
   * 檢查對話是否為 PartiallyMigrated 或 InProgress 狀態，
   * 若是則回傳恢復點資訊（最後訊息 ID 與已遷移數量）。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @returns 恢復點資訊，若無則回傳 null
   */
  getResumePoint(
    progress: MigrationProgress,
    dialogId: string
  ): { lastMessageId: number; migratedCount: number; targetGroupId: string } | null {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return null;
    }

    // 只有 PartiallyMigrated 或 InProgress 狀態才有恢復點
    if (
      dialogProgress.status !== DialogStatus.PartiallyMigrated &&
      dialogProgress.status !== DialogStatus.InProgress
    ) {
      return null;
    }

    // 必須有 lastMessageId 和 targetGroupId 才能恢復
    if (!dialogProgress.lastMessageId || !dialogProgress.targetGroupId) {
      return null;
    }

    return {
      lastMessageId: dialogProgress.lastMessageId,
      migratedCount: dialogProgress.migratedCount,
      targetGroupId: dialogProgress.targetGroupId,
    };
  }

  /**
   * 標記對話跳過
   *
   * 將對話狀態設為 skipped，記錄跳過原因，並更新跳過對話統計。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param reason - 跳過原因
   * @returns 更新後的進度
   */
  markDialogSkipped(
    progress: MigrationProgress,
    dialogId: string,
    reason: string
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立跳過記錄
    const skipRecord = {
      timestamp: new Date().toISOString(),
      messageId: null,
      errorType: 'SKIPPED',
      errorMessage: reason,
    };

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      status: DialogStatus.Skipped,
      errors: [...dialogProgress.errors, skipRecord],
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    // 更新統計資訊
    const newStats: MigrationStats = {
      ...progress.stats,
      skippedDialogs: progress.stats.skippedDialogs + 1,
    };

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 更新訊息遷移進度
   *
   * 更新指定對話的最後處理訊息 ID 與已遷移訊息數。
   * 同時更新整體遷移進度的 updatedAt 與 migratedMessages 統計。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param lastMessageId - 最後處理的訊息 ID
   * @param batchCount - 本批次遷移的訊息數
   * @returns 更新後的進度
   */
  updateMessageProgress(
    progress: MigrationProgress,
    dialogId: string,
    lastMessageId: number,
    batchCount: number
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      lastMessageId,
      migratedCount: dialogProgress.migratedCount + batchCount,
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    // 更新統計資訊
    const newStats: MigrationStats = {
      ...progress.stats,
      migratedMessages: progress.stats.migratedMessages + batchCount,
    };

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 新增對話錯誤記錄
   *
   * 將錯誤訊息新增到指定對話的 errors 陣列，並更新失敗訊息統計。
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @param error - 錯誤訊息
   * @param messageId - 相關訊息 ID（選填）
   * @returns 更新後的進度
   */
  addDialogError(
    progress: MigrationProgress,
    dialogId: string,
    error: string,
    messageId?: number
  ): MigrationProgress {
    const dialogProgress = progress.dialogs.get(dialogId);
    if (!dialogProgress) {
      return progress;
    }

    // 建立錯誤記錄
    const errorRecord = {
      timestamp: new Date().toISOString(),
      messageId: messageId ?? null,
      errorType: 'MESSAGE_ERROR',
      errorMessage: error,
    };

    // 建立更新後的對話進度
    const updatedDialogProgress: DialogProgress = {
      ...dialogProgress,
      errors: [...dialogProgress.errors, errorRecord],
    };

    // 建立新的 Map
    const newDialogs = new Map(progress.dialogs);
    newDialogs.set(dialogId, updatedDialogProgress);

    // 更新統計資訊（若有 messageId 則增加失敗訊息計數）
    const newStats: MigrationStats = messageId
      ? {
          ...progress.stats,
          failedMessages: progress.stats.failedMessages + 1,
        }
      : progress.stats;

    return {
      ...progress,
      dialogs: newDialogs,
      stats: newStats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 取得單一對話的進度
   *
   * @param progress - 目前進度
   * @param dialogId - 對話 ID
   * @returns 對話進度，若不存在回傳 undefined
   */
  getDialogProgress(
    progress: MigrationProgress,
    dialogId: string
  ): DialogProgress | undefined {
    return progress.dialogs.get(dialogId);
  }

  /**
   * 取得所有對話的進度
   *
   * @param progress - 目前進度
   * @returns 所有對話進度的 Map
   */
  getAllDialogProgress(
    progress: MigrationProgress
  ): Map<string, DialogProgress> {
    return progress.dialogs;
  }

  // ============================================================================
  // 每日群組建立計數管理
  // ============================================================================

  /**
   * 取得今日的日期字串（YYYY-MM-DD 格式）
   */
  private getTodayDateString(): string {
    const now = new Date();
    // toISOString 格式為 YYYY-MM-DDTHH:mm:ss.sssZ，split('T')[0] 必定存在
    const dateStr = now.toISOString().split('T')[0];
    return dateStr as string;
  }

  /**
   * 取得當日群組建立計數
   *
   * 若日期已過期（非今日），則回傳 0。
   *
   * @param progress - 目前進度
   * @returns 當日群組建立計數
   */
  getDailyGroupCreationCount(progress: MigrationProgress): number {
    const today = this.getTodayDateString();
    const dailyData = progress.dailyGroupCreation;

    if (!dailyData || dailyData.date !== today) {
      return 0;
    }

    return dailyData.count;
  }

  /**
   * 增加每日群組建立計數
   *
   * 若日期已過期（非今日），則重置計數為 1。
   *
   * @param progress - 目前進度
   * @returns 更新後的進度
   */
  incrementDailyGroupCreation(progress: MigrationProgress): MigrationProgress {
    const today = this.getTodayDateString();
    const currentData = progress.dailyGroupCreation;

    let newCount: number;
    if (!currentData || currentData.date !== today) {
      // 新的一天，重置計數
      newCount = 1;
    } else {
      // 同一天，增加計數
      newCount = currentData.count + 1;
    }

    return {
      ...progress,
      dailyGroupCreation: {
        date: today,
        count: newCount,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 重置每日群組建立計數
   *
   * 將計數重置為 0（保持今日日期）。
   *
   * @param progress - 目前進度
   * @returns 更新後的進度
   */
  resetDailyGroupCreation(progress: MigrationProgress): MigrationProgress {
    return {
      ...progress,
      dailyGroupCreation: {
        date: this.getTodayDateString(),
        count: 0,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 檢查是否達到每日群組建立限制
   *
   * @param progress - 目前進度
   * @param limit - 每日限制數量
   * @returns 是否達到限制
   */
  isDailyGroupLimitReached(progress: MigrationProgress, limit: number): boolean {
    return this.getDailyGroupCreationCount(progress) >= limit;
  }

  /**
   * 匯出進度為可分享的 JSON 字串
   *
   * 匯出格式包含版本號與匯出時間，方便追蹤與驗證。
   *
   * @param progress - 進度狀態
   * @returns JSON 字串（pretty-printed）
   */
  exportProgress(progress: MigrationProgress): string {
    const exportData: ExportedProgress = {
      exportVersion: SUPPORTED_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      progress: this.toJson(progress),
    };
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 從 JSON 字串匯入進度
   *
   * 支援新匯出格式（含 exportVersion）與舊格式（直接是進度物件）的向後相容。
   *
   * @param data - JSON 字串
   * @returns 進度狀態或錯誤
   */
  importProgress(data: string): Result<MigrationProgress, ProgressError> {
    // 解析 JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      return failure({
        type: 'INVALID_FORMAT',
        message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return failure({
        type: 'INVALID_FORMAT',
        message: 'Data must be an object',
      });
    }

    const obj = parsed as Record<string, unknown>;

    // 判斷是新格式還是舊格式
    let progressData: unknown;
    if ('exportVersion' in obj) {
      // 新格式：驗證 exportVersion
      if (obj.exportVersion !== SUPPORTED_EXPORT_VERSION) {
        return failure({
          type: 'INVALID_FORMAT',
          message: `Unsupported export version: ${obj.exportVersion}. Expected: ${SUPPORTED_EXPORT_VERSION}`,
        });
      }
      // 從 progress 欄位取得進度資料
      if (!('progress' in obj) || typeof obj.progress !== 'object' || obj.progress === null) {
        return failure({
          type: 'INVALID_FORMAT',
          message: 'Missing or invalid progress field in export data',
        });
      }
      progressData = obj.progress;
    } else if ('progress' in obj && typeof obj.progress === 'object' && obj.progress !== null) {
      // 新格式但缺少 exportVersion（向後相容：假設為 1.0）
      progressData = obj.progress;
    } else {
      // 舊格式：直接是進度物件
      progressData = parsed;
    }

    // 驗證 schema
    const validationResult = this.validateSchema(progressData);
    if (!validationResult.success) {
      const errorMessage =
        validationResult.error.type === 'INVALID_FORMAT'
          ? validationResult.error.message
          : `Validation failed: ${validationResult.error.type}`;
      return failure({
        type: 'INVALID_FORMAT',
        message: errorMessage,
      });
    }

    // 將物件轉換為 MigrationProgress 格式
    return success(this.parseProgressData(progressData as ProgressJson));
  }

  /**
   * 合併進度
   *
   * 根據指定的策略合併既有進度與匯入進度。
   *
   * @param existing - 既有進度
   * @param imported - 匯入進度
   * @param strategy - 合併策略
   * @returns 合併後的進度
   */
  mergeProgress(
    existing: MigrationProgress,
    imported: MigrationProgress,
    strategy: MergeStrategy
  ): MigrationProgress {
    switch (strategy) {
      case MergeStrategy.OverwriteAll:
        return this.mergeOverwriteAll(imported);

      case MergeStrategy.SkipCompleted:
        return this.mergeSkipCompleted(existing, imported);

      case MergeStrategy.MergeProgress:
        return this.mergeBestProgress(existing, imported);

      default:
        // 預設使用 MergeProgress 策略
        return this.mergeBestProgress(existing, imported);
    }
  }

  // ============================================================================
  // 合併策略實作
  // ============================================================================

  /**
   * OverwriteAll 策略：完全覆蓋
   */
  private mergeOverwriteAll(imported: MigrationProgress): MigrationProgress {
    // 直接回傳匯入的進度，更新時間戳記
    return {
      ...imported,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * SkipCompleted 策略：保留已完成的對話
   */
  private mergeSkipCompleted(
    existing: MigrationProgress,
    imported: MigrationProgress
  ): MigrationProgress {
    const mergedDialogs = new Map<string, DialogProgress>();

    // 先加入既有對話（保留已完成的）
    for (const [dialogId, dialogProgress] of existing.dialogs) {
      mergedDialogs.set(dialogId, dialogProgress);
    }

    // 加入匯入的對話（僅加入不存在或未完成的）
    for (const [dialogId, importedDialog] of imported.dialogs) {
      const existingDialog = mergedDialogs.get(dialogId);

      if (!existingDialog) {
        // 不存在：直接加入
        mergedDialogs.set(dialogId, importedDialog);
      } else if (existingDialog.status !== DialogStatus.Completed) {
        // 存在但未完成：使用匯入的資料
        mergedDialogs.set(dialogId, importedDialog);
      }
      // 若既有的已完成，則保留既有的（不做任何事）
    }

    // 重新計算統計
    const stats = this.recalculateStats(mergedDialogs);

    return {
      ...existing,
      dialogs: mergedDialogs,
      stats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * MergeProgress 策略：保留進度較多的版本
   */
  private mergeBestProgress(
    existing: MigrationProgress,
    imported: MigrationProgress
  ): MigrationProgress {
    const mergedDialogs = new Map<string, DialogProgress>();

    // 取得所有對話 ID
    const allDialogIds = new Set([
      ...existing.dialogs.keys(),
      ...imported.dialogs.keys(),
    ]);

    for (const dialogId of allDialogIds) {
      const existingDialog = existing.dialogs.get(dialogId);
      const importedDialog = imported.dialogs.get(dialogId);

      if (!existingDialog && importedDialog) {
        // 僅存在於匯入
        mergedDialogs.set(dialogId, importedDialog);
      } else if (existingDialog && !importedDialog) {
        // 僅存在於既有
        mergedDialogs.set(dialogId, existingDialog);
      } else if (existingDialog && importedDialog) {
        // 兩者都有：選擇進度較多的
        const bestDialog = this.selectBestProgress(existingDialog, importedDialog);
        mergedDialogs.set(dialogId, bestDialog);
      }
    }

    // 重新計算統計
    const stats = this.recalculateStats(mergedDialogs);

    return {
      ...existing,
      dialogs: mergedDialogs,
      stats,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * 選擇進度較多的對話
   */
  private selectBestProgress(
    dialog1: DialogProgress,
    dialog2: DialogProgress
  ): DialogProgress {
    // 已完成狀態優先（視為 100% 完成）
    if (dialog1.status === DialogStatus.Completed && dialog2.status !== DialogStatus.Completed) {
      return dialog1;
    }
    if (dialog2.status === DialogStatus.Completed && dialog1.status !== DialogStatus.Completed) {
      return dialog2;
    }

    // PartiallyMigrated 優先於 Pending/Failed（有部分進度）
    const hasPartialProgress1 =
      dialog1.status === DialogStatus.PartiallyMigrated ||
      dialog1.status === DialogStatus.InProgress;
    const hasPartialProgress2 =
      dialog2.status === DialogStatus.PartiallyMigrated ||
      dialog2.status === DialogStatus.InProgress;

    if (hasPartialProgress1 && !hasPartialProgress2) {
      return dialog1;
    }
    if (hasPartialProgress2 && !hasPartialProgress1) {
      return dialog2;
    }

    // 否則比較 migratedCount
    if (dialog1.migratedCount >= dialog2.migratedCount) {
      return dialog1;
    }
    return dialog2;
  }

  /**
   * 重新計算統計資訊
   */
  private recalculateStats(dialogs: Map<string, DialogProgress>): MigrationStats {
    let totalDialogs = 0;
    let completedDialogs = 0;
    let failedDialogs = 0;
    let skippedDialogs = 0;
    let totalMessages = 0;
    let migratedMessages = 0;
    let failedMessages = 0;

    for (const dialog of dialogs.values()) {
      totalDialogs++;
      totalMessages += dialog.totalCount;
      migratedMessages += dialog.migratedCount;

      switch (dialog.status) {
        case DialogStatus.Completed:
          completedDialogs++;
          break;
        case DialogStatus.Failed:
          failedDialogs++;
          break;
        case DialogStatus.Skipped:
          skippedDialogs++;
          break;
      }

      // 計算失敗訊息數（從 errors 中有 messageId 的項目計算）
      for (const error of dialog.errors) {
        if (error.messageId !== null) {
          failedMessages++;
        }
      }
    }

    return {
      totalDialogs,
      completedDialogs,
      failedDialogs,
      skippedDialogs,
      totalMessages,
      migratedMessages,
      failedMessages,
      floodWaitCount: 0, // 合併時不計算 FloodWait
      totalFloodWaitSeconds: 0,
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 建立空的進度狀態
   */
  private createEmptyProgress(): MigrationProgress {
    const now = new Date().toISOString();
    return {
      version: SUPPORTED_VERSION,
      startedAt: now,
      updatedAt: now,
      sourceAccount: '',
      targetAccount: '',
      currentPhase: MigrationPhase.Idle,
      dialogs: new Map(),
      floodWaitEvents: [],
      stats: {
        totalDialogs: 0,
        completedDialogs: 0,
        failedDialogs: 0,
        skippedDialogs: 0,
        totalMessages: 0,
        migratedMessages: 0,
        failedMessages: 0,
        floodWaitCount: 0,
        totalFloodWaitSeconds: 0,
      },
    };
  }

  /**
   * 驗證 JSON schema
   */
  private validateSchema(
    data: unknown
  ): Result<MigrationProgress, ProgressError> {
    if (typeof data !== 'object' || data === null) {
      return failure({
        type: 'INVALID_FORMAT',
        message: 'Data must be an object',
      });
    }

    const obj = data as Record<string, unknown>;

    // 驗證 version 欄位
    if (typeof obj.version !== 'string') {
      return failure({
        type: 'INVALID_FORMAT',
        message: 'Missing or invalid version field',
      });
    }

    // 驗證版本相容性
    if (obj.version !== SUPPORTED_VERSION) {
      return failure({
        type: 'INVALID_FORMAT',
        message: `Unsupported version: ${obj.version}. Expected: ${SUPPORTED_VERSION}`,
      });
    }

    // 驗證 startedAt 欄位
    if (typeof obj.startedAt !== 'string') {
      return failure({
        type: 'INVALID_FORMAT',
        message: 'Missing or invalid startedAt field',
      });
    }

    // 驗證 dialogs 欄位
    if (typeof obj.dialogs !== 'object' || obj.dialogs === null) {
      return failure({
        type: 'INVALID_FORMAT',
        message: 'Missing or invalid dialogs field',
      });
    }

    return success(this.createEmptyProgress()); // 暫時回傳，實際解析在 parseProgressData
  }

  /**
   * 將 JSON 物件解析為 MigrationProgress
   */
  private parseProgressData(data: ProgressJson): MigrationProgress {
    // 將 dialogs 物件轉換為 Map
    const dialogsMap = new Map<string, DialogProgress>();
    if (data.dialogs) {
      for (const [key, value] of Object.entries(data.dialogs)) {
        dialogsMap.set(key, value as DialogProgress);
      }
    }

    // 解析 floodWaitEvents
    const floodWaitEvents: FloodWaitEvent[] = data.floodWaitEvents ?? [];

    // 解析 stats
    const stats: MigrationStats = data.stats ?? {
      totalDialogs: 0,
      completedDialogs: 0,
      failedDialogs: 0,
      skippedDialogs: 0,
      totalMessages: 0,
      migratedMessages: 0,
      failedMessages: 0,
      floodWaitCount: 0,
      totalFloodWaitSeconds: 0,
    };

    return {
      version: data.version,
      startedAt: data.startedAt,
      updatedAt: data.updatedAt ?? data.startedAt,
      sourceAccount: data.sourceAccount ?? '',
      targetAccount: data.targetAccount ?? '',
      currentPhase: data.currentPhase ?? MigrationPhase.Idle,
      dialogs: dialogsMap,
      floodWaitEvents,
      stats,
      dailyGroupCreation: data.dailyGroupCreation,
    };
  }

  /**
   * 將 MigrationProgress 轉換為 JSON 物件
   */
  private toJson(progress: MigrationProgress): ProgressJson {
    // 將 Map 轉換為物件
    const dialogsObj: Record<string, DialogProgress> = {};
    for (const [key, value] of progress.dialogs) {
      dialogsObj[key] = value;
    }

    return {
      version: progress.version,
      startedAt: progress.startedAt,
      updatedAt: progress.updatedAt,
      sourceAccount: progress.sourceAccount,
      targetAccount: progress.targetAccount,
      currentPhase: progress.currentPhase,
      dialogs: dialogsObj,
      floodWaitEvents: progress.floodWaitEvents,
      stats: progress.stats,
      dailyGroupCreation: progress.dailyGroupCreation,
    };
  }
}

/**
 * JSON 格式的進度資料結構（用於檔案儲存與傳輸）
 */
interface ProgressJson {
  version: string;
  startedAt: string;
  updatedAt?: string;
  sourceAccount?: string;
  targetAccount?: string;
  currentPhase?: MigrationPhase;
  dialogs: Record<string, DialogProgress>;
  floodWaitEvents?: FloodWaitEvent[];
  stats?: MigrationStats;
  dailyGroupCreation?: DailyGroupCreation;
}

/**
 * 匯出格式的進度資料結構（含版本與時間戳記）
 */
interface ExportedProgress {
  /** 匯出格式版本 */
  exportVersion: string;
  /** 匯出時間 */
  exportedAt: string;
  /** 進度資料 */
  progress: ProgressJson;
}

/**
 * 對話初始化資訊
 */
export interface DialogInitInfo {
  /** 對話 ID */
  dialogId: string;
  /** 對話名稱 */
  dialogName: string;
  /** 對話類型 */
  dialogType: import('../types/enums.js').DialogType;
  /** 總訊息數 */
  totalCount: number;
}
