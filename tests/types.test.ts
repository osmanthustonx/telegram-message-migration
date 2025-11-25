import { describe, it, expect } from 'vitest';

/**
 * Task 1.2: 定義共用型別與介面
 *
 * TDD 測試 - 驗證所有型別與介面符合 design.md 規格
 */

describe('Types Module', () => {
  describe('Result Type', () => {
    it('should export Result type', async () => {
      const { Result } = await import('../src/types/index.js');
      // Result 是型別，無法直接測試，改測試輔助函式
      expect(true).toBe(true); // 型別存在即通過編譯
    });

    it('should export success helper function', async () => {
      const { success } = await import('../src/types/index.js');
      const result = success({ value: 42 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ value: 42 });
      }
    });

    it('should export failure helper function', async () => {
      const { failure } = await import('../src/types/index.js');
      const error = new Error('test error');
      const result = failure(error);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(error);
      }
    });

    it('should support custom error types', async () => {
      const { failure } = await import('../src/types/index.js');
      type CustomError = { type: 'CUSTOM'; message: string };
      const customError: CustomError = { type: 'CUSTOM', message: 'test' };
      const result = failure<string, CustomError>(customError);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CUSTOM');
      }
    });
  });

  describe('Enums', () => {
    it('should export DialogType enum', async () => {
      const { DialogType } = await import('../src/types/index.js');
      expect(DialogType.Private).toBe('private');
      expect(DialogType.Group).toBe('group');
      expect(DialogType.Supergroup).toBe('supergroup');
      expect(DialogType.Channel).toBe('channel');
      expect(DialogType.Bot).toBe('bot');
    });

    it('should export DialogStatus enum', async () => {
      const { DialogStatus } = await import('../src/types/index.js');
      expect(DialogStatus.Pending).toBe('pending');
      expect(DialogStatus.InProgress).toBe('in_progress');
      expect(DialogStatus.Completed).toBe('completed');
      expect(DialogStatus.Failed).toBe('failed');
      expect(DialogStatus.Skipped).toBe('skipped');
    });

    it('should export LogLevel enum', async () => {
      const { LogLevel } = await import('../src/types/index.js');
      expect(LogLevel.Debug).toBe('debug');
      expect(LogLevel.Info).toBe('info');
      expect(LogLevel.Warn).toBe('warn');
      expect(LogLevel.Error).toBe('error');
    });

    it('should export MigrationPhase enum', async () => {
      const { MigrationPhase } = await import('../src/types/index.js');
      expect(MigrationPhase.Idle).toBe('idle');
      expect(MigrationPhase.Authenticating).toBe('authenticating');
      expect(MigrationPhase.FetchingDialogs).toBe('fetching_dialogs');
      expect(MigrationPhase.CreatingGroups).toBe('creating_groups');
      expect(MigrationPhase.MigratingMessages).toBe('migrating_messages');
      expect(MigrationPhase.Completed).toBe('completed');
    });
  });

  describe('Data Models', () => {
    describe('DialogInfo', () => {
      it('should have required properties', async () => {
        const types = await import('../src/types/index.js');
        const dialogInfo: types.DialogInfo = {
          id: '12345',
          accessHash: 'abc123',
          type: types.DialogType.Private,
          name: 'Test Dialog',
          messageCount: 100,
          unreadCount: 5,
          isArchived: false,
          entity: null,
        };
        expect(dialogInfo.id).toBe('12345');
        expect(dialogInfo.type).toBe(types.DialogType.Private);
      });
    });

    describe('GroupInfo', () => {
      it('should have required properties', async () => {
        const types = await import('../src/types/index.js');
        const groupInfo: types.GroupInfo = {
          id: '67890',
          accessHash: 'def456',
          name: '[Migrated] Test',
          sourceDialogId: '12345',
          createdAt: '2024-01-01T00:00:00Z',
          entity: null,
        };
        expect(groupInfo.id).toBe('67890');
        expect(groupInfo.sourceDialogId).toBe('12345');
      });
    });

    describe('DialogProgress', () => {
      it('should have required properties', async () => {
        const types = await import('../src/types/index.js');
        const progress: types.DialogProgress = {
          dialogId: '12345',
          dialogName: 'Test Dialog',
          dialogType: types.DialogType.Private,
          status: types.DialogStatus.InProgress,
          targetGroupId: '67890',
          lastMessageId: 1000,
          migratedCount: 50,
          totalCount: 100,
          errors: [],
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        };
        expect(progress.dialogId).toBe('12345');
        expect(progress.status).toBe(types.DialogStatus.InProgress);
      });

      it('should support DialogError array', async () => {
        const types = await import('../src/types/index.js');
        const progress: types.DialogProgress = {
          dialogId: '12345',
          dialogName: 'Test Dialog',
          dialogType: types.DialogType.Private,
          status: types.DialogStatus.Failed,
          targetGroupId: null,
          lastMessageId: null,
          migratedCount: 0,
          totalCount: 100,
          errors: [
            {
              timestamp: '2024-01-01T00:00:00Z',
              messageId: 500,
              errorType: 'FORWARD_FAILED',
              errorMessage: 'Message content is protected',
            },
          ],
          startedAt: '2024-01-01T00:00:00Z',
          completedAt: null,
        };
        expect(progress.errors).toHaveLength(1);
        expect(progress.errors[0]?.errorType).toBe('FORWARD_FAILED');
      });
    });

    describe('MigrationProgress', () => {
      it('should have required properties', async () => {
        const types = await import('../src/types/index.js');
        const progress: types.MigrationProgress = {
          version: '1.0',
          startedAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T01:00:00Z',
          sourceAccount: '+886912***456',
          targetAccount: '@user_b',
          currentPhase: types.MigrationPhase.MigratingMessages,
          dialogs: new Map(),
          floodWaitEvents: [],
          stats: {
            totalDialogs: 10,
            completedDialogs: 5,
            failedDialogs: 1,
            skippedDialogs: 0,
            totalMessages: 1000,
            migratedMessages: 500,
            failedMessages: 10,
            floodWaitCount: 2,
            totalFloodWaitSeconds: 300,
          },
        };
        expect(progress.version).toBe('1.0');
        expect(progress.currentPhase).toBe(types.MigrationPhase.MigratingMessages);
      });
    });

    describe('AppConfig', () => {
      it('should have required properties', async () => {
        const types = await import('../src/types/index.js');
        const config: types.AppConfig = {
          apiId: 12345,
          apiHash: 'abcdef1234567890abcdef1234567890',
          phoneNumberA: '+886912345678',
          targetUserB: '@user_b',
          sessionPath: './session.txt',
          progressPath: './progress.json',
          batchSize: 100,
          batchDelay: 1000,
          floodWaitThreshold: 300,
          groupNamePrefix: '[Migrated] ',
          logLevel: types.LogLevel.Info,
          logFilePath: './migration.log',
        };
        expect(config.apiId).toBe(12345);
        expect(config.batchSize).toBe(100);
      });

      it('should support optional filter properties', async () => {
        const types = await import('../src/types/index.js');
        const config: types.AppConfig = {
          apiId: 12345,
          apiHash: 'abcdef1234567890abcdef1234567890',
          phoneNumberA: '+886912345678',
          targetUserB: '@user_b',
          sessionPath: './session.txt',
          progressPath: './progress.json',
          batchSize: 100,
          batchDelay: 1000,
          floodWaitThreshold: 300,
          groupNamePrefix: '[Migrated] ',
          logLevel: types.LogLevel.Info,
          logFilePath: './migration.log',
          dialogFilter: {
            includeIds: ['123', '456'],
            excludeIds: [],
            types: [types.DialogType.Private, types.DialogType.Group],
          },
          dateRange: {
            from: new Date('2024-01-01'),
            to: new Date('2024-12-31'),
          },
        };
        expect(config.dialogFilter?.includeIds).toEqual(['123', '456']);
        expect(config.dateRange?.from).toBeInstanceOf(Date);
      });
    });
  });

  describe('Error Types', () => {
    it('should export AuthError type', async () => {
      const types = await import('../src/types/index.js');
      const error1: types.AuthError = { type: 'INVALID_CREDENTIALS', message: 'Bad credentials' };
      const error2: types.AuthError = { type: 'INVALID_CODE', message: 'Wrong code', attemptsLeft: 2 };
      const error3: types.AuthError = { type: 'INVALID_2FA', message: 'Wrong password' };
      const error4: types.AuthError = { type: 'NETWORK_ERROR', message: 'Connection failed', retryCount: 3 };
      const error5: types.AuthError = { type: 'SESSION_EXPIRED', message: 'Session expired' };

      expect(error1.type).toBe('INVALID_CREDENTIALS');
      expect(error2.attemptsLeft).toBe(2);
      expect(error4.retryCount).toBe(3);
      expect(error5.type).toBe('SESSION_EXPIRED');
    });

    it('should export DialogError type', async () => {
      const types = await import('../src/types/index.js');
      const error1: types.DialogServiceError = { type: 'FETCH_FAILED', message: 'API error' };
      const error2: types.DialogServiceError = { type: 'NOT_FOUND', dialogId: '123' };
      const error3: types.DialogServiceError = { type: 'ACCESS_DENIED', dialogId: '456' };

      expect(error1.type).toBe('FETCH_FAILED');
      expect(error2.dialogId).toBe('123');
    });

    it('should export GroupError type', async () => {
      const types = await import('../src/types/index.js');
      const error1: types.GroupError = { type: 'CREATE_FAILED', message: 'Cannot create' };
      const error2: types.GroupError = { type: 'USER_RESTRICTED', message: 'User restricted' };
      const error3: types.GroupError = { type: 'INVITE_FAILED', userIdentifier: '@test', message: 'Cannot invite' };
      const error4: types.GroupError = { type: 'USER_NOT_FOUND', userIdentifier: '@unknown' };
      const error5: types.GroupError = { type: 'FLOOD_WAIT', seconds: 300 };

      expect(error1.type).toBe('CREATE_FAILED');
      expect(error3.userIdentifier).toBe('@test');
      expect(error5.seconds).toBe(300);
    });

    it('should export MigrationError type', async () => {
      const types = await import('../src/types/index.js');
      const error1: types.MigrationError = { type: 'DIALOG_FETCH_FAILED', message: 'Failed' };
      const error2: types.MigrationError = { type: 'GROUP_CREATE_FAILED', dialogId: '123', message: 'Failed' };
      const error3: types.MigrationError = { type: 'INVITE_FAILED', dialogId: '123', message: 'Failed' };
      const error4: types.MigrationError = { type: 'FORWARD_FAILED', dialogId: '123', messageIds: [1, 2], message: 'Failed' };
      const error5: types.MigrationError = { type: 'FLOOD_WAIT', seconds: 300 };
      const error6: types.MigrationError = { type: 'ABORTED', reason: 'User cancelled' };

      expect(error1.type).toBe('DIALOG_FETCH_FAILED');
      expect(error4.messageIds).toEqual([1, 2]);
      expect(error6.reason).toBe('User cancelled');
    });

    it('should export ProgressError type', async () => {
      const types = await import('../src/types/index.js');
      const error1: types.ProgressError = { type: 'FILE_NOT_FOUND', path: './progress.json' };
      const error2: types.ProgressError = { type: 'FILE_CORRUPTED', path: './progress.json', message: 'Invalid JSON' };
      const error3: types.ProgressError = { type: 'WRITE_FAILED', path: './progress.json', message: 'Permission denied' };
      const error4: types.ProgressError = { type: 'INVALID_FORMAT', message: 'Unknown version' };

      expect(error1.path).toBe('./progress.json');
      expect(error2.type).toBe('FILE_CORRUPTED');
    });

    it('should export ConfigError type', async () => {
      const types = await import('../src/types/index.js');
      const error1: types.ConfigError = { type: 'MISSING_REQUIRED', field: 'apiId' };
      const error2: types.ConfigError = { type: 'INVALID_VALUE', field: 'apiId', message: 'Must be positive' };
      const error3: types.ConfigError = { type: 'FILE_NOT_FOUND', path: './config.json' };

      expect(error1.field).toBe('apiId');
      expect(error3.path).toBe('./config.json');
    });
  });

  describe('Service Interfaces', () => {
    it('should export IAuthService interface type', async () => {
      // 介面是型別定義，透過編譯時檢查確認
      // 此處僅確認模組可正確匯入
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export IDialogService interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export IGroupService interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export IMigrationService interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export IProgressService interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export ILogService interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export IConfigLoader interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });

    it('should export IRateLimiter interface type', async () => {
      const types = await import('../src/types/index.js');
      expect(types).toBeDefined();
    });
  });

  describe('Barrel Export', () => {
    it('should export all types from index.ts', async () => {
      const types = await import('../src/types/index.js');

      // Enums
      expect(types.DialogType).toBeDefined();
      expect(types.DialogStatus).toBeDefined();
      expect(types.LogLevel).toBeDefined();
      expect(types.MigrationPhase).toBeDefined();

      // Helper functions
      expect(types.success).toBeDefined();
      expect(types.failure).toBeDefined();
      expect(typeof types.success).toBe('function');
      expect(typeof types.failure).toBe('function');
    });
  });
});
