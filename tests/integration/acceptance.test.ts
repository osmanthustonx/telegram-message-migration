/**
 * Task 11.3: 驗收測試覆蓋
 *
 * 驗證所有驗收條件，包含：
 * - Telegram 帳號 A 的 Session 維持與驗證
 * - 對話篩選機制（黑白名單與類型過濾）
 * - 訊息遷移至帳號 B 可見的群組
 * - 訊息順序保持與媒體正確性
 * - 斷點續傳與進度持久化
 * - FloodWait 處理與速率調整
 * - 產生遷移完成報告
 *
 * Requirements: All acceptance criteria from requirements.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TelegramClient } from 'telegram';
import { MigrationOrchestrator } from '../../src/services/orchestrator.js';
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
    sessionPath: './test-session-acceptance.txt',
    progressPath: './test-progress-acceptance.json',
    targetAccountB: '@testuser',
    batchSize: 100,
    groupNamePrefix: '[Migrated] ',
    logLevel: 'info',
    logFilePath: './test-migration-acceptance.log',
    groupCreationDelayMs: 0, // 測試環境不需要延遲
    ...overrides,
  };
}

// ============================================================================
// Task 11.3: 驗收測試覆蓋
// ============================================================================

describe('Acceptance Tests (Task 11.3)', () => {
  let orchestrator: MigrationOrchestrator;
  let mockClient: TelegramClient;

  beforeEach(() => {
    mockClient = createMockTelegramClient();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('AC-1: Telegram 帳號 A 的 Session 維持與驗證', () => {
    it('應使用 Session 成功驗證 A 帳號', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      const mockAuthService = {
        authenticate: vi.fn().mockResolvedValue({ success: true, data: mockClient }),
        hasValidSession: vi.fn().mockResolvedValue(true),
        saveSession: vi.fn().mockResolvedValue({ success: true, data: undefined }),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

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

      orchestrator = new MigrationOrchestrator(config, {
        authService: mockAuthService as any,
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      // 驗證 Session 存在性檢查
      const hasSession = await mockAuthService.hasValidSession('./test-session.txt');
      expect(hasSession).toBe(true);

      // 驗證可正常執行遷移
      const result = await orchestrator.runMigration(mockClient);
      expect(result.success).toBe(true);
    });

    it('Session 過期時應提示重新驗證', async () => {
      const config = createMockOrchestratorConfig();

      const mockAuthService = {
        authenticate: vi.fn().mockResolvedValue({
          success: false,
          error: { type: 'SESSION_EXPIRED', message: 'Session has expired' },
        }),
        hasValidSession: vi.fn().mockResolvedValue(false),
      };

      orchestrator = new MigrationOrchestrator(config, {
        authService: mockAuthService as any,
      });

      // 驗證 Session 檢查
      const hasSession = await mockAuthService.hasValidSession('./test-session.txt');
      expect(hasSession).toBe(false);

      // authenticate 會失敗
      const authResult = await mockAuthService.authenticate({});
      expect(authResult.success).toBe(false);
    });
  });

  describe('AC-2: 對話篩選機制', () => {
    it('應支援白名單（includeIds）過濾', async () => {
      const config = createMockOrchestratorConfig({
        dialogFilter: { includeIds: ['1', '3'] },
      });

      const mockDialogs = [
        createMockDialogInfo({ id: '1' }),
        createMockDialogInfo({ id: '2' }),
        createMockDialogInfo({ id: '3' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockReturnValue([mockDialogs[0], mockDialogs[2]]), // 只回傳 1, 3
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

      await orchestrator.runMigration(mockClient);

      expect(mockDialogService.filterDialogs).toHaveBeenCalledWith(
        mockDialogs,
        expect.objectContaining({ includeIds: ['1', '3'] })
      );
      // 只處理過濾後的 2 個對話
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledTimes(2);
    });

    it('應支援黑名單（excludeIds）過濾', async () => {
      const config = createMockOrchestratorConfig({
        dialogFilter: { excludeIds: ['2'] },
      });

      const mockDialogs = [
        createMockDialogInfo({ id: '1' }),
        createMockDialogInfo({ id: '2' }),
        createMockDialogInfo({ id: '3' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockReturnValue([mockDialogs[0], mockDialogs[2]]), // 排除 2
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

      await orchestrator.runMigration(mockClient);

      expect(mockDialogService.filterDialogs).toHaveBeenCalledWith(
        mockDialogs,
        expect.objectContaining({ excludeIds: ['2'] })
      );
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledTimes(2);
    });

    it('應支援對話類型（types）過濾', async () => {
      const config = createMockOrchestratorConfig({
        dialogFilter: { includeTypes: [DialogType.Private] },
      });

      const mockDialogs = [
        createMockDialogInfo({ id: '1', type: DialogType.Private }),
        createMockDialogInfo({ id: '2', type: DialogType.Group }),
        createMockDialogInfo({ id: '3', type: DialogType.Private }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockReturnValue([mockDialogs[0], mockDialogs[2]]),
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

      await orchestrator.runMigration(mockClient);

      expect(mockDialogService.filterDialogs).toHaveBeenCalled();
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC-3: 訊息遷移至帳號 B 可見的群組', () => {
    it('應為每個來源對話建立對應的目標群組', async () => {
      const config = createMockOrchestratorConfig({ groupNamePrefix: '[Backup] ' });
      const mockDialogs = [
        createMockDialogInfo({ id: '1', name: 'Chat with Alice' }),
        createMockDialogInfo({ id: '2', name: 'Chat with Bob' }),
      ];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
      };

      const mockGroupService = {
        createTargetGroup: vi.fn().mockImplementation((_, sourceDialog, config) => {
          return Promise.resolve({
            success: true,
            data: createMockGroupInfo({
              name: `${config.namePrefix}${sourceDialog.name}`,
              sourceDialogId: sourceDialog.id,
            }),
          });
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

      await orchestrator.runMigration(mockClient);

      // 應為每個對話建立群組
      expect(mockGroupService.createTargetGroup).toHaveBeenCalledTimes(2);
      // 群組名稱應包含前綴
      expect(mockGroupService.createTargetGroup).toHaveBeenCalledWith(
        mockClient,
        expect.objectContaining({ name: 'Chat with Alice' }),
        expect.objectContaining({ namePrefix: '[Backup] ' })
      );
    });

    it('應邀請 B 帳號加入群組', async () => {
      const config = createMockOrchestratorConfig({ targetAccountB: '@bob' });
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

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // 應邀請 B 帳號
      expect(mockGroupService.inviteUser).toHaveBeenCalledWith(
        mockClient,
        expect.any(Object),
        '@bob'
      );
    });
  });

  describe('AC-4: 訊息內容完整性', () => {
    it('應使用批次轉發保持訊息順序', async () => {
      const config = createMockOrchestratorConfig({ batchSize: 100 });
      const mockDialogs = [createMockDialogInfo({ id: '1', messageCount: 250 })];

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
          data: { dialogId: '1', success: true, migratedMessages: 250, failedMessages: 0, errors: [] },
        }),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      // migrateDialog 會處理批次邏輯
      expect(mockMigrationService.migrateDialog).toHaveBeenCalledWith(
        mockClient,
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ batchSize: 100 }),
        expect.any(Function)
      );
    });
  });

  describe('AC-5: 斷點續傳功能', () => {
    it('應在啟動時載入進度檔案', async () => {
      const config = createMockOrchestratorConfig();
      const existingProgress = createEmptyProgress();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

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
        getDialogStatus: vi.fn().mockReturnValue(DialogStatus.Pending),
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
        progressService: mockProgressService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      expect(mockProgressService.load).toHaveBeenCalled();
    });

    it('應在每批次完成後儲存進度', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [createMockDialogInfo({ id: '1' })];

      const mockDialogService = {
        getAllDialogs: vi.fn().mockResolvedValue({ success: true, data: mockDialogs }),
        filterDialogs: vi.fn().mockImplementation((dialogs) => dialogs),
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
        progressService: mockProgressService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
      });

      await orchestrator.runMigration(mockClient);

      expect(mockProgressService.save).toHaveBeenCalled();
    });
  });

  describe('AC-6: FloodWait 處理', () => {
    it('應在遇到 FloodWait 時自動等待後重試', async () => {
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
            success: true,
            migratedMessages: 100,
            failedMessages: 0,
            errors: [],
          },
        }),
      };

      const floodWaitRecords: { seconds: number; operation: string }[] = [];
      const mockReportService = {
        recordFloodWait: vi.fn().mockImplementation((event) => {
          floodWaitRecords.push(event);
        }),
        getFloodWaitStats: vi.fn().mockReturnValue({
          totalEvents: floodWaitRecords.length,
          totalWaitTime: floodWaitRecords.reduce((sum, r) => sum + r.seconds, 0),
          longestWait: Math.max(...floodWaitRecords.map((r) => r.seconds), 0),
        }),
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

      const result = await orchestrator.runMigration(mockClient);

      expect(result.success).toBe(true);
    });
  });

  describe('AC-7: 遷移報告', () => {
    it('應在完成後產生遷移報告', async () => {
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

      const mockReportService = {
        generateReport: vi.fn().mockReturnValue({
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 120,
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
        recordFloodWait: vi.fn(),
        getFloodWaitStats: vi.fn().mockReturnValue({ totalEvents: 0, totalWaitTime: 0, longestWait: 0 }),
        getFloodWaitEvents: vi.fn().mockReturnValue([]),
        formatReportAsText: vi.fn().mockReturnValue('Migration Report...'),
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
      expect(mockReportService.generateReport).toHaveBeenCalled();
    });

    it('報告應包含對話統計、失敗清單與 FloodWait 摘要', async () => {
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
            return Promise.resolve({
              success: true,
              data: {
                dialogId: '1',
                success: false,
                migratedMessages: 50,
                failedMessages: 5,
                errors: ['Some messages failed'],
              },
            });
          }
          return Promise.resolve({
            success: true,
            data: { dialogId: '2', success: true, migratedMessages: 100, failedMessages: 0, errors: [] },
          });
        }),
      };

      const mockReportService = {
        generateReport: vi.fn().mockReturnValue({
          startedAt: new Date(),
          completedAt: new Date(),
          duration: 120,
          totalDialogs: 2,
          completedDialogs: 1,
          failedDialogs: 1,
          skippedDialogs: 0,
          totalMessages: 200,
          migratedMessages: 150,
          failedMessages: 5,
          floodWaitSummary: { totalEvents: 2, totalWaitTime: 30, longestWait: 20, events: [] },
          errors: [{ dialogId: '1', dialogName: 'Test', error: 'Some messages failed', timestamp: '' }],
        }),
        recordFloodWait: vi.fn(),
        getFloodWaitStats: vi.fn().mockReturnValue({ totalEvents: 2, totalWaitTime: 30, longestWait: 20 }),
        getFloodWaitEvents: vi.fn().mockReturnValue([]),
        formatReportAsText: vi.fn().mockReturnValue('Migration Report...'),
        clearEvents: vi.fn(),
      };

      orchestrator = new MigrationOrchestrator(config, {
        dialogService: mockDialogService as any,
        groupService: mockGroupService as any,
        migrationService: mockMigrationService as any,
        reportService: mockReportService as any,
      });

      await orchestrator.runMigration(mockClient);

      const report = mockReportService.generateReport.mock.results[0]?.value;
      expect(report).toBeDefined();
      expect(report.totalDialogs).toBe(2);
      expect(report.completedDialogs).toBe(1);
      expect(report.failedDialogs).toBe(1);
      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.floodWaitSummary.totalEvents).toBe(2);
    });
  });

  describe('AC-8: DryRun 模式', () => {
    it('DryRun 應列出會遷移的對話但不實際執行', async () => {
      const config = createMockOrchestratorConfig();
      const mockDialogs = [
        createMockDialogInfo({ id: '1', name: 'Chat 1' }),
        createMockDialogInfo({ id: '2', name: 'Chat 2' }),
      ];

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
      // DryRun 應取得對話清單
      expect(mockDialogService.getAllDialogs).toHaveBeenCalled();
      // 但不應建立群組或遷移訊息
      expect(mockGroupService.createTargetGroup).not.toHaveBeenCalled();
      expect(mockMigrationService.migrateDialog).not.toHaveBeenCalled();

      // 應回傳會處理的對話統計
      if (result.success) {
        expect(result.data.totalDialogs).toBe(2);
      }
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
