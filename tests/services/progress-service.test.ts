/**
 * Task 5.1: 實作進度檔案讀寫
 *
 * TDD 測試 - 驗證 ProgressService 符合 design.md 與 interfaces.ts 規格
 *
 * Requirements: 6.1, 6.3, 6.6
 * - 設計 JSON 格式的進度檔案結構包含版本號與時間戳記
 * - 實作原子寫入機制：先寫入暫存檔再 rename 避免損毀
 * - 載入時驗證 JSON schema 與版本相容性
 * - 處理進度檔案不存在時回傳空狀態
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { IProgressService } from '../../src/types/index.js';
import {
  DialogStatus,
  DialogType,
  MigrationPhase,
} from '../../src/types/index.js';
import type {
  MigrationProgress,
  DialogProgress,
  MigrationStats,
  FloodWaitEvent,
} from '../../src/types/index.js';

// 測試用的臨時進度檔案路徑
const TEST_PROGRESS_PATH = './test-progress.json';
const TEST_PROGRESS_TMP_PATH = './test-progress.json.tmp';

describe('ProgressService', () => {
  let progressService: IProgressService;

  beforeEach(async () => {
    // 清除可能存在的測試檔案
    cleanupTestFiles();

    // 動態載入以確保每次測試使用新實例
    vi.resetModules();
    const { ProgressService } = await import(
      '../../src/services/progress-service.js'
    );
    progressService = new ProgressService();
  });

  afterEach(() => {
    cleanupTestFiles();
  });

  // ============================================================================
  // IProgressService 介面相容性
  // ============================================================================

  describe('IProgressService 介面相容性', () => {
    it('應實作 load 方法', () => {
      expect(typeof progressService.load).toBe('function');
    });

    it('應實作 save 方法', () => {
      expect(typeof progressService.save).toBe('function');
    });

    it('應實作 updateDialogProgress 方法', () => {
      expect(typeof progressService.updateDialogProgress).toBe('function');
    });

    it('應實作 markDialogComplete 方法', () => {
      expect(typeof progressService.markDialogComplete).toBe('function');
    });

    it('應實作 getDialogStatus 方法', () => {
      expect(typeof progressService.getDialogStatus).toBe('function');
    });

    it('應實作 exportProgress 方法', () => {
      expect(typeof progressService.exportProgress).toBe('function');
    });

    it('應實作 importProgress 方法', () => {
      expect(typeof progressService.importProgress).toBe('function');
    });
  });

  // ============================================================================
  // load 方法測試
  // ============================================================================

  describe('load 方法', () => {
    describe('當進度檔案不存在時', () => {
      it('應回傳空狀態（success）', async () => {
        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBeDefined();
          expect(result.data.dialogs.size).toBe(0);
        }
      });

      it('空狀態應包含正確的預設值', async () => {
        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          const progress = result.data;
          expect(progress.version).toBe('1.0');
          expect(progress.currentPhase).toBe(MigrationPhase.Idle);
          expect(progress.dialogs).toBeInstanceOf(Map);
          expect(progress.floodWaitEvents).toEqual([]);
          expect(progress.stats.totalDialogs).toBe(0);
          expect(progress.stats.completedDialogs).toBe(0);
        }
      });

      it('空狀態應包含當前時間作為 startedAt 與 updatedAt', async () => {
        // Arrange
        const beforeTime = new Date().toISOString();

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        const afterTime = new Date().toISOString();
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.startedAt >= beforeTime).toBe(true);
          expect(result.data.startedAt <= afterTime).toBe(true);
          expect(result.data.updatedAt >= beforeTime).toBe(true);
          expect(result.data.updatedAt <= afterTime).toBe(true);
        }
      });
    });

    describe('當進度檔案存在時', () => {
      it('應正確載入 JSON 格式的進度檔案', async () => {
        // Arrange
        const mockProgress = createMockProgressJson();
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(mockProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.version).toBe('1.0');
          expect(result.data.sourceAccount).toBe('+886912***678');
          expect(result.data.targetAccount).toBe('@user_b');
        }
      });

      it('應正確將 dialogs 物件轉換為 Map', async () => {
        // Arrange
        const mockProgress = createMockProgressJson();
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(mockProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.dialogs).toBeInstanceOf(Map);
          expect(result.data.dialogs.size).toBe(2);
          expect(result.data.dialogs.has('dialog_123')).toBe(true);
          expect(result.data.dialogs.has('dialog_456')).toBe(true);
        }
      });

      it('應正確載入 floodWaitEvents 陣列', async () => {
        // Arrange
        const mockProgress = createMockProgressJson();
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(mockProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.floodWaitEvents).toHaveLength(2);
          expect(result.data.floodWaitEvents[0].seconds).toBe(30);
          expect(result.data.floodWaitEvents[0].operation).toBe(
            'forwardMessages'
          );
        }
      });

      it('應正確載入 stats 物件', async () => {
        // Arrange
        const mockProgress = createMockProgressJson();
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(mockProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.stats.totalDialogs).toBe(10);
          expect(result.data.stats.completedDialogs).toBe(5);
          expect(result.data.stats.migratedMessages).toBe(25000);
        }
      });
    });

    describe('JSON schema 與版本驗證', () => {
      it('應驗證 version 欄位存在', async () => {
        // Arrange
        const invalidProgress = { dialogs: {} };
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(invalidProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('INVALID_FORMAT');
        }
      });

      it('應驗證版本相容性（支援 1.0 版本）', async () => {
        // Arrange
        const mockProgress = createMockProgressJson();
        mockProgress.version = '1.0';
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(mockProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(true);
      });

      it('應拒絕不支援的版本', async () => {
        // Arrange
        const mockProgress = createMockProgressJson();
        mockProgress.version = '2.0';
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(mockProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('INVALID_FORMAT');
          expect(result.error.message).toContain('version');
        }
      });

      it('應驗證 startedAt 欄位存在', async () => {
        // Arrange
        const invalidProgress = { version: '1.0', dialogs: {} };
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(invalidProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('INVALID_FORMAT');
        }
      });

      it('應驗證 dialogs 欄位存在', async () => {
        // Arrange
        const invalidProgress = {
          version: '1.0',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        fs.writeFileSync(TEST_PROGRESS_PATH, JSON.stringify(invalidProgress));

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('INVALID_FORMAT');
        }
      });
    });

    describe('錯誤處理', () => {
      it('應處理損毀的 JSON 檔案', async () => {
        // Arrange
        fs.writeFileSync(TEST_PROGRESS_PATH, '{ invalid json }');

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('FILE_CORRUPTED');
          expect(result.error.path).toBe(TEST_PROGRESS_PATH);
        }
      });

      it('應處理空檔案', async () => {
        // Arrange
        fs.writeFileSync(TEST_PROGRESS_PATH, '');

        // Act
        const result = await progressService.load(TEST_PROGRESS_PATH);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('FILE_CORRUPTED');
        }
      });
    });
  });

  // ============================================================================
  // save 方法測試
  // ============================================================================

  describe('save 方法', () => {
    it('應成功儲存進度至檔案', async () => {
      // Arrange
      const progress = createMockProgress();

      // Act
      const result = await progressService.save(TEST_PROGRESS_PATH, progress);

      // Assert
      expect(result.success).toBe(true);
      expect(fs.existsSync(TEST_PROGRESS_PATH)).toBe(true);
    });

    it('儲存的檔案應為有效的 JSON 格式', async () => {
      // Arrange
      const progress = createMockProgress();

      // Act
      await progressService.save(TEST_PROGRESS_PATH, progress);

      // Assert
      const content = fs.readFileSync(TEST_PROGRESS_PATH, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('應將 Map 轉換為物件格式儲存', async () => {
      // Arrange
      const progress = createMockProgress();
      progress.dialogs.set('dialog_test', createMockDialogProgress('dialog_test'));

      // Act
      await progressService.save(TEST_PROGRESS_PATH, progress);

      // Assert
      const content = fs.readFileSync(TEST_PROGRESS_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      expect(typeof parsed.dialogs).toBe('object');
      expect(parsed.dialogs['dialog_test']).toBeDefined();
    });

    it('應更新 updatedAt 時間戳記', async () => {
      // Arrange
      const progress = createMockProgress();
      const oldUpdatedAt = progress.updatedAt;

      // 等待一小段時間確保時間戳記不同
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Act
      await progressService.save(TEST_PROGRESS_PATH, progress);

      // Assert
      const content = fs.readFileSync(TEST_PROGRESS_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.updatedAt > oldUpdatedAt).toBe(true);
    });

    describe('原子寫入機制', () => {
      it('應先寫入暫存檔再 rename', async () => {
        // Arrange
        const progress = createMockProgress();
        let tmpFileExisted = false;

        // 監控 fs.rename 被呼叫
        const originalWriteFile = fs.promises.writeFile;
        vi.spyOn(fs.promises, 'writeFile').mockImplementation(
          async (filePath, data, options) => {
            if (String(filePath).endsWith('.tmp')) {
              tmpFileExisted = true;
            }
            return originalWriteFile(filePath, data, options);
          }
        );

        // Act
        await progressService.save(TEST_PROGRESS_PATH, progress);

        // Assert - 確認有使用暫存檔
        expect(tmpFileExisted).toBe(true);

        // Cleanup
        vi.restoreAllMocks();
      });

      it('儲存完成後暫存檔不應存在', async () => {
        // Arrange
        const progress = createMockProgress();

        // Act
        await progressService.save(TEST_PROGRESS_PATH, progress);

        // Assert
        expect(fs.existsSync(TEST_PROGRESS_TMP_PATH)).toBe(false);
        expect(fs.existsSync(TEST_PROGRESS_PATH)).toBe(true);
      });

      it('若 rename 失敗應回傳錯誤', async () => {
        // Arrange
        const progress = createMockProgress();
        vi.spyOn(fs.promises, 'rename').mockRejectedValue(
          new Error('Rename failed')
        );

        // Act
        const result = await progressService.save(TEST_PROGRESS_PATH, progress);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('WRITE_FAILED');
        }

        // Cleanup
        vi.restoreAllMocks();
      });
    });

    describe('錯誤處理', () => {
      it('應處理寫入失敗的情況', async () => {
        // Arrange
        const progress = createMockProgress();
        vi.spyOn(fs.promises, 'writeFile').mockRejectedValue(
          new Error('Write failed')
        );

        // Act
        const result = await progressService.save(TEST_PROGRESS_PATH, progress);

        // Assert
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('WRITE_FAILED');
          expect(result.error.path).toBe(TEST_PROGRESS_PATH);
        }

        // Cleanup
        vi.restoreAllMocks();
      });
    });
  });

  // ============================================================================
  // updateDialogProgress 方法測試
  // ============================================================================

  describe('updateDialogProgress 方法', () => {
    it('應更新對話的 lastMessageId', () => {
      // Arrange
      const progress = createMockProgress();
      progress.dialogs.set('dialog_1', createMockDialogProgress('dialog_1'));

      // Act
      const updated = progressService.updateDialogProgress(
        progress,
        'dialog_1',
        500,
        50
      );

      // Assert
      const dialogProgress = updated.dialogs.get('dialog_1');
      expect(dialogProgress?.lastMessageId).toBe(500);
    });

    it('應累加 migratedCount', () => {
      // Arrange
      const progress = createMockProgress();
      const dialog = createMockDialogProgress('dialog_1');
      dialog.migratedCount = 100;
      progress.dialogs.set('dialog_1', dialog);

      // Act
      const updated = progressService.updateDialogProgress(
        progress,
        'dialog_1',
        500,
        50
      );

      // Assert
      const dialogProgress = updated.dialogs.get('dialog_1');
      expect(dialogProgress?.migratedCount).toBe(150);
    });

    it('應設定對話狀態為 in_progress', () => {
      // Arrange
      const progress = createMockProgress();
      const dialog = createMockDialogProgress('dialog_1');
      dialog.status = DialogStatus.Pending;
      progress.dialogs.set('dialog_1', dialog);

      // Act
      const updated = progressService.updateDialogProgress(
        progress,
        'dialog_1',
        500,
        50
      );

      // Assert
      const dialogProgress = updated.dialogs.get('dialog_1');
      expect(dialogProgress?.status).toBe(DialogStatus.InProgress);
    });

    it('應更新整體 stats', () => {
      // Arrange
      const progress = createMockProgress();
      progress.stats.migratedMessages = 1000;
      progress.dialogs.set('dialog_1', createMockDialogProgress('dialog_1'));

      // Act
      const updated = progressService.updateDialogProgress(
        progress,
        'dialog_1',
        500,
        50
      );

      // Assert
      expect(updated.stats.migratedMessages).toBe(1050);
    });

    it('若對話不存在應回傳原始進度', () => {
      // Arrange
      const progress = createMockProgress();

      // Act
      const updated = progressService.updateDialogProgress(
        progress,
        'non_existent',
        500,
        50
      );

      // Assert
      expect(updated).toBe(progress);
    });
  });

  // ============================================================================
  // markDialogComplete 方法測試
  // ============================================================================

  describe('markDialogComplete 方法', () => {
    it('應將對話狀態設為 completed', () => {
      // Arrange
      const progress = createMockProgress();
      progress.dialogs.set('dialog_1', createMockDialogProgress('dialog_1'));

      // Act
      const updated = progressService.markDialogComplete(progress, 'dialog_1');

      // Assert
      const dialogProgress = updated.dialogs.get('dialog_1');
      expect(dialogProgress?.status).toBe(DialogStatus.Completed);
    });

    it('應設定 completedAt 時間戳記', () => {
      // Arrange
      const progress = createMockProgress();
      const dialog = createMockDialogProgress('dialog_1');
      dialog.completedAt = null;
      progress.dialogs.set('dialog_1', dialog);

      const beforeTime = new Date().toISOString();

      // Act
      const updated = progressService.markDialogComplete(progress, 'dialog_1');

      // Assert
      const afterTime = new Date().toISOString();
      const dialogProgress = updated.dialogs.get('dialog_1');
      expect(dialogProgress?.completedAt).not.toBeNull();
      expect(dialogProgress?.completedAt! >= beforeTime).toBe(true);
      expect(dialogProgress?.completedAt! <= afterTime).toBe(true);
    });

    it('應更新整體 stats 的 completedDialogs', () => {
      // Arrange
      const progress = createMockProgress();
      progress.stats.completedDialogs = 5;
      progress.dialogs.set('dialog_1', createMockDialogProgress('dialog_1'));

      // Act
      const updated = progressService.markDialogComplete(progress, 'dialog_1');

      // Assert
      expect(updated.stats.completedDialogs).toBe(6);
    });
  });

  // ============================================================================
  // getDialogStatus 方法測試
  // ============================================================================

  describe('getDialogStatus 方法', () => {
    it('應回傳對話的狀態', () => {
      // Arrange
      const progress = createMockProgress();
      const dialog = createMockDialogProgress('dialog_1');
      dialog.status = DialogStatus.InProgress;
      progress.dialogs.set('dialog_1', dialog);

      // Act
      const status = progressService.getDialogStatus(progress, 'dialog_1');

      // Assert
      expect(status).toBe(DialogStatus.InProgress);
    });

    it('若對話不存在應回傳 pending', () => {
      // Arrange
      const progress = createMockProgress();

      // Act
      const status = progressService.getDialogStatus(progress, 'non_existent');

      // Assert
      expect(status).toBe(DialogStatus.Pending);
    });
  });

  // ============================================================================
  // exportProgress 方法測試
  // ============================================================================

  describe('exportProgress 方法', () => {
    it('應將進度匯出為 JSON 字串', () => {
      // Arrange
      const progress = createMockProgress();

      // Act
      const exported = progressService.exportProgress(progress);

      // Assert
      expect(typeof exported).toBe('string');
      expect(() => JSON.parse(exported)).not.toThrow();
    });

    it('匯出的 JSON 應包含所有必要欄位', () => {
      // Arrange
      const progress = createMockProgress();
      progress.dialogs.set('dialog_1', createMockDialogProgress('dialog_1'));

      // Act
      const exported = progressService.exportProgress(progress);
      const parsed = JSON.parse(exported);

      // Assert
      expect(parsed.version).toBeDefined();
      expect(parsed.startedAt).toBeDefined();
      expect(parsed.updatedAt).toBeDefined();
      expect(parsed.dialogs).toBeDefined();
      expect(parsed.stats).toBeDefined();
    });

    it('應將 Map 轉換為物件', () => {
      // Arrange
      const progress = createMockProgress();
      progress.dialogs.set('dialog_1', createMockDialogProgress('dialog_1'));

      // Act
      const exported = progressService.exportProgress(progress);
      const parsed = JSON.parse(exported);

      // Assert
      expect(Array.isArray(parsed.dialogs)).toBe(false);
      expect(typeof parsed.dialogs).toBe('object');
    });
  });

  // ============================================================================
  // importProgress 方法測試
  // ============================================================================

  describe('importProgress 方法', () => {
    it('應從 JSON 字串匯入進度', () => {
      // Arrange
      const mockJson = JSON.stringify(createMockProgressJson());

      // Act
      const result = progressService.importProgress(mockJson);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe('1.0');
        expect(result.data.dialogs).toBeInstanceOf(Map);
      }
    });

    it('應驗證匯入資料的格式', () => {
      // Arrange
      const invalidJson = JSON.stringify({ invalid: 'data' });

      // Act
      const result = progressService.importProgress(invalidJson);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_FORMAT');
      }
    });

    it('應處理無效的 JSON 字串', () => {
      // Arrange
      const invalidJson = '{ not valid json }';

      // Act
      const result = progressService.importProgress(invalidJson);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_FORMAT');
      }
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function cleanupTestFiles(): void {
  if (fs.existsSync(TEST_PROGRESS_PATH)) {
    fs.unlinkSync(TEST_PROGRESS_PATH);
  }
  if (fs.existsSync(TEST_PROGRESS_TMP_PATH)) {
    fs.unlinkSync(TEST_PROGRESS_TMP_PATH);
  }
}

function createMockProgress(): MigrationProgress {
  const stats: MigrationStats = {
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
    version: '1.0',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceAccount: '+886912***678',
    targetAccount: '@user_b',
    currentPhase: MigrationPhase.Idle,
    dialogs: new Map(),
    floodWaitEvents: [],
    stats,
  };
}

function createMockDialogProgress(dialogId: string): DialogProgress {
  return {
    dialogId,
    dialogName: `Test Dialog ${dialogId}`,
    dialogType: DialogType.Private,
    status: DialogStatus.Pending,
    targetGroupId: null,
    lastMessageId: null,
    migratedCount: 0,
    totalCount: 100,
    errors: [],
    startedAt: null,
    completedAt: null,
  };
}

function createMockProgressJson(): Record<string, unknown> {
  return {
    version: '1.0',
    startedAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T12:30:00Z',
    sourceAccount: '+886912***678',
    targetAccount: '@user_b',
    currentPhase: MigrationPhase.MigratingMessages,
    dialogs: {
      dialog_123: {
        dialogId: 'dialog_123',
        dialogName: 'Test Dialog 1',
        dialogType: DialogType.Private,
        status: DialogStatus.Completed,
        targetGroupId: 'group_456',
        lastMessageId: 5000,
        migratedCount: 5000,
        totalCount: 5000,
        errors: [],
        startedAt: '2025-01-15T10:05:00Z',
        completedAt: '2025-01-15T11:00:00Z',
      },
      dialog_456: {
        dialogId: 'dialog_456',
        dialogName: 'Test Dialog 2',
        dialogType: DialogType.Group,
        status: DialogStatus.InProgress,
        targetGroupId: 'group_789',
        lastMessageId: 2500,
        migratedCount: 2500,
        totalCount: 5000,
        errors: [],
        startedAt: '2025-01-15T11:00:00Z',
        completedAt: null,
      },
    },
    floodWaitEvents: [
      {
        timestamp: '2025-01-15T10:30:00Z',
        seconds: 30,
        operation: 'forwardMessages',
      },
      {
        timestamp: '2025-01-15T11:15:00Z',
        seconds: 60,
        operation: 'getHistory',
      },
    ],
    stats: {
      totalDialogs: 10,
      completedDialogs: 5,
      failedDialogs: 0,
      skippedDialogs: 0,
      totalMessages: 50000,
      migratedMessages: 25000,
      failedMessages: 0,
      floodWaitCount: 2,
      totalFloodWaitSeconds: 90,
    },
  };
}
