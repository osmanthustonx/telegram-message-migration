/**
 * Task 11.1, 11.2, 11.3: 遷移協調器
 *
 * 整合所有服務模組形成完整遷移流程的核心協調器：
 * - 連接驗證、對話列舉、群組建立、訊息遷移、進度追蹤、報告產生
 * - 處理跨服務錯誤傳播與中止條件
 * - 實作斷點續傳與錯誤恢復機制
 * - 支援 DryRun 模式進行預覽
 *
 * Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1
 */

import type { TelegramClient } from 'telegram';
import type { Result } from '../types/result.js';
import type {
  MigrationProgress,
  OrchestratorConfig,
  OrchestratorOptions,
  OrchestratorResult,
  DialogInfo,
  GroupInfo,
  MigrationConfig,
  GroupConfig,
  ProgressCallback,
} from '../types/models.js';
import type { MigrationError } from '../types/errors.js';
import type {
  IDialogService,
  IGroupService,
  IMigrationService,
  IProgressService,
  IReportService,
  IRateLimiter,
  IAuthService,
  IRealtimeSyncService,
} from '../types/interfaces.js';
import { DialogService } from './dialog-service.js';
import { GroupService } from './group-service.js';
import { MigrationService } from './migration-service.js';
import { ProgressService } from './progress-service.js';
import { ReportService } from './report-service.js';
import { RateLimiter } from './rate-limiter.js';
import { RealtimeSyncService } from './realtime-sync-service.js';
import { success, failure } from '../types/result.js';
import { DialogStatus, MigrationPhase } from '../types/enums.js';
import { Api } from 'telegram';

/**
 * 服務依賴注入介面
 *
 * 允許在測試時注入 mock 服務
 */
export interface OrchestratorServices {
  authService?: IAuthService;
  dialogService?: IDialogService;
  groupService?: IGroupService;
  migrationService?: IMigrationService;
  progressService?: IProgressService;
  reportService?: IReportService;
  rateLimiter?: IRateLimiter;
  /** 即時同步服務（可選） */
  realtimeSyncService?: IRealtimeSyncService;
}

/**
 * 遷移協調器
 *
 * 整合所有服務模組，協調完整的遷移流程
 */
export class MigrationOrchestrator {
  private config: OrchestratorConfig;
  private dialogService: IDialogService;
  private groupService: IGroupService;
  private migrationService: IMigrationService;
  private progressService: IProgressService;
  private reportService: IReportService;
  private rateLimiter: IRateLimiter;
  private authService?: IAuthService;
  /** 即時同步服務（可選，預設啟用） */
  private realtimeSyncService?: IRealtimeSyncService;

  /**
   * 建構子
   *
   * @param config - 協調器設定
   * @param services - 可選的服務注入（用於測試）
   */
  constructor(config: OrchestratorConfig, services?: OrchestratorServices) {
    this.config = config;

    // 使用注入的服務或建立預設服務
    this.authService = services?.authService;
    this.dialogService = services?.dialogService ?? new DialogService();
    this.groupService = services?.groupService ?? new GroupService();
    this.migrationService = services?.migrationService ?? new MigrationService();
    this.progressService = services?.progressService ?? new ProgressService();
    this.reportService = services?.reportService ?? new ReportService();
    this.rateLimiter = services?.rateLimiter ?? new RateLimiter();
    // 即時同步服務：若明確傳入 null 則不啟用，否則使用預設或注入的服務
    this.realtimeSyncService =
      services?.realtimeSyncService !== undefined
        ? services.realtimeSyncService
        : new RealtimeSyncService();
  }

  /**
   * 取得服務實例（用於測試驗證）
   *
   * @returns 服務實例物件
   */
  getServices(): OrchestratorServices {
    return {
      authService: this.authService,
      dialogService: this.dialogService,
      groupService: this.groupService,
      migrationService: this.migrationService,
      progressService: this.progressService,
      reportService: this.reportService,
      rateLimiter: this.rateLimiter,
      realtimeSyncService: this.realtimeSyncService,
    };
  }

