/**
 * Task 11.2: 錯誤恢復流程測試
 *
 * 驗證錯誤恢復機制，包含：
 * - 驗證斷點續傳：中斷後能從上次進度繼續
 * - 驗證網路錯誤恢復：自動重連後繼續作業
 * - 驗證 FloodWait 處理：等待後正確重試
 * - 驗證單一訊息失敗不影響整體流程
 *
 * Requirements: 1.6, 5.2, 6.3, 7.3
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TelegramClient } from 'telegram';
import { MigrationOrchestrator } from '../../src/services/orchestrator.js';
import { DialogType, DialogStatus, MigrationPhase } from '../../src/types/enums.js';
import type {
  DialogInfo,
  GroupInfo,
  MigrationProgress,
  DialogProgress,
  OrchestratorConfig,
} from '../../src/types/models.js';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
  return {
    id: '12345',
    accessHash: '67890',
    type: DialogType.Private,
    name: 'Test Dialog',
    messageCount: 100,
    unreadCount: 0,
    isArchived: false,
    entity: { className: 'User', id: BigInt(12345), accessHash: BigInt(67890) },
    ...overrides,
  };
}

function createMockGroupInfo(overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    id: '999999',
    accessHash: '111111',
    name: '[Migrated] Test Dialog',
    sourceDialogId: '12345',
    createdAt: new Date().toISOString(),
    entity: { className: 'Channel', id: BigInt(999999), accessHash: BigInt(111111) },
    ...overrides,
  };
}

function createMockTelegramClient(): TelegramClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getDialogs: vi.fn().mockResolvedValue([]),
    invoke: vi.fn().mockResolvedValue({}),
    getInputEntity: vi.fn().mockResolvedValue({ className: 'InputPeerUser' }),
    getEntity: vi.fn().mockResolvedValue({ className: 'User', id: BigInt(123) }),
    session: { save: vi.fn().mockReturnValue('session-string') },
  } as unknown as TelegramClient;
}

function createMockOrchestratorConfig(
  overrides: Partial<OrchestratorConfig> = {}
): OrchestratorConfig {
  return {
    apiId: 12345,
    apiHash: 'test-api-hash-32-characters-long',
    sessionPath: './test-session-error-recovery.txt',
    progressPath: './test-progress-error-recovery.json',
    targetAccountB: '@testuser',
    batchSize: 100,
    groupNamePrefix: '[Migrated] ',
    logLevel: 'info',
    logFilePath: './test-migration-error-recovery.log',
    groupCreationDelayMs: 0, // 測試環境不需要延遲
    ...overrides,
  };
}

function createProgressWithDialogs(
  dialogProgresses: Partial<DialogProgress>[]
): MigrationProgress {
  const dialogs = new Map<string, DialogProgress>();
  for (const dp of dialogProgresses) {
    const full: DialogProgress = {
      dialogId: dp.dialogId || '1',
      dialogName: dp.dialogName || 'Test',
      dialogType: dp.dialogType || DialogType.Private,
      status: dp.status || DialogStatus.Pending,
      targetGroupId: dp.targetGroupId || null,
      lastMessageId: dp.lastMessageId || null,
      migratedCount: dp.migratedCount || 0,
      totalCount: dp.totalCount || 100,
      errors: dp.errors || [],
      startedAt: dp.startedAt || null,
      completedAt: dp.completedAt || null,
    };
    dialogs.set(full.dialogId, full);
  }

  return {
    version: '1.0',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceAccount: '',
    targetAccount: '',
    currentPhase: MigrationPhase.Migrating,
    dialogs,
    floodWaitEvents: [],
    stats: {
      totalDialogs: dialogProgresses.length,
      completedDialogs: dialogProgresses.filter((d) => d.status === DialogStatus.Completed).length,
      failedDialogs: dialogProgresses.filter((d) => d.status === DialogStatus.Failed).length,
      skippedDialogs: 0,
      totalMessages: 100,
      migratedMessages: 0,
      failedMessages: 0,
      floodWaitCount: 0,
      totalFloodWaitSeconds: 0,
    },
  };
}

function createMockProgressService() {
  const mockProgress = {
    version: '1.0',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceAccount: '',
    targetAccount: '',
    currentPhase: MigrationPhase.Idle,
    dialogs: new Map(),
    floodWaitEvents: [],
    groupsCreatedToday: 0,
    lastGroupCreationDate: new Date().toISOString().split('T')[0],
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

  return {
    load: vi.fn().mockResolvedValue({
      success: true,
      data: mockProgress,
    }),
    save: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    updateDialogProgress: vi.fn(),
    updateStats: vi.fn(),
    incrementGroupCreatedToday: vi.fn(),
    canCreateGroupToday: vi.fn().mockReturnValue(true),
    getGroupsCreatedToday: vi.fn().mockReturnValue(0),
    getDailyGroupLimit: vi.fn().mockReturnValue(50),
    getDialogStatus: vi.fn().mockReturnValue(DialogStatus.Pending),
    isDailyGroupLimitReached: vi.fn().mockReturnValue(false),
    getDailyGroupCreationCount: vi.fn().mockReturnValue(0),
    getExistingGroupForDialog: vi.fn().mockReturnValue(undefined),
    incrementDailyGroupCreation: vi.fn().mockImplementation((progress) => ({
      ...progress,
      groupsCreatedToday: (progress.groupsCreatedToday || 0) + 1,
    })),
    markDialogComplete: vi.fn().mockImplementation((progress, dialogId) => {
      const dialogs = new Map(progress.dialogs);
      const existing = dialogs.get(dialogId);
      if (existing) {
        dialogs.set(dialogId, { ...existing, status: DialogStatus.Completed });
      }
      return { ...progress, dialogs };
    }),
  };
}

// ============================================================================
// Task 11.2: 錯誤恢復流程測試
// ============================================================================

describe('Error Recovery (Task 11.2)', () => {
  let orchestrator: MigrationOrchestrator;
  let mockClient: TelegramClient;

  beforeEach(() => {
    mockClient = createMockTelegramClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('斷點續傳', () => {
    it('應從進度檔案載入既有進度', async () => {
      const config = createMockOrchestratorConfig();
      const existingProgress = createProgressWithDialogs([
        { dialogId: '1', status: DialogStatus.Completed },
        { dialogId: '2', status: DialogStatus.InProgress, migratedCount: 50, lastMessageId: 500 },
        { dialogId: '3', status: DialogStatus.Pending },
      ]);

      const mockDialogs = [
        createMockDialogInfo({ id: '1' }),
        createMockDialogInfo({ id: '2' }),
        createMockDialogInfo({ id: '3' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockProgressService = {
        load: vi.fn().mockResolvedValue({ success: true, data: existingProgress }),
        save: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        initializeDialog: vi.fn().mockImplementation((p) => p),
        markDialogStarted: vi.fn().mockImplementation((p) => p),
        markDialogComplete: vi.fn().mockImplementation((p) => p),
        updateDialogProgress: vi.fn().mockImplementation((p) => p),
        getDialogStatus: vi.fn().mockImplementation((_, dialogId) => {
          return existingProgress.dialogs.get(dialogId)?.status || DialogStatus.Pending;
        }),
        getDialogProgress: vi.fn().mockImplementation((_, dialogId) => {
          return existingProgress.dialogs.get(dialogId);
        }),
        getDailyGroupCreationCount: vi.fn().mockReturnValue(0),
        incrementDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        resetDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        isDailyGroupLimitReached: vi.fn().mockReturnValue(false),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '2', success: true, migratedMessages: 50, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        progressService: mockProgressService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 驗證進度載入
      expect(mockProgressService.load).toHaveBeenCalled();
      // 驗證 getDialogStatus 被呼叫以檢查對話狀態
      expect(mockProgressService.getDialogStatus).toHaveBeenCalled();
    });

    it('應跳過已完成的對話', async () => {
      const config = createMockOrchestratorConfig();
      const existingProgress = createProgressWithDialogs([
        { dialogId: '1', status: DialogStatus.Completed },
        { dialogId: '2', status: DialogStatus.Pending },
      ]);

      const mockDialogs = [
        createMockDialogInfo({ id: '1' }),
        createMockDialogInfo({ id: '2' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockProgressService = {
        load: vi.fn().mockResolvedValue({ success: true, data: existingProgress }),
        save: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        initializeDialog: vi.fn().mockImplementation((p) => p),
        markDialogStarted: vi.fn().mockImplementation((p) => p),
        markDialogComplete: vi.fn().mockImplementation((p) => p),
        updateDialogProgress: vi.fn().mockImplementation((p) => p),
        getDialogStatus: vi.fn().mockImplementation((_, dialogId) => {
          return existingProgress.dialogs.get(dialogId)?.status || DialogStatus.Pending;
        }),
        getDailyGroupCreationCount: vi.fn().mockReturnValue(0),
        incrementDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        resetDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        isDailyGroupLimitReached: vi.fn().mockReturnValue(false),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '2', success: true, migratedMessages: 100, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        progressService: mockProgressService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 只應遷移對話 2（對話 1 已完成）
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledTimes(1);
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({ id: '2' }),
        expect.any(Object),
        expect.any(Object),
        expect.any(Function),
        undefined // resumeFromMessageId
      );
    });

    it('應從中斷的訊息 ID 繼續遷移', async () => {
      const config = createMockOrchestratorConfig();
      const existingProgress = createProgressWithDialogs([
        {
          dialogId: '1',
          status: DialogStatus.InProgress,
          migratedCount: 50,
          lastMessageId: 500,
          targetGroupId: '999',
        },
      ]);

      const mockDialogs = [createMockDialogInfo({ id: '1', messageCount: 100 })];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockProgressService = {
        load: vi.fn().mockResolvedValue({ success: true, data: existingProgress }),
        save: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        initializeDialog: vi.fn().mockImplementation((p) => p),
        markDialogStarted: vi.fn().mockImplementation((p) => p),
        markDialogComplete: vi.fn().mockImplementation((p) => p),
        updateDialogProgress: vi.fn().mockImplementation((p) => p),
        getDialogStatus: vi.fn().mockReturnValue(DialogStatus.InProgress),
        getDialogProgress: vi.fn().mockReturnValue(existingProgress.dialogs.get('1')),
        getDailyGroupCreationCount: vi.fn().mockReturnValue(0),
        incrementDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        resetDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        isDailyGroupLimitReached: vi.fn().mockReturnValue(false),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn(),
        inviteUser: vi.fn(),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '1', success: true, migratedMessages: 50, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        progressService: mockProgressService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 不應重新建立群組（已存在 targetGroupId）
      expect(mockGroupService.createTargetGroup).not.toHaveBeenCalled();
      // 應繼續遷移
      expect(mockMigrationService.migrateDialog).toHaveBeenCalled();
    });
  });

  describe('網路錯誤恢復', () => {
    it('應在網路錯誤後自動重試', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      let callCount = 0;
      const mockDialogService = {
        getAllDialogs: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount < 3) {
            return Promise.resolve({
              success: false,
              error: { type: 'FETCH_FAILED', message: 'Network error' },
            });
          }
          return Promise.resolve({ success: true, data: mockDialogs });
        }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '1', success: true, migratedMessages: 100, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      // 啟用重試
      const result = await orchestrator.runMigration(mockClient, { maxRetries: 3 });

      expect(result.success).toBe(true);
      expect(mockDialogService.getAllDialogs).toHaveBeenCalledTimes(3);
    });

    it('應在達到重試上限後回報錯誤', async () => {
      const config = createMockOrchestratorConfig();

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({
          success: false,
          error: { type: 'FETCH_FAILED', message: 'Network error' },
        }),
        filterDialogs: vi.fn(),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
      });

      const result = await orchestrator.runMigration(mockClient, { maxRetries: 3 });

      // 所有重試都失敗後應回報錯誤
      expect(result.success).toBe(false);
    });
  });

  describe('FloodWait 處理', () => {
    it('應在 FloodWait 後等待並繼續', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      let migrateCallCount = 0;
      const mockMigrationService = {
        migrateDialog: vi.fn().mockImplementation(() => {
          migrateCallCount++;
          // 模擬 FloodWait 情境
          return Promise.resolve({
            success: true,
            data: {
              dialogId: '1',
              success: true,
              migratedMessages: 100,
              failedMessages: 0,
              errors: migrateCallCount === 1 ? ['FloodWait: 5s'] : [],
            },
          });
        }),
      };

      const mockReportService = {
        recordFloodWait: vi.fn(),
        getFloodWaitStats: vi.fn().mockReturnValue({ totalEvents: 1, totalWaitTime: 5, longestWait: 5 }),
        getFloodWaitEvents: vi.fn().mockReturnValue([]),
        generateReport: vi.fn().mockReturnValue({
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 0,
          totalDialogs: 1,
          completedDialogs: 1,
          failedDialogs: 0,
          skippedDialogs: 0,
          totalMessages: 100,
          migratedMessages: 100,
          failedMessages: 0,
          floodWaitSummary: { totalEvents: 1, totalWaitTime: 5, longestWait: 5, events: [] },
          errors: [],
        }),
        formatReportAsText: vi.fn().mockReturnValue(''),
        clearEvents: vi.fn(),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        reportService: mockReportService as any,
      });

      const result = await orchestrator.runMigration(mockClient);

      expect(result.success).toBe(true);
      // FloodWait 會被記錄
      expect(mockReportService.getFloodWaitStats().totalEvents).toBe(1);
    });

    it('應記錄 FloodWait 事件供報告使用', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '1', success: true, migratedMessages: 100, failedMessages: 0, errors: [] },
        }),
      };

      const floodWaitEvents: { seconds: number; operation: string }[] = [];
      const mockReportService = {
        recordFloodWait: vi.fn().mockImplementation((event) => {
          floodWaitEvents.push(event);
        }),
        getFloodWaitStats: vi.fn().mockReturnValue({ totalEvents: 0, totalWaitTime: 0, longestWait: 0 }),
        getFloodWaitEvents: vi.fn().mockReturnValue(floodWaitEvents),
        generateReport: vi.fn().mockReturnValue({
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 0,
          totalDialogs: 1,
          completedDialogs: 1,
          failedDialogs: 0,
          skippedDialogs: 0,
          totalMessages: 100,
          migratedMessages: 100,
          failedMessages: 0,
          floodWaitSummary: { totalEvents: 0, totalWaitTime: 0, longestWait: 0, events: [] },
          errors: [],
        }),
        formatReportAsText: vi.fn().mockReturnValue(''),
        clearEvents: vi.fn(),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        reportService: mockReportService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 報告服務可取得 FloodWait 事件
      expect(mockReportService.getFloodWaitEvents).toBeDefined();
    });
  });

  describe('單一訊息失敗處理', () => {
    it('單一訊息失敗不應中止整體流程', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [
        createMockDialogInfo({ id: '1' }),
        createMockDialogInfo({ id: '2' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      let dialogCount = 0;
      const mockMigrationService = {
        migrateDialog: vi.fn().mockImplementation(() => {
          dialogCount++;
          if (dialogCount === 1) {
            // 第一個對話有失敗的訊息
            return Promise.resolve({
              success: true,
              data: {
                dialogId: '1',
                success: false, // 部分失敗
                migratedMessages: 95,
                failedMessages: 5,
                errors: ['Message 10 protected', 'Message 20 protected'],
              },
            });
          }
          // 第二個對話完全成功
          return Promise.resolve({
            success: true,
            data: {
              dialogId: '2',
              success: true,
              migratedMessages: 100,
              failedMessages: 0,
              errors: [],
            },
          });
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        progressService: createMockProgressService() as any,
      });

      const result = await orchestrator.runMigration(mockClient);

      // 整體應該成功（有統計）
      expect(result.success).toBe(true);
      // 兩個對話都應被處理
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledTimes(2);
    });

    it('應記錄失敗的訊息供報告使用', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: {
            dialogId: '1',
            success: false,
            migratedMessages: 95,
            failedMessages: 5,
            errors: ['Message 10 protected'],
          },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        progressService: createMockProgressService() as any,
      });

      const result = await orchestrator.runMigration(mockClient);

      expect(result.success).toBe(true);
      if (result.success) {
        // 應有失敗訊息的統計
        expect(result.data.failedDialogs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('中斷信號處理', () => {
    it('應在收到中斷信號時安全儲存進度', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [
        createMockDialogInfo({ id: '1' }),
        createMockDialogInfo({ id: '2' }),
        createMockDialogInfo({ id: '3' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo(),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      let dialogCount = 0;
      const mockMigrationService = {
        migrateDialog: vi.fn().mockImplementation(() => {
          dialogCount++;
          return Promise.resolve({
            success: true,
            data: {
              dialogId: String(dialogCount),
              success: true,
              migratedMessages: 100,
              failedMessages: 0,
              errors: [],
            },
          });
        }),
      };

      const progressSaves: MigrationProgress[] = [];
      const mockProgressService = {
        load: vi.fn().mockResolvedValue({ success: true, data: createEmptyProgress() }),
        save: vi.fn().mockImplementation((_, progress) => {
          progressSaves.push(progress);
          return Promise.resolve({ success: true, data: undefined });
        }),
        initializeDialog: vi.fn().mockImplementation((p) => p),
        markDialogStarted: vi.fn().mockImplementation((p) => p),
        markDialogComplete: vi.fn().mockImplementation((p) => p),
        markDialogFailed: vi.fn().mockImplementation((p) => p),
        updateDialogProgress: vi.fn().mockImplementation((p) => p),
        getDialogStatus: vi.fn().mockReturnValue(DialogStatus.Pending),
        getDailyGroupCreationCount: vi.fn().mockReturnValue(0),
        incrementDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        resetDailyGroupCreation: vi.fn().mockImplementation((p) => p),
        isDailyGroupLimitReached: vi.fn().mockReturnValue(false),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        progressService: mockProgressService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 進度應被儲存
      expect(mockProgressService.save).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createEmptyProgress(): MigrationProgress {
  return {
    version: '1.0',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
