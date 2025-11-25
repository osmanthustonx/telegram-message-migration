/**
 * Task 3.2: 實作 FloodWait 事件追蹤與遷移報告產生
 *
 * TDD 測試 - 驗證 ReportService 符合 design.md 規格
 *
 * Requirements: 5.6, 7.4
 * - 記錄每次 FloodWait 事件的等待秒數與觸發操作
 * - 統計 FloodWait 發生次數與總等待時間
 * - 產生遷移完成報告包含對話統計、失敗清單、FloodWait 摘要
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { IReportService } from '../../src/types/interfaces.js';
import { DialogStatus, MigrationPhase } from '../../src/types/enums.js';
import type {
  MigrationProgress,
  MigrationStats,
  FloodWaitEvent,
  DetailedMigrationReport,
  DialogProgress,
} from '../../src/types/models.js';

// 測試用的臨時檔案路徑
const TEST_REPORT_PATH = './test-migration-report.txt';

describe('ReportService', () => {
  let reportService: IReportService;

  beforeEach(async () => {
    // 清除可能存在的測試檔案
    if (fs.existsSync(TEST_REPORT_PATH)) {
      fs.unlinkSync(TEST_REPORT_PATH);
    }

    // 動態載入以確保每次測試使用新實例
    vi.resetModules();
    const { ReportService } = await import('../../src/services/report-service.js');
    reportService = new ReportService();
  });

  afterEach(() => {
    // 清理測試檔案
    if (fs.existsSync(TEST_REPORT_PATH)) {
      fs.unlinkSync(TEST_REPORT_PATH);
    }
  });

  describe('IReportService 介面相容性', () => {
    it('應實作 recordFloodWait 方法', () => {
      expect(typeof reportService.recordFloodWait).toBe('function');
    });

    it('應實作 getFloodWaitStats 方法', () => {
      expect(typeof reportService.getFloodWaitStats).toBe('function');
    });

    it('應實作 getFloodWaitEvents 方法', () => {
      expect(typeof reportService.getFloodWaitEvents).toBe('function');
    });

    it('應實作 generateReport 方法', () => {
      expect(typeof reportService.generateReport).toBe('function');
    });

    it('應實作 formatReportAsText 方法', () => {
      expect(typeof reportService.formatReportAsText).toBe('function');
    });

    it('應實作 saveReportToFile 方法', () => {
      expect(typeof reportService.saveReportToFile).toBe('function');
    });

    it('應實作 clearEvents 方法', () => {
      expect(typeof reportService.clearEvents).toBe('function');
    });
  });

  describe('recordFloodWait 方法', () => {
    it('應記錄 FloodWait 事件', () => {
      // Arrange
      const event: FloodWaitEvent = {
        timestamp: new Date().toISOString(),
        seconds: 60,
        operation: 'forwardMessages',
      };

      // Act
      reportService.recordFloodWait(event);

      // Assert
      const stats = reportService.getFloodWaitStats();
      expect(stats.totalEvents).toBe(1);
      expect(stats.totalWaitTime).toBe(60);
    });

    it('應記錄多個 FloodWait 事件', () => {
      // Arrange & Act
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:01:00Z',
        seconds: 60,
        operation: 'getHistory',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:02:00Z',
        seconds: 90,
        operation: 'forwardMessages',
      });

      // Assert
      const stats = reportService.getFloodWaitStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.totalWaitTime).toBe(180);
      expect(stats.longestWait).toBe(90);
    });

    it('應記錄事件的 dialogId（若有）', () => {
      // Arrange
      const eventWithDialog: FloodWaitEvent = {
        timestamp: new Date().toISOString(),
        seconds: 45,
        operation: 'forwardMessages',
        dialogId: 'dialog_123',
      };

      // Act
      reportService.recordFloodWait(eventWithDialog);

      // Assert
      const events = reportService.getFloodWaitEvents();
      expect(events.length).toBe(1);
      expect(events[0].dialogId).toBe('dialog_123');
    });
  });

  describe('getFloodWaitStats 方法', () => {
    it('無事件時應回傳零統計', () => {
      // Act
      const stats = reportService.getFloodWaitStats();

      // Assert
      expect(stats.totalEvents).toBe(0);
      expect(stats.totalWaitTime).toBe(0);
      expect(stats.longestWait).toBe(0);
    });

    it('應計算正確的總等待時間', () => {
      // Arrange
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:05:00Z',
        seconds: 120,
        operation: 'forwardMessages',
      });

      // Act
      const stats = reportService.getFloodWaitStats();

      // Assert
      expect(stats.totalWaitTime).toBe(150);
    });

    it('應找出最長的等待時間', () => {
      // Arrange
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'op1',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:05:00Z',
        seconds: 300,
        operation: 'op2',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:10:00Z',
        seconds: 60,
        operation: 'op3',
      });

      // Act
      const stats = reportService.getFloodWaitStats();

      // Assert
      expect(stats.longestWait).toBe(300);
    });
  });

  describe('getFloodWaitEvents 方法', () => {
    it('應回傳所有記錄的事件', () => {
      // Arrange
      const event1: FloodWaitEvent = {
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      };
      const event2: FloodWaitEvent = {
        timestamp: '2024-01-15T10:01:00Z',
        seconds: 60,
        operation: 'getHistory',
      };

      reportService.recordFloodWait(event1);
      reportService.recordFloodWait(event2);

      // Act
      const events = reportService.getFloodWaitEvents();

      // Assert
      expect(events.length).toBe(2);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
    });

    it('應回傳事件的副本以避免外部修改', () => {
      // Arrange
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      });

      // Act
      const events = reportService.getFloodWaitEvents();
      events.push({
        timestamp: '2024-01-15T10:05:00Z',
        seconds: 100,
        operation: 'fake',
      });

      // Assert
      expect(reportService.getFloodWaitEvents().length).toBe(1);
    });
  });

  describe('clearEvents 方法', () => {
    it('應清除所有事件', () => {
      // Arrange
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:01:00Z',
        seconds: 60,
        operation: 'getHistory',
      });

      // Act
      reportService.clearEvents();

      // Assert
      const stats = reportService.getFloodWaitStats();
      expect(stats.totalEvents).toBe(0);
      expect(reportService.getFloodWaitEvents().length).toBe(0);
    });
  });

  describe('generateReport 方法', () => {
    it('應產生遷移報告', () => {
      // Arrange
      const mockProgress = createMockProgress();

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      expect(report).toBeDefined();
      expect(report.startedAt).toBeDefined();
      expect(report.completedAt).toBeDefined();
      expect(report.duration).toBeDefined();
    });

    it('報告應包含對話統計資訊', () => {
      // Arrange
      const mockProgress = createMockProgress();

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      expect(report.totalDialogs).toBe(5);
      expect(report.completedDialogs).toBe(3);
      expect(report.failedDialogs).toBe(1);
      expect(report.skippedDialogs).toBe(1);
    });

    it('報告應包含訊息統計資訊', () => {
      // Arrange
      const mockProgress = createMockProgress();

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      expect(report.totalMessages).toBe(1500);
      expect(report.migratedMessages).toBe(1000);
      expect(report.failedMessages).toBe(50);
    });

    it('報告應包含 FloodWait 摘要', () => {
      // Arrange
      // 建立沒有 FloodWait 事件的 progress
      const mockProgress = createMockProgressWithoutFloodWait();
      // 加入一些 FloodWait 事件到 reportService
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      });
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:10:00Z',
        seconds: 90,
        operation: 'forwardMessages',
      });

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      expect(report.floodWaitSummary).toBeDefined();
      expect(report.floodWaitSummary.totalEvents).toBe(2);
      expect(report.floodWaitSummary.totalWaitTime).toBe(120);
      expect(report.floodWaitSummary.longestWait).toBe(90);
    });

    it('報告應包含失敗對話清單', () => {
      // Arrange
      const mockProgress = createMockProgress();

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      expect(report.errors).toBeDefined();
      expect(report.errors.length).toBeGreaterThan(0);
      const failedEntry = report.errors.find((e) => e.dialogId === 'dialog_2');
      expect(failedEntry).toBeDefined();
      expect(failedEntry?.dialogName).toBe('Test Dialog 2');
    });

    it('報告應正確計算執行時間（秒）', () => {
      // Arrange
      const mockProgress = createMockProgress();
      // 開始時間: 2024-01-15T10:00:00Z
      // 更新時間: 2024-01-15T12:00:00Z
      // 差異: 2 小時 = 7200 秒

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      expect(report.duration).toBe(7200);
    });
  });

  describe('formatReportAsText 方法', () => {
    it('應產生人類可讀的文字報告', () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);

      // Act
      const text = reportService.formatReportAsText(report);

      // Assert
      expect(typeof text).toBe('string');
      expect(text.length).toBeGreaterThan(0);
    });

    it('文字報告應包含標題', () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);

      // Act
      const text = reportService.formatReportAsText(report);

      // Assert
      expect(text).toContain('遷移報告');
    });

    it('文字報告應包含統計摘要', () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);

      // Act
      const text = reportService.formatReportAsText(report);

      // Assert
      expect(text).toContain('對話');
      expect(text).toContain('訊息');
      expect(text).toMatch(/\d+/); // 包含數字
    });

    it('文字報告應包含 FloodWait 摘要（若有事件）', () => {
      // Arrange
      const mockProgress = createMockProgress();
      reportService.recordFloodWait({
        timestamp: '2024-01-15T10:00:00Z',
        seconds: 60,
        operation: 'forwardMessages',
      });
      const report = reportService.generateReport(mockProgress);

      // Act
      const text = reportService.formatReportAsText(report);

      // Assert
      expect(text).toContain('FloodWait');
    });

    it('文字報告應列出失敗的對話', () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);

      // Act
      const text = reportService.formatReportAsText(report);

      // Assert
      expect(text).toContain('失敗');
      expect(text).toContain('Test Dialog 2');
    });
  });

  describe('saveReportToFile 方法', () => {
    it('應成功儲存報告至檔案', async () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);

      // Act
      const result = await reportService.saveReportToFile(report, TEST_REPORT_PATH);

      // Assert
      expect(result.success).toBe(true);
      expect(fs.existsSync(TEST_REPORT_PATH)).toBe(true);
    });

    it('儲存的檔案內容應為文字報告', async () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);

      // Act
      await reportService.saveReportToFile(report, TEST_REPORT_PATH);

      // Assert
      const content = fs.readFileSync(TEST_REPORT_PATH, 'utf-8');
      expect(content).toContain('遷移報告');
      expect(content).toContain('對話');
    });

    it('應處理無效路徑錯誤', async () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);
      const invalidPath = '/nonexistent/directory/report.txt';

      // Act
      const result = await reportService.saveReportToFile(report, invalidPath);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });

    it('應自動建立父目錄', async () => {
      // Arrange
      const mockProgress = createMockProgress();
      const report = reportService.generateReport(mockProgress);
      const nestedPath = './test-reports/nested/report.txt';

      // Act
      const result = await reportService.saveReportToFile(report, nestedPath);

      // Assert
      expect(result.success).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);

      // Cleanup
      fs.unlinkSync(nestedPath);
      fs.rmdirSync('./test-reports/nested');
      fs.rmdirSync('./test-reports');
    });
  });

  describe('整合 MigrationProgress 中的 FloodWait 事件', () => {
    it('generateReport 應合併 progress 中的 floodWaitEvents', () => {
      // Arrange
      const mockProgress = createMockProgress();
      // progress 中已有 3 個事件 (總計 180 秒)
      // 再加入 1 個事件
      reportService.recordFloodWait({
        timestamp: '2024-01-15T12:00:00Z',
        seconds: 20,
        operation: 'createGroup',
      });

      // Act
      const report = reportService.generateReport(mockProgress);

      // Assert
      // 應合併 progress 中的 3 個事件 + reportService 中的 1 個事件
      expect(report.floodWaitSummary.totalEvents).toBe(4);
      expect(report.floodWaitSummary.totalWaitTime).toBe(200); // 180 + 20
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockProgressWithoutFloodWait(): MigrationProgress {
  const progress = createMockProgress();
  return {
    ...progress,
    floodWaitEvents: [],
    stats: {
      ...progress.stats,
      floodWaitCount: 0,
      totalFloodWaitSeconds: 0,
    },
  };
}

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

  const dialogs = new Map<string, DialogProgress>();
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
  dialogs.set('dialog_3', {
    dialogId: 'dialog_3',
    dialogName: 'Test Dialog 3',
    dialogType: 'supergroup',
    status: DialogStatus.Completed,
    targetGroupId: 'group_3',
    lastMessageId: 500,
    migratedCount: 500,
    totalCount: 500,
    errors: [],
    startedAt: '2024-01-15T10:20:00Z',
    completedAt: '2024-01-15T10:40:00Z',
  });
  dialogs.set('dialog_4', {
    dialogId: 'dialog_4',
    dialogName: 'Test Dialog 4',
    dialogType: 'channel',
    status: DialogStatus.Completed,
    targetGroupId: 'group_4',
    lastMessageId: 350,
    migratedCount: 350,
    totalCount: 350,
    errors: [],
    startedAt: '2024-01-15T10:45:00Z',
    completedAt: '2024-01-15T11:00:00Z',
  });
  dialogs.set('dialog_5', {
    dialogId: 'dialog_5',
    dialogName: 'Test Dialog 5',
    dialogType: 'bot',
    status: DialogStatus.Skipped,
    targetGroupId: null,
    lastMessageId: null,
    migratedCount: 0,
    totalCount: 450,
    errors: [],
    startedAt: null,
    completedAt: null,
  });

  return {
    version: '1.0',
    startedAt: '2024-01-15T10:00:00Z',
    updatedAt: '2024-01-15T12:00:00Z',
    sourceAccount: '+886912***678',
    targetAccount: '@user_b',
    currentPhase: MigrationPhase.Completed,
    dialogs,
    floodWaitEvents,
    stats,
  };
}