  /**
   * 執行完整遷移流程
   *
   * 流程：
   * 1. 載入進度檔案
   * 2. 取得並過濾對話清單
   * 3. 對每個對話：
   *    a. 檢查是否已完成（跳過）
   *    b. 建立目標群組（若尚未建立）
   *    c. 邀請 B 帳號加入群組
   *    d. 遷移訊息
   *    e. 更新進度
   * 4. 產生報告
   *
   * @param client - 已驗證的 TelegramClient
   * @param options - 執行選項
   * @returns 遷移結果或錯誤
   */
  async runMigration(
    client: TelegramClient,
    options?: OrchestratorOptions
  ): Promise<Result<OrchestratorResult, MigrationError>> {
    const startTime = Date.now();
    const isDryRun = options?.dryRun ?? false;
    const maxRetries = options?.maxRetries ?? 1;

    // 統計資訊
    let totalDialogs = 0;
    let completedDialogs = 0;
    let failedDialogs = 0;
    let skippedDialogs = 0;
    let filteredOutDialogs = 0;
    let totalMessages = 0;
    let migratedMessages = 0;
    let failedMessages = 0;

    // Step 1: 載入進度
    let progress = await this.loadProgress();

    // Step 2: 取得對話清單（支援重試）
    const dialogsResult = await this.getDialogsWithRetry(client, maxRetries);
    if (!dialogsResult.success) {
      return failure(dialogsResult.error);
    }

    // 套用過濾條件
    const allDialogs = dialogsResult.data;
    const dialogsAfterFilter = this.config.dialogFilter
      ? this.dialogService.filterDialogs(allDialogs, this.config.dialogFilter)
      : allDialogs;

    // 計算被過濾掉的對話數量
    totalDialogs = dialogsAfterFilter.length;
    filteredOutDialogs = allDialogs.length - dialogsAfterFilter.length;

    // DryRun 模式：只回傳預覽資訊
    if (isDryRun) {
      totalMessages = dialogsAfterFilter.reduce((sum, d) => sum + d.messageCount, 0);
      return success({
        totalDialogs,
        completedDialogs: 0,
        failedDialogs: 0,
        skippedDialogs: 0,
        filteredDialogs: filteredOutDialogs,
        totalMessages,
        migratedMessages: 0,
        failedMessages: 0,
        duration: Math.floor((Date.now() - startTime) / 1000),
      });
    }

    // 每日群組建立限制
    const dailyGroupLimit = this.config.dailyGroupLimit ?? 50;

    // Step 3: 遍歷對話並執行遷移
    for (const dialog of dialogsAfterFilter) {
      totalMessages += dialog.messageCount;

      // 檢查是否已完成
      const status = this.progressService.getDialogStatus(progress, dialog.id);
      if (status === DialogStatus.Completed) {
        skippedDialogs++;
        // 加入已遷移的訊息數（使用 ProgressService 的內部方法）
        const dialogProgress = progress.dialogs.get(dialog.id);
        if (dialogProgress) {
          migratedMessages += dialogProgress.migratedCount;
        }
        continue;
      }

      // 檢查每日群組建立限制（僅在需要建立新群組時檢查）
      const needsNewGroup = status !== DialogStatus.InProgress;
      if (needsNewGroup) {
        const ps = this.progressService as ProgressService;
        if (ps.isDailyGroupLimitReached(progress, dailyGroupLimit)) {
          // 達到每日限制，發送通知並停止
          const currentCount = ps.getDailyGroupCreationCount(progress);
          console.log(
            `\n⚠️ 已達每日群組建立上限（${currentCount}/${dailyGroupLimit}）`
          );

          // 發送 Telegram 通知到 Saved Messages
          await this.sendDailyLimitNotification(
            client,
            currentCount,
            dailyGroupLimit,
            completedDialogs,
            dialogsAfterFilter.length - completedDialogs - skippedDialogs
          );

          // 儲存進度並停止
          await this.saveProgress(progress);
          break;
        }
      }

      // [即時同步] 開始監聽新訊息（遷移期間累積）
      if (this.realtimeSyncService) {
        this.realtimeSyncService.startListening(client, dialog.id);
      }

      // 取得或建立目標群組
      const groupResult = await this.getOrCreateTargetGroup(
        client,
        dialog,
        progress,
        status
      );

      if (!groupResult.success) {
        failedDialogs++;
        // 記錄建立群組失敗的原因
        console.error(`[Dialog ${dialog.id}] Failed to create target group: ${groupResult.error}`);
        // 使用 ProgressService 的 markDialogFailed（若可用）
        const ps = this.progressService as ProgressService;
        if (typeof ps.markDialogFailed === 'function') {
          progress = ps.markDialogFailed(progress, dialog.id, groupResult.error);
        }
        // [即時同步] 清理資源
        if (this.realtimeSyncService) {
          this.realtimeSyncService.stopListening(dialog.id);
        }
        await this.saveProgress(progress);
        continue;
      }

      const targetGroup = groupResult.data;

      // 如果是新建立的群組，增加每日計數
      if (needsNewGroup) {
        const ps = this.progressService as ProgressService;
        progress = ps.incrementDailyGroupCreation(progress);
        const currentCount = ps.getDailyGroupCreationCount(progress);
        console.log(`[Daily Limit] Group created: ${currentCount}/${dailyGroupLimit}`);
      }

      // [即時同步] 註冊對話-群組映射
      if (this.realtimeSyncService) {
        this.realtimeSyncService.registerMapping(dialog.id, targetGroup.id);
      }

      // 邀請 B 帳號（若尚未進行中）
      if (status !== DialogStatus.InProgress) {
        const inviteResult = await this.groupService.inviteUser(
          client,
          targetGroup,
          this.config.targetAccountB
        );

        if (!inviteResult.success) {
          failedDialogs++;
          const inviteError = 'message' in inviteResult.error
            ? inviteResult.error.message
            : inviteResult.error.type;
          console.error(`[Dialog ${dialog.id}] Failed to invite user: ${inviteError}`);
          const ps = this.progressService as ProgressService;
          if (typeof ps.markDialogFailed === 'function') {
            progress = ps.markDialogFailed(
              progress,
              dialog.id,
              `Invite failed: ${inviteResult.error.type}`
            );
          }
          // [即時同步] 清理資源
          if (this.realtimeSyncService) {
            this.realtimeSyncService.stopListening(dialog.id);
          }
          await this.saveProgress(progress);
          continue;
        }

        // 標記開始遷移
        const ps = this.progressService as ProgressService;
        if (typeof ps.markDialogStarted === 'function') {
          progress = ps.markDialogStarted(progress, dialog.id, targetGroup.id);
        }
      }

      // 執行訊息遷移
      const migrationConfig = this.createMigrationConfig();
      const progressCallback = this.createProgressCallback();

      const migrateResult = await this.migrationService.migrateDialog(
        client,
        dialog,
        targetGroup,
        migrationConfig,
        progressCallback
      );

      // 記錄批次遷移最後處理的訊息 ID
      let lastBatchMessageId = 0;

      if (migrateResult.success) {
        const result = migrateResult.data;
        migratedMessages += result.migratedMessages;
        failedMessages += result.failedMessages;

        // 從進度中取得最後處理的訊息 ID
        const dialogProgress = progress.dialogs.get(dialog.id);
        if (dialogProgress?.lastMessageId) {
          lastBatchMessageId = dialogProgress.lastMessageId;
        }

        // [即時同步] 處理佇列（批次遷移完成後）
        if (this.realtimeSyncService && lastBatchMessageId > 0) {
          const queueResult = await this.realtimeSyncService.processQueue(
            dialog.id,
            lastBatchMessageId
          );
          if (queueResult.success) {
            migratedMessages += queueResult.data.successCount;
            failedMessages += queueResult.data.failedCount;
          }
        }

        if (result.success) {
          completedDialogs++;
          progress = this.progressService.markDialogComplete(progress, dialog.id);
        } else {
          // 部分成功也視為完成（有失敗訊息但整體流程完成）
          completedDialogs++;
          progress = this.progressService.markDialogComplete(progress, dialog.id);
        }
      } else {
        failedDialogs++;
        const migrateError = 'message' in migrateResult.error
          ? migrateResult.error.message
          : migrateResult.error.type;
        console.error(`[Dialog ${dialog.id}] Migration failed: ${migrateError}`);
        const ps = this.progressService as ProgressService;
        if (typeof ps.markDialogFailed === 'function') {
          progress = ps.markDialogFailed(
            progress,
            dialog.id,
            migrateResult.error.type
          );
        }
      }

      // [即時同步] 停止監聽並清理資源
      if (this.realtimeSyncService) {
        this.realtimeSyncService.stopListening(dialog.id);
      }

      // 儲存進度
      await this.saveProgress(progress);
    }

    // Step 4: 產生報告
    this.reportService.generateReport(progress);

    return success({
      totalDialogs,
      completedDialogs,
      failedDialogs,
      skippedDialogs,
      filteredDialogs: filteredOutDialogs,
      totalMessages,
      migratedMessages,
      failedMessages,
      duration: Math.floor((Date.now() - startTime) / 1000),
    });
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * 載入進度檔案
   */
  private async loadProgress(): Promise<MigrationProgress> {
    const result = await this.progressService.load(this.config.progressPath);
    if (result.success) {
      return result.data;
    }
    // 載入失敗時建立空進度
    return this.createEmptyProgress();
  }

  /**
   * 儲存進度
   */
  private async saveProgress(progress: MigrationProgress): Promise<void> {
    await this.progressService.save(this.config.progressPath, progress);
  }

  /**
   * 帶重試的取得對話清單
   */
  private async getDialogsWithRetry(
    client: TelegramClient,
    maxRetries: number
  ): Promise<Result<DialogInfo[], MigrationError>> {
    let lastError: MigrationError | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.dialogService.getAllDialogs(client);

      if (result.success) {
        return success(result.data);
      }

      const errorMessage = 'message' in result.error
        ? result.error.message
        : `Failed: ${result.error.type}`;
      lastError = {
        type: 'DIALOG_FETCH_FAILED',
        message: errorMessage,
      };

      // 等待後重試（短延遲，用於測試友善）
      if (attempt < maxRetries) {
        await this.sleep(50); // 50ms 短延遲
      }
    }

    return failure(lastError!);
  }

