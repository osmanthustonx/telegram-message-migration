/**
 * Task 3.1: 實作多層級日誌服務
 *
 * TDD 測試 - 驗證 LogService 符合 design.md 與 interfaces.ts 規格
 *
 * Requirements: 7.1, 7.2, 7.5, 7.6
 * - 整合 winston 日誌框架並設定 Console 與 File 兩個輸出目標
 * - 支援 DEBUG、INFO、WARN、ERROR 四個日誌等級
 * - 在日誌中遮蔽電話號碼等敏感資訊
 * - 實作結構化日誌格式包含時間戳記與上下文資訊
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { ILogService } from '../../src/types/index.js';
import { LogLevel, DialogStatus, MigrationPhase } from '../../src/types/index.js';
import type { MigrationProgress, MigrationStats, FloodWaitEvent } from '../../src/types/index.js';

// 測試用的臨時日誌檔案路徑
const TEST_LOG_PATH = './test-migration.log';

describe('LogService', () => {
  let logService: ILogService;

  beforeEach(async () => {
    // 清除可能存在的測試日誌檔案
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }

    // 動態載入以確保每次測試使用新實例
    vi.resetModules();
    const { LogService } = await import('../../src/services/log-service.js');
    logService = new LogService({
      level: LogLevel.Debug,
      logFilePath: TEST_LOG_PATH,
    });
  });

  afterEach(() => {
    // 清理測試日誌檔案
    if (fs.existsSync(TEST_LOG_PATH)) {
      fs.unlinkSync(TEST_LOG_PATH);
    }
  });

  describe('ILogService 介面相容性', () => {
    it('應實作 debug 方法', () => {
      expect(typeof logService.debug).toBe('function');
    });

    it('應實作 info 方法', () => {
      expect(typeof logService.info).toBe('function');
    });

    it('應實作 warn 方法', () => {
      expect(typeof logService.warn).toBe('function');
    });

    it('應實作 error 方法', () => {
      expect(typeof logService.error).toBe('function');
    });

    it('應實作 logFloodWait 方法', () => {
      expect(typeof logService.logFloodWait).toBe('function');
    });

    it('應實作 logMessageMigration 方法', () => {
      expect(typeof logService.logMessageMigration).toBe('function');
    });

    it('應實作 generateReport 方法', () => {
      expect(typeof logService.generateReport).toBe('function');
    });

    it('應實作 setLevel 方法', () => {
      expect(typeof logService.setLevel).toBe('function');
    });

    it('應實作 getLevel 方法', () => {
      expect(typeof logService.getLevel).toBe('function');
    });
  });

  describe('日誌等級支援', () => {
    it('應支援 DEBUG 日誌等級', () => {
      // 不應拋出錯誤
      expect(() => logService.debug('Debug message')).not.toThrow();
    });

    it('應支援 INFO 日誌等級', () => {
      expect(() => logService.info('Info message')).not.toThrow();
    });

    it('應支援 WARN 日誌等級', () => {
      expect(() => logService.warn('Warn message')).not.toThrow();
    });

    it('應支援 ERROR 日誌等級', () => {
      expect(() => logService.error('Error message')).not.toThrow();
    });

    it('應能設定日誌等級', () => {
      logService.setLevel(LogLevel.Error);
      // setLevel 不應拋出錯誤
      expect(() => logService.setLevel(LogLevel.Info)).not.toThrow();
    });

    it('應能取得目前日誌等級', () => {
      expect(logService.getLevel()).toBe(LogLevel.Debug);
      logService.setLevel(LogLevel.Error);
      expect(logService.getLevel()).toBe(LogLevel.Error);
    });
  });

  describe('日誌輸出目標', () => {
    it('應將日誌寫入檔案', async () => {
      // Arrange & Act
      logService.info('Test file logging');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      expect(fs.existsSync(TEST_LOG_PATH)).toBe(true);
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      expect(logContent).toContain('Test file logging');
    });

    it('檔案日誌應為 JSON 格式', async () => {
      // Arrange & Act
      logService.info('JSON format test');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const lastLine = lines[lines.length - 1];

      // 應該可以解析為 JSON
      expect(() => JSON.parse(lastLine)).not.toThrow();
      const logEntry = JSON.parse(lastLine);
      expect(logEntry.message).toBe('JSON format test');
    });
  });

  describe('結構化日誌格式', () => {
    it('應包含時間戳記', async () => {
      // Arrange & Act
      logService.info('Timestamp test');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.timestamp).toBeDefined();
      // 驗證是 ISO 8601 格式
      expect(new Date(logEntry.timestamp).toISOString()).toBe(logEntry.timestamp);
    });

    it('應包含日誌等級', async () => {
      // Arrange & Act
      logService.warn('Level test');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.level).toBe('warn');
    });

    it('應包含訊息內容', async () => {
      // Arrange & Act
      logService.info('Message content test');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.message).toBe('Message content test');
    });

    it('應支援上下文資訊', async () => {
      // Arrange & Act
      logService.info('Context test', {
        dialogId: '123',
        dialogName: 'Test Dialog',
        operation: 'forward',
      });

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.dialogId).toBe('123');
      expect(logEntry.dialogName).toBe('Test Dialog');
      expect(logEntry.operation).toBe('forward');
    });
  });

  describe('敏感資訊遮蔽', () => {
    it('應遮蔽電話號碼 - 國際格式', async () => {
      // Arrange & Act
      logService.info('User phone: +886912345678');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      // 電話號碼應被遮蔽，只保留前幾碼和後幾碼
      expect(logEntry.message).not.toContain('+886912345678');
      expect(logEntry.message).toMatch(/\+886\*{4,}678/);
    });

    it('應遮蔽電話號碼 - 台灣格式', async () => {
      // Arrange & Act
      logService.info('Phone: 0912345678');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.message).not.toContain('0912345678');
      expect(logEntry.message).toMatch(/09\*{4,}78/);
    });

    it('應遮蔽上下文中的電話號碼', async () => {
      // Arrange & Act
      logService.info('Migration started', {
        sourcePhone: '+886912345678',
      });

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.sourcePhone).not.toBe('+886912345678');
      expect(logEntry.sourcePhone).toMatch(/\+886\*{4,}678/);
    });

    it('應遮蔽 API Hash', async () => {
      // Arrange & Act
      logService.info('Config loaded with hash: abcdef1234567890abcdef1234567890');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.message).not.toContain('abcdef1234567890abcdef1234567890');
      // 應該保留部分字元並遮蔽中間
      expect(logEntry.message).toMatch(/abcd\*+7890/);
    });
  });

  describe('error 方法特殊處理', () => {
    it('應能記錄 Error 物件', async () => {
      // Arrange
      const testError = new Error('Test error message');

      // Act
      logService.error('An error occurred', testError);

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.level).toBe('error');
      expect(logEntry.message).toBe('An error occurred');
      expect(logEntry.error).toBeDefined();
      expect(logEntry.error.message).toBe('Test error message');
    });

    it('應能記錄 Error 的 stack trace', async () => {
      // Arrange
      const testError = new Error('Stack trace test');

      // Act
      logService.error('Error with stack', testError);

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.error.stack).toBeDefined();
      expect(logEntry.error.stack).toContain('Stack trace test');
    });

    it('應能在沒有 Error 物件時正常記錄', async () => {
      // Act
      logService.error('Error without exception');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.level).toBe('error');
      expect(logEntry.message).toBe('Error without exception');
    });

    it('應支援 Error 物件與上下文一起記錄', async () => {
      // Arrange
      const testError = new Error('Context error');

      // Act
      logService.error('Error with context', testError, {
        dialogId: '456',
        operation: 'forward',
      });

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.dialogId).toBe('456');
      expect(logEntry.operation).toBe('forward');
      expect(logEntry.error.message).toBe('Context error');
    });
  });

  describe('logFloodWait 方法', () => {
    it('應記錄 FloodWait 事件', async () => {
      // Act
      logService.logFloodWait(60, 'forwardMessages');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.level).toBe('warn');
      expect(logEntry.message).toContain('FloodWait');
      expect(logEntry.seconds).toBe(60);
      expect(logEntry.operation).toBe('forwardMessages');
    });
  });

  describe('logMessageMigration 方法', () => {
    it('應記錄成功的訊息遷移', async () => {
      // Act
      logService.logMessageMigration('dialog_123', 50, true);

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.level).toBe('info');
      expect(logEntry.dialogId).toBe('dialog_123');
      expect(logEntry.messageCount).toBe(50);
      expect(logEntry.success).toBe(true);
    });

    it('應記錄失敗的訊息遷移', async () => {
      // Act
      logService.logMessageMigration('dialog_456', 30, false);

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      const lines = logContent.trim().split('\n');
      const logEntry = JSON.parse(lines[lines.length - 1]);

      expect(logEntry.level).toBe('warn');
      expect(logEntry.dialogId).toBe('dialog_456');
      expect(logEntry.success).toBe(false);
    });
  });

  describe('generateReport 方法', () => {
    it('應產生遷移報告', () => {
      // Arrange
      const mockProgress: MigrationProgress = createMockProgress();

      // Act
      const report = logService.generateReport(mockProgress);

      // Assert
      expect(report).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.duration).toBeDefined();
      expect(report.statistics).toBeDefined();
      expect(report.failedDialogs).toBeDefined();
      expect(report.floodWaitSummary).toBeDefined();
    });

    it('報告應包含正確的統計資訊', () => {
      // Arrange
      const mockProgress: MigrationProgress = createMockProgress();

      // Act
      const report = logService.generateReport(mockProgress);

      // Assert
      expect(report.statistics.totalDialogs).toBe(5);
      expect(report.statistics.completedDialogs).toBe(3);
      expect(report.statistics.failedDialogs).toBe(1);
      expect(report.statistics.migratedMessages).toBe(1000);
    });

    it('報告應包含失敗對話清單', () => {
      // Arrange
      const mockProgress: MigrationProgress = createMockProgress();

      // Act
      const report = logService.generateReport(mockProgress);

      // Assert
      expect(report.failedDialogs.length).toBeGreaterThan(0);
      expect(report.failedDialogs[0].dialogId).toBeDefined();
      expect(report.failedDialogs[0].status).toBe(DialogStatus.Failed);
    });

    it('報告應包含 FloodWait 摘要', () => {
      // Arrange
      const mockProgress: MigrationProgress = createMockProgress();

      // Act
      const report = logService.generateReport(mockProgress);

      // Assert
      expect(report.floodWaitSummary.totalEvents).toBe(3);
      expect(report.floodWaitSummary.totalSeconds).toBe(180);
      expect(report.floodWaitSummary.maxWaitSeconds).toBe(90);
    });
  });

  describe('日誌等級過濾', () => {
    it('設定為 ERROR 等級時不應輸出 DEBUG 訊息', async () => {
      // Arrange
      vi.resetModules();
      const { LogService } = await import('../../src/services/log-service.js');
      const errorOnlyLogger = new LogService({
        level: LogLevel.Error,
        logFilePath: TEST_LOG_PATH,
      });

      // Act
      errorOnlyLogger.debug('This should not appear');
      errorOnlyLogger.error('This should appear');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      expect(logContent).not.toContain('This should not appear');
      expect(logContent).toContain('This should appear');
    });

    it('設定為 WARN 等級時應輸出 WARN 和 ERROR 訊息', async () => {
      // Arrange
      vi.resetModules();
      const { LogService } = await import('../../src/services/log-service.js');
      const warnLogger = new LogService({
        level: LogLevel.Warn,
        logFilePath: TEST_LOG_PATH,
      });

      // Act
      warnLogger.debug('Debug should not appear');
      warnLogger.info('Info should not appear');
      warnLogger.warn('Warn should appear');
      warnLogger.error('Error should appear');

      // 等待檔案寫入完成
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert
      const logContent = fs.readFileSync(TEST_LOG_PATH, 'utf-8');
      expect(logContent).not.toContain('Debug should not appear');
      expect(logContent).not.toContain('Info should not appear');
      expect(logContent).toContain('Warn should appear');
      expect(logContent).toContain('Error should appear');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockProgress(): MigrationProgress {
  const stats: MigrationStats = {
    totalDialogs: 5,
    completedDialogs: 3,
    failedDialogs: 1,
    skippedDialogs: 1,
    totalMessages: 1500,
    migratedMessages: 1000,
    failedMessages: 50,
    floodWaitCount: 3,
    totalFloodWaitSeconds: 180,
  };

  const floodWaitEvents: FloodWaitEvent[] = [
    { timestamp: '2024-01-15T10:00:00Z', seconds: 30, operation: 'forwardMessages' },
    { timestamp: '2024-01-15T10:10:00Z', seconds: 60, operation: 'forwardMessages' },
    { timestamp: '2024-01-15T10:30:00Z', seconds: 90, operation: 'getHistory' },
  ];

  const dialogs = new Map();
  dialogs.set('dialog_1', {
    dialogId: 'dialog_1',
    dialogName: 'Test Dialog 1',
    dialogType: 'private',
    status: DialogStatus.Completed,
    targetGroupId: 'group_1',
    lastMessageId: 100,
    migratedCount: 100,
    totalCount: 100,
    errors: [],
    startedAt: '2024-01-15T10:00:00Z',
    completedAt: '2024-01-15T10:05:00Z',
  });
  dialogs.set('dialog_2', {
    dialogId: 'dialog_2',
    dialogName: 'Test Dialog 2',
    dialogType: 'group',
    status: DialogStatus.Failed,
    targetGroupId: 'group_2',
    lastMessageId: 50,
    migratedCount: 50,
    totalCount: 100,
    errors: [
      {
        timestamp: '2024-01-15T10:15:00Z',
        messageId: 51,
        errorType: 'FORWARD_FAILED',
        errorMessage: 'Message content is protected',
      },
    ],
    startedAt: '2024-01-15T10:10:00Z',
    completedAt: null,
  });

  return {
    version: '1.0',
    startedAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T12:00:00Z',
    sourceAccount: '+886912***678',
    targetAccount: '@user_b',
    currentPhase: MigrationPhase.MigratingMessages,
    dialogs,
    floodWaitEvents,
    stats,
  };
}
