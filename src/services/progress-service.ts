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
} from '../types/models.js';
import { DialogStatus, MigrationPhase } from '../types/enums.js';

/**
 * 支援的進度檔案版本
 */
const SUPPORTED_VERSION = '1.0';

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

  /**
   * 匯出進度為 JSON 字串
   *
   * @param progress - 進度狀態
   * @returns JSON 字串
   */
  exportProgress(progress: MigrationProgress): string {
    const jsonData = this.toJson(progress);
    return JSON.stringify(jsonData, null, 2);
  }

  /**
   * 從 JSON 字串匯入進度
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

    // 驗證 schema
    const validationResult = this.validateSchema(parsed);
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
    return success(this.parseProgressData(parsed as ProgressJson));
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
}