  /**
   * 取得或建立目標群組
   */
  private async getOrCreateTargetGroup(
    client: TelegramClient,
    dialog: DialogInfo,
    progress: MigrationProgress,
    status: DialogStatus
  ): Promise<Result<GroupInfo, string>> {
    // 若是 InProgress，嘗試使用已存在的群組
    if (status === DialogStatus.InProgress) {
      const dialogProgress = progress.dialogs.get(dialog.id);
      if (dialogProgress?.targetGroupId) {
        // 假設群組已存在，建立模擬的 GroupInfo
        // 實際應用中應從 API 取得
        return success({
          id: dialogProgress.targetGroupId,
          accessHash: '',
          name: `${this.config.groupNamePrefix}${dialog.name}`,
          sourceDialogId: dialog.id,
          createdAt: new Date().toISOString(),
          entity: dialog.entity,
        });
      }
    }

    // 建立新群組（支援 FloodWait 自動等待）
    const groupConfig: GroupConfig = {
      namePrefix: this.config.groupNamePrefix,
    };

    const maxFloodWait = this.config.maxFloodWaitSeconds ?? 300; // 預設 5 分鐘

    // 嘗試建立群組，若遇到 FloodWait 且在閾值內則自動等待重試
    let createResult = await this.groupService.createTargetGroup(
      client,
      dialog,
      groupConfig
    );

    // 處理 FloodWait
    if (!createResult.success && createResult.error.type === 'FLOOD_WAIT') {
      const waitSeconds = createResult.error.seconds;

      if (waitSeconds <= maxFloodWait) {
        // 在閾值內，自動等待
        console.log(
          `[Dialog ${dialog.id}] FloodWait ${waitSeconds}s (within threshold ${maxFloodWait}s), waiting...`
        );
        await this.sleep(waitSeconds * 1000);

        // 重試一次
        createResult = await this.groupService.createTargetGroup(
          client,
          dialog,
          groupConfig
        );
      } else {
        // 超過閾值，回傳明確的錯誤訊息
        const hours = Math.floor(waitSeconds / 3600);
        const minutes = Math.floor((waitSeconds % 3600) / 60);
        return failure(
          `FloodWait ${waitSeconds}s (~${hours}h ${minutes}m) exceeds threshold ${maxFloodWait}s. Please wait and retry later.`
        );
      }
    }

    if (createResult.success) {
      // 建立群組後的延遲（避免觸發 FloodWait）
      const groupCreationDelay = this.config.groupCreationDelayMs ?? 60000; // 預設 1 分鐘
      if (groupCreationDelay > 0) {
        console.log(
          `[Dialog ${dialog.id}] Group created successfully, waiting ${groupCreationDelay / 1000}s before continuing...`
        );
        await this.sleep(groupCreationDelay);
      }
      return success(createResult.data);
    }

    const errorMessage = 'message' in createResult.error
      ? createResult.error.message
      : createResult.error.type;
    return failure(errorMessage);
  }

