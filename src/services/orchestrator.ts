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
 * FloodWait 最大等待秒數
 *
 * 超過此閾值將標記對話為 PartiallyMigrated 並停止遷移
 * 與 GramJS floodSleepThreshold 保持一致
 */
const MAX_FLOOD_WAIT_SECONDS = 300; // 5 分鐘

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

  /** 當前遷移進度（用於即時保存） */
  private currentProgress: MigrationProgress | null = null;
  /** 是否正在關閉中 */
  private isShuttingDown: boolean = false;

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
   * 請求關閉遷移流程
   *
   * 設置關閉標誌，讓遷移迴圈在安全點停止
   */
  requestShutdown(): void {
    this.isShuttingDown = true;
    console.log('\n[Orchestrator] 收到關閉請求，將在當前批次完成後停止...');
  }

  /**
   * 立即保存當前進度
   *
   * 用於 Ctrl+C 等中斷時保存進度
   *
   * @returns 是否成功保存
   */
  async saveCurrentProgress(): Promise<boolean> {
    if (!this.currentProgress) {
      console.log('[Orchestrator] 沒有進度需要保存');
      return false;
    }

    try {
      await this.saveProgress(this.currentProgress);
      console.log(`[Orchestrator] 進度已保存到 ${this.config.progressPath}`);
      return true;
    } catch (error) {
      console.error('[Orchestrator] 保存進度失敗:', error);
      return false;
    }
  }

  /**
   * 檢查是否正在關閉中
   */
  isShutdownRequested(): boolean {
    return this.isShuttingDown;
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

    // 重置關閉狀態
    this.isShuttingDown = false;

    // Step 1: 載入進度
    let progress = await this.loadProgress();
    this.currentProgress = progress; // 保存引用以便中斷時保存

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
      // 檢查是否收到關閉請求
      if (this.isShuttingDown) {
        console.log('\n[Orchestrator] 收到關閉請求，停止遷移迴圈');
        break;
      }

      totalMessages += dialog.messageCount;

      // 檢查是否已完成
      let status = this.progressService.getDialogStatus(progress, dialog.id);

      // 如果對話尚未初始化，先初始化
      if (status === DialogStatus.Pending && !progress.dialogs.has(dialog.id)) {
        const ps = this.progressService as ProgressService;
        progress = ps.initializeDialog(progress, {
          dialogId: dialog.id,
          dialogName: dialog.name,
          dialogType: dialog.type,
          totalCount: dialog.messageCount,
        });
        this.currentProgress = progress;
        console.log(`[Dialog ${dialog.id}] 初始化對話進度: ${dialog.name} (${dialog.messageCount} 則訊息)`);
      }

      if (status === DialogStatus.Completed) {
        skippedDialogs++;
        // 加入已遷移的訊息數（使用 ProgressService 的內部方法）
        const dialogProgress = progress.dialogs.get(dialog.id);
        if (dialogProgress) {
          migratedMessages += dialogProgress.migratedCount;
        }
        continue;
      }

      // 檢查是否為部分遷移狀態（需要從斷點恢復）
      let resumeFromMessageId: number | undefined = undefined;
      if (status === DialogStatus.PartiallyMigrated || status === DialogStatus.InProgress) {
        const resumePoint = (this.progressService as ProgressService).getResumePoint(
          progress,
          dialog.id
        );
        if (resumePoint) {
          resumeFromMessageId = resumePoint.lastMessageId;
          migratedMessages += resumePoint.migratedCount;
          console.log(
            `[Dialog ${dialog.id}] 從部分遷移狀態恢復，已遷移 ${resumePoint.migratedCount} 則，從訊息 ID ${resumeFromMessageId} 繼續`
          );
        }
      }

      // 檢查每日群組建立限制（僅在需要建立新群組時檢查）
      // InProgress 或 PartiallyMigrated 狀態的對話已有目標群組
      const needsNewGroup = status !== DialogStatus.InProgress && status !== DialogStatus.PartiallyMigrated;
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

      // 如果是新建立的群組，立即保存 targetGroupId（確保中斷時可恢復）
      if (needsNewGroup) {
        const ps = this.progressService as ProgressService;
        // 增加每日計數
        progress = ps.incrementDailyGroupCreation(progress);
        const currentCount = ps.getDailyGroupCreationCount(progress);
        console.log(`[Daily Limit] Group created: ${currentCount}/${dailyGroupLimit}`);

        // 立即保存 targetGroupId，設定狀態為 InProgress
        // 這確保即使在邀請用戶前中斷，下次執行也能使用同一群組
        if (typeof ps.markDialogStarted === 'function') {
          progress = ps.markDialogStarted(progress, dialog.id, targetGroup.id);
          this.currentProgress = progress;
          await this.saveProgress(progress);
          console.log(`[Dialog ${dialog.id}] Target group saved: ${targetGroup.id}`);
        }
      }

      // [即時同步] 註冊對話-群組映射
      if (this.realtimeSyncService) {
        this.realtimeSyncService.registerMapping(dialog.id, targetGroup.id);
      }

      // 邀請 B 帳號
      // needsNewGroup 為 true 時需要邀請（已在上方保存 targetGroupId）
      // InProgress 或 PartiallyMigrated 狀態表示已完成邀請，跳過
      const originalStatus = status; // 保存原始狀態以判斷是否需要邀請
      if (originalStatus !== DialogStatus.InProgress && originalStatus !== DialogStatus.PartiallyMigrated) {
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

        // 如果不是新群組（恢復的舊群組但狀態不是 InProgress），標記開始遷移
        // needsNewGroup 為 true 時已在上方呼叫 markDialogStarted
        if (!needsNewGroup) {
          const ps = this.progressService as ProgressService;
          if (typeof ps.markDialogStarted === 'function') {
            progress = ps.markDialogStarted(progress, dialog.id, targetGroup.id);
            this.currentProgress = progress;
            await this.saveProgress(progress);
          }
        }
      }

      // 檢查是否收到關閉請求（在開始遷移前再次檢查）
      if (this.isShuttingDown) {
        console.log('\n[Orchestrator] 收到關閉請求，在遷移對話前停止');
        break;
      }

      // 執行訊息遷移
      const migrationConfig = this.createMigrationConfig();

      // 建立進度回呼，在每個批次完成後更新進度並保存
      const progressCallback: ProgressCallback = async (event) => {
        switch (event.type) {
          case 'batch_completed':
            // 每批次完成後更新進度
            if (event.dialogId && event.count !== undefined && event.lastMessageId) {
              const ps = this.progressService as ProgressService;
              // 計算本批次的訊息數（使用累計值的差）
              const existingProgress = progress.dialogs.get(event.dialogId);
              const previousCount = existingProgress?.migratedCount ?? 0;
              const batchCount = event.count - previousCount;

              if (batchCount > 0) {
                // 使用 batch_completed 事件中的 lastMessageId 更新進度
                progress = ps.updateMessageProgress(
                  progress,
                  event.dialogId,
                  event.lastMessageId,
                  batchCount
                );
                this.currentProgress = progress;
                // 即時保存進度，確保 Ctrl+C 時有最新狀態
                await this.saveProgress(progress);
              }
            }
            break;
          case 'flood_wait':
            this.reportService.recordFloodWait({
              timestamp: new Date().toISOString(),
              seconds: event.seconds,
              operation: event.operation,
            });
            break;
        }
      };

      const migrateResult = await this.migrationService.migrateDialog(
        client,
        dialog,
        targetGroup,
        migrationConfig,
        progressCallback,
        resumeFromMessageId
      );

      // 記錄批次遷移最後處理的訊息 ID
      let lastBatchMessageId = 0;
      let shouldStopMigration = false;

      if (migrateResult.success) {
        const result = migrateResult.data;
        migratedMessages += result.migratedMessages;
        failedMessages += result.failedMessages;

        // 從進度中取得最後處理的訊息 ID
        const dialogProgress = progress.dialogs.get(dialog.id);
        if (dialogProgress?.lastMessageId) {
          lastBatchMessageId = dialogProgress.lastMessageId;
        }

        // ====================================================================
        // FloodWait 處理邏輯
        // ====================================================================
        if (result.error?.type === 'FLOOD_WAIT' && result.error.floodWaitSeconds) {
          const waitSeconds = result.error.floodWaitSeconds;
          const lastMigratedId = result.lastMigratedMessageId;

          console.log(
            `\n⏳ [FloodWait] 遇到限流，需等待 ${waitSeconds} 秒`
          );

          if (waitSeconds <= MAX_FLOOD_WAIT_SECONDS) {
            // 在閾值內：暫停整個流程，等待後重試當前對話
            console.log(
              `[FloodWait] 等待時間在閾值內（${waitSeconds}s <= ${MAX_FLOOD_WAIT_SECONDS}s）`
            );

            // 先保存部分進度
            const ps = this.progressService as ProgressService;
            if (typeof ps.markDialogPartiallyMigrated === 'function') {
              progress = ps.markDialogPartiallyMigrated(
                progress,
                dialog.id,
                lastMigratedId ?? null,
                waitSeconds
              );
              await this.saveProgress(progress);
            }

            // 顯示倒數計時
            await this.displayCountdown(waitSeconds);

            // 等待結束後，重新嘗試當前對話
            // 透過更新 resumeFromMessageId 並重新執行遷移
            console.log(`[FloodWait] 等待結束，從訊息 ID ${lastMigratedId ?? 'start'} 繼續遷移`);

            // 重新執行遷移（從上次中斷點繼續）
            const retryResult = await this.migrationService.migrateDialog(
              client,
              dialog,
              targetGroup,
              migrationConfig,
              progressCallback,
              lastMigratedId
            );

            // 處理重試結果
            if (retryResult.success) {
              const retryData = retryResult.data;
              migratedMessages += retryData.migratedMessages;
              failedMessages += retryData.failedMessages;

              if (retryData.success) {
                completedDialogs++;
                progress = this.progressService.markDialogComplete(progress, dialog.id);
                console.log(`[Dialog ${dialog.id}] 重試成功，遷移完成`);
              } else if (retryData.error?.type === 'FLOOD_WAIT') {
                // 再次遇到 FloodWait，標記為部分遷移並停止
                const ps = this.progressService as ProgressService;
                if (typeof ps.markDialogPartiallyMigrated === 'function') {
                  progress = ps.markDialogPartiallyMigrated(
                    progress,
                    dialog.id,
                    retryData.lastMigratedMessageId ?? null,
                    retryData.error.floodWaitSeconds
                  );
                }
                shouldStopMigration = true;
                console.log(
                  `\n🛑 [FloodWait] 連續遇到限流，標記為部分遷移並停止`
                );
                await this.sendFloodWaitNotification(
                  client,
                  retryData.error.floodWaitSeconds ?? 0,
                  completedDialogs,
                  dialogsAfterFilter.length - completedDialogs - skippedDialogs
                );
              } else {
                completedDialogs++;
                progress = this.progressService.markDialogComplete(progress, dialog.id);
              }
            } else {
              failedDialogs++;
              console.error(`[Dialog ${dialog.id}] 重試失敗`);
            }
          } else {
            // 超過閾值：標記為部分遷移並停止整個流程
            const hours = Math.floor(waitSeconds / 3600);
            const minutes = Math.floor((waitSeconds % 3600) / 60);
            console.log(
              `\n🛑 [FloodWait] 等待時間超過閾值（${waitSeconds}s > ${MAX_FLOOD_WAIT_SECONDS}s）`
            );
            console.log(
              `需等待約 ${hours}h ${minutes}m，建議稍後重新執行`
            );

            // 標記為部分遷移
            const ps = this.progressService as ProgressService;
            if (typeof ps.markDialogPartiallyMigrated === 'function') {
              progress = ps.markDialogPartiallyMigrated(
                progress,
                dialog.id,
                lastMigratedId ?? null,
                waitSeconds
              );
            }

            // 發送通知
            await this.sendFloodWaitNotification(
              client,
              waitSeconds,
              completedDialogs,
              dialogsAfterFilter.length - completedDialogs - skippedDialogs
            );

            shouldStopMigration = true;
          }
        } else {
          // ====================================================================
          // 正常完成邏輯（無 FloodWait）
          // ====================================================================
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
        }
      } else {
        // ====================================================================
        // 遷移失敗處理
        // ====================================================================
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

      // [即時同步] 停止監聯並清理資源
      if (this.realtimeSyncService) {
        this.realtimeSyncService.stopListening(dialog.id);
      }

      // 儲存進度並更新 currentProgress 引用
      this.currentProgress = progress;
      await this.saveProgress(progress);

      // 如果需要停止遷移（FloodWait 超過閾值或連續限流）
      if (shouldStopMigration) {
        console.log('\n⏸️ 遷移已暫停，進度已保存。請稍後重新執行 npm start 繼續。');
        break;
      }
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
    console.log(`[Progress] Loading from: ${this.config.progressPath}`);
    const result = await this.progressService.load(this.config.progressPath);
    if (result.success) {
      const progress = result.data;
      // 顯示已載入的進度摘要
      const completedCount = Array.from(progress.dialogs.values()).filter(
        d => d.status === DialogStatus.Completed
      ).length;
      const inProgressCount = Array.from(progress.dialogs.values()).filter(
        d => d.status === DialogStatus.InProgress || d.status === DialogStatus.PartiallyMigrated
      ).length;
      console.log(`[Progress] Loaded successfully:`);
      console.log(`  - Total dialogs tracked: ${progress.dialogs.size}`);
      console.log(`  - Completed: ${completedCount}`);
      console.log(`  - In progress/Partial: ${inProgressCount}`);
      return progress;
    }
    // 載入失敗時建立空進度
    console.log(`[Progress] No existing progress found, starting fresh`);
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
    // 若是 InProgress 或 PartiallyMigrated，嘗試使用已存在的群組
    if (status === DialogStatus.InProgress || status === DialogStatus.PartiallyMigrated) {
      const dialogProgress = progress.dialogs.get(dialog.id);
      if (dialogProgress?.targetGroupId) {
        // 從 Telegram API 取得目標群組的 entity
        try {
          const targetGroupId = dialogProgress.targetGroupId;
          // targetGroupId 是 channel ID（正數字串，如 "1234567890"）
          // 對於 supergroup/channel，peer ID 格式是 -100{channelId}
          // 例如 channelId=1234567890 -> peerId=-1001234567890
          const channelId = targetGroupId.replace(/^-/, ''); // 移除可能的負號
          const peerId = `-100${channelId}`;

          console.log(`[Dialog ${dialog.id}] 嘗試取得目標群組 entity: channelId=${channelId}, peerId=${peerId}`);

          // 使用 peerId 字串直接呼叫 getEntity（GramJS 支援數字字串）
          const targetEntity = await client.getEntity(peerId);

          console.log(`[Dialog ${dialog.id}] 成功從進度恢復目標群組: ${targetGroupId}`);

          return success({
            id: targetGroupId,
            accessHash: '',
            name: `${this.config.groupNamePrefix}${dialog.name}`,
            sourceDialogId: dialog.id,
            createdAt: new Date().toISOString(),
            entity: targetEntity,
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`[Dialog ${dialog.id}] 無法取得目標群組 entity: ${errorMsg}`);
          // 如果無法取得目標群組，則建立新群組
          console.log(`[Dialog ${dialog.id}] 將建立新群組...`);
        }
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
   * 顯示 FloodWait 倒數計時
   *
   * @param seconds - 等待秒數
   */
  private async displayCountdown(seconds: number): Promise<void> {
    console.log(`\n⏳ FloodWait 倒數計時：`);

    for (let remaining = seconds; remaining > 0; remaining--) {
      // 每 10 秒顯示一次，或在最後 10 秒內每秒顯示
      if (remaining <= 10 || remaining % 10 === 0) {
        const minutes = Math.floor(remaining / 60);
        const secs = remaining % 60;
        const timeStr = minutes > 0
          ? `${minutes}m ${secs}s`
          : `${secs}s`;
        process.stdout.write(`\r   剩餘 ${timeStr}...     `);
      }
      await this.sleep(1000);
    }

    process.stdout.write(`\r   等待完成！          \n`);
  }

  /**
   * 發送 FloodWait 通知到 Saved Messages
   *
   * @param client - Telegram 客戶端
   * @param waitSeconds - 需等待的秒數
   * @param completedDialogs - 已完成的對話數
   * @param pendingDialogs - 待處理的對話數
   */
  private async sendFloodWaitNotification(
    client: TelegramClient,
    waitSeconds: number,
    completedDialogs: number,
    pendingDialogs: number
  ): Promise<void> {
    const hours = Math.floor(waitSeconds / 3600);
    const minutes = Math.floor((waitSeconds % 3600) / 60);
    const timeStr = hours > 0
      ? `${hours} 小時 ${minutes} 分鐘`
      : `${minutes} 分鐘`;

    const message = [
      '⏸️ 遷移暫停通知',
      '',
      `遇到 Telegram 限流（FloodWait），需等待約 ${timeStr}`,
      `已完成：${completedDialogs} 個對話`,
      `待處理：${pendingDialogs} 個對話`,
      '',
      '進度已保存，請稍後重新執行 `npm start` 繼續遷移。',
      '（將從中斷點自動恢復）',
    ].join('\n');

    try {
      await client.invoke(
        new Api.messages.SendMessage({
          peer: 'me',
          message,
          noWebpage: true,
        })
      );
      console.log('[FloodWait] 已發送通知到 Saved Messages');
    } catch (error) {
      // 發送通知失敗不應中斷遷移流程
      console.error('[FloodWait] 發送通知失敗:', error);
    }
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
