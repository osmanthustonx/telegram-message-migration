/**
 * Task 11.1: 服務整合與主流程協調測試
 *
 * 測試 MigrationOrchestrator 服務的整合功能，包含：
 * - 連接所有服務模組形成完整遷移流程
 * - 驗證流程：驗證 -> 對話列舉 -> 群組建立 -> 訊息遷移 -> 報告
 * - 確保服務間資料傳遞正確
 * - 處理跨服務錯誤傳播與中止條件
 *
 * Requirements: 1.1, 2.1, 3.1, 4.1, 6.1, 7.1, 8.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TelegramClient } from 'telegram';
import { MigrationOrchestrator } from '../../src/services/orchestrator.js';
import { DialogService } from '../../src/services/dialog-service.js';
import { DialogType, DialogStatus, MigrationPhase } from '../../src/types/enums.js';
import type {
  DialogInfo,
  GroupInfo,
  MigrationProgress,
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
    sessionPath: './test-session-orchestrator.txt',
    progressPath: './test-progress-orchestrator.json',
    targetAccountB: '@testuser',
    batchSize: 100,
    groupNamePrefix: '[Migrated] ',
    logLevel: 'info',
    logFilePath: './test-migration-orchestrator.log',
    ...overrides,
  };
}

// ============================================================================
// Task 11.1: 服務整合與主流程協調測試
// ============================================================================

describe('MigrationOrchestrator (Task 11.1)', () => {
  let orchestrator: MigrationOrchestrator;
  let mockClient: TelegramClient;

  beforeEach(() => {
    mockClient = createMockTelegramClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('建構與初始化', () => {
    it('應接受設定並初始化所有服務', () => {
      const config = createMockOrchestratorConfig();
      orchestrator = new MigrationOrchestrator(config);

      expect(orchestrator).toBeDefined();
    });

    it('應使用預設服務實例', () => {
      const config = createMockOrchestratorConfig();
      orchestrator = new MigrationOrchestrator(config);

      // 透過 getServices() 方法驗證服務已初始化
      const services = orchestrator.getServices();
      expect(services.dialogService).toBeDefined();
      expect(services.groupService).toBeDefined();
      expect(services.migrationService).toBeDefined();
      expect(services.progressService).toBeDefined();
      expect(services.reportService).toBeDefined();
      expect(services.rateLimiter).toBeDefined();
    });

    it('應允許注入自訂服務（用於測試）', () => {
      const config = createMockOrchestratorConfig();
      const customDialogService = new DialogService();
      orchestrator = new MigrationOrchestrator(config, {
        dialogService: customDialogService,
      });

      const services = orchestrator.getServices();
      expect(services.dialogService).toBe(customDialogService);
    });
  });

  describe('完整遷移流程', () => {
    it('應執行完整流程：對話列舉 -> 群組建立 -> 訊息遷移 -> 報告', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [
        createMockDialogInfo({ id: '1', name: 'Dialog 1', messageCount: 10 }),
        createMockDialogInfo({ id: '2', name: 'Dialog 2', messageCount: 20 }),
      ];

      // 建立 mock 服務
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
            success: true,
            migratedMessages: 10,
            failedMessages: 0,
            errors: [],
          },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      const result = await orchestrator.runMigration(mockClient);

      expect(result.success).toBe(true);
      expect(mockDialogService.getAllDialogs).toHaveBeenCalledWith(mockClient);
      expect(mockGroupService.createTargetGroup).toHaveBeenCalled();
      expect(mockMigrationService.migrateDialog).toHaveBeenCalled();
    });

    it('應在對話列舉失敗時中止流程', async () => {
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

      const result = await orchestrator.runMigration(mockClient);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DIALOG_FETCH_FAILED');
      }
    });

    it('應在群組建立失敗時繼續處理下一個對話', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [
        createMockDialogInfo({ id: '1', name: 'Dialog 1' }),
        createMockDialogInfo({ id: '2', name: 'Dialog 2' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      let createCallCount = 0;
      const mockGroupService = {
        createTargetGroup: vi.fn().mockImplementation(() => {
          createCallCount++;
          if (createCallCount === 1) {
            return Promise.resolve({
              success: false,
              error: { type: 'CREATE_FAILED', message: 'Failed to create' },
            });
          }
          return Promise.resolve({ success: true, data: createMockGroupInfo() });
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: {
            dialogId: '2',
            success: true,
            migratedMessages: 20,
            failedMessages: 0,
            errors: [],
          },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      const result = await orchestrator.runMigration(mockClient);

      // 第一個對話失敗但第二個成功
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.completedDialogs).toBe(1);
        expect(result.data.failedDialogs).toBe(1);
      }
    });
  });

  describe('服務間資料傳遞', () => {
    it('應將對話資訊正確傳遞給群組服務', async () => {
      const config = createMockOrchestratorConfig();
      const testDialog = createMockDialogInfo({ id: '123', name: 'Test Chat' });

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: [testDialog] }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({
          success: true,
          data: createMockGroupInfo({ sourceDialogId: '123' }),
        }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '123', success: true, migratedMessages: 0, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 驗證群組服務收到正確的對話資訊
      expect(mockGroupService.createTargetGroup).toHaveBeenCalledWith(
        mockClient,
        testDialog,
        expect.objectContaining({ namePrefix: '[Migrated] ' })
      );
    });

    it('應將群組資訊正確傳遞給遷移服務', async () => {
      const config = createMockOrchestratorConfig();
      const testDialog = createMockDialogInfo({ id: '123' });
      const testGroup = createMockGroupInfo({ id: '456', sourceDialogId: '123' });

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: [testDialog] }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockResolvedValue({ success: true, data: testGroup }),
        inviteUser: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn().mockResolvedValue({
          success: true,
          data: { dialogId: '123', success: true, migratedMessages: 0, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 驗證遷移服務收到正確的對話與群組資訊
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledWith(
        mockClient,
        testDialog,
        testGroup,
        expect.any(Object),
        expect.any(Function)
      );
    });
  });

  describe('進度追蹤與持久化', () => {
    it('應在每個對話完成後更新進度', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1', messageCount: 50 })];

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
            success: true,
            migratedMessages: 50,
            failedMessages: 0,
            errors: [],
          },
        }),
      };

      const mockProgressService = {
        load: vi.fn().mockResolvedValue({ success: true, data: createEmptyProgress() }),
        save: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        initializeDialog: vi.fn().mockImplementation((p) => p),
        markDialogStarted: vi.fn().mockImplementation((p) => p),
        markDialogComplete: vi.fn().mockImplementation((p) => p),
        updateDialogProgress: vi.fn().mockImplementation((p) => p),
        getDialogStatus: vi.fn().mockReturnValue(DialogStatus.Pending),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        progressService: mockProgressService as any,
      });

      await orchestrator.runMigration(mockClient);

      expect(mockProgressService.markDialogComplete).toHaveBeenCalled();
      expect(mockProgressService.save).toHaveBeenCalled();
    });

    it('應在遷移完成後產生報告', async () => {
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
          data: { dialogId: '1', success: true, migratedMessages: 10, failedMessages: 0, errors: [] },
        }),
      };

      const mockReportService = {
        generateReport: vi.fn().mockReturnValue({
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 100,
          totalDialogs: 1,
          completedDialogs: 1,
          failedDialogs: 0,
          skippedDialogs: 0,
          totalMessages: 10,
          migratedMessages: 10,
          failedMessages: 0,
          floodWaitSummary: { totalEvents: 0, totalWaitTime: 0, longestWait: 0, events: [] },
          errors: [],
        }),
        recordFloodWait: vi.fn(),
        getFloodWaitStats: vi.fn().mockReturnValue({ totalEvents: 0, totalWaitTime: 0, longestWait: 0 }),
        getFloodWaitEvents: vi.fn().mockReturnValue([]),
        formatReportAsText: vi.fn().mockReturnValue('Report text'),
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
      // 報告會在遷移結束時產生
      expect(mockReportService.generateReport).toHaveBeenCalled();
    });
  });

  describe('跨服務錯誤處理', () => {
    it('應正確傳播 B 帳號邀請失敗錯誤', async () => {
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
        inviteUser: vi.fn().mockResolvedValue({
          success: false,
          error: { type: 'USER_NOT_FOUND', userIdentifier: '@testuser' },
        }),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
      });

      const result = await orchestrator.runMigration(mockClient);

      // 邀請失敗會標記該對話為失敗
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.failedDialogs).toBe(1);
      }
    });

    it('應正確處理 FloodWait 並繼續執行', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      let forwardCallCount = 0;
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

      // 模擬 FloodWait 然後成功
      const mockMigrationService = {
        migrateDialog: vi.fn().mockImplementation(() => {
          forwardCallCount++;
          if (forwardCallCount === 1) {
            return Promise.resolve({
              success: true,
              data: {
                dialogId: '1',
                success: false,
                migratedMessages: 50,
                failedMessages: 0,
                errors: ['FloodWait: 5s'],
              },
            });
          }
          return Promise.resolve({
            success: true,
            data: {
              dialogId: '1',
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
      });

      const result = await orchestrator.runMigration(mockClient);

      // FloodWait 會被處理，遷移繼續
      expect(result.success).toBe(true);
    });
  });

  describe('DryRun 模式', () => {
    it('DryRun 模式不應實際建立群組或轉發訊息', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn(),
        inviteUser: vi.fn(),
        canInviteUser: vi.fn().mockResolvedValue({ success: true, data: true }),
      };

      const mockMigrationService = {
        migrateDialog: vi.fn(),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      const result = await orchestrator.runMigration(mockClient, { dryRun: true });

      expect(result.success).toBe(true);
      expect(mockGroupService.createTargetGroup).not.toHaveBeenCalled();
      expect(mockMigrationService.migrateDialog).not.toHaveBeenCalled();
    });
  });

  describe('對話過濾', () => {
    it('應套用對話過濾條件', async () => {
      const config = createMockOrchestratorConfig({
        dialogFilter: {
          includeTypes: [DialogType.Private],
        },
      });
      const mockDialogs = [
        createMockDialogInfo({ id: '1', type: DialogType.Private }),
        createMockDialogInfo({ id: '2', type: DialogType.Group }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockReturnValue([mockDialogs[0]]), // 只回傳 Private
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
          data: { dialogId: '1', success: true, migratedMessages: 0, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // filterDialogs 應被呼叫
      expect(mockDialogService.filterDialogs).toHaveBeenCalled();
      // 只處理過濾後的對話（1 個）
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledTimes(1);
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