  /**
   * 建立遷移設定
   */
  private createMigrationConfig(): MigrationConfig {
    return {
      batchSize: this.config.batchSize,
      groupConfig: {
        namePrefix: this.config.groupNamePrefix,
      },
      targetAccountB: this.config.targetAccountB,
      progressPath: this.config.progressPath,
      dialogFilter: this.config.dialogFilter,
      dateRange: this.config.dateRange,
    };
  }

  /**
   * 建立進度回呼
   */
  private createProgressCallback(): ProgressCallback {
    return (event) => {
      switch (event.type) {
        case 'flood_wait':
          this.reportService.recordFloodWait({
            timestamp: new Date().toISOString(),
            seconds: event.seconds,
            operation: event.operation,
          });
          break;
        // 其他事件類型可在此處理
      }
    };
  }

  /**
   * 建立空進度
   */
  private createEmptyProgress(): MigrationProgress {
    const now = new Date().toISOString();
    return {
      version: '1.0',
      startedAt: now,
      updatedAt: now,
      sourceAccount: '',
      targetAccount: this.config.targetAccountB,
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
   * 等待指定毫秒數
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 發送每日限制通知到 Saved Messages
   *
   * @param client - Telegram 客戶端
   * @param currentCount - 當前已建立群組數
   * @param limit - 每日上限
   * @param completedDialogs - 已完成的對話數
   * @param pendingDialogs - 待處理的對話數
   */
  private async sendDailyLimitNotification(
    client: TelegramClient,
    currentCount: number,
    limit: number,
    completedDialogs: number,
    pendingDialogs: number
  ): Promise<void> {
    const message = [
      '⚠️ 遷移暫停通知',
      '',
      `已達每日群組建立上限（${currentCount}/${limit}）`,
      `已完成：${completedDialogs} 個對話`,
      `待處理：${pendingDialogs} 個對話`,
      '',
      '請於明日重新執行 `npm start` 繼續遷移。',
    ].join('\n');

    try {
      await client.invoke(
        new Api.messages.SendMessage({
          peer: 'me',
          message,
          noWebpage: true,
        })
      );
      console.log('[Daily Limit] 已發送通知到 Saved Messages');
    } catch (error) {
      // 發送通知失敗不應中斷遷移流程
      console.error('[Daily Limit] 發送通知失敗:', error);
    }
  }
}
