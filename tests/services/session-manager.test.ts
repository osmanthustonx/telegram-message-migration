/**
 * Task 4.2: 實作 Session 管理與自動重連
 *
 * TDD 測試 - 驗證 SessionManager 符合 design.md 規格
 *
 * Requirements: 1.5, 1.6
 * - 使用 StringSession 將驗證狀態序列化儲存至檔案
 * - 程式啟動時檢查並載入既有 session 以跳過驗證
 * - 實作網路中斷時的自動重連機制（最多 3 次）
 * - 設定 session 檔案權限為 600 避免敏感資料外洩
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { TelegramClient } from 'telegram';

// 測試用的路徑
const TEST_SESSION_DIR = './test-sessions';
const TEST_SESSION_PATH = path.join(TEST_SESSION_DIR, 'test-session.txt');

// Mock telegram module
vi.mock('telegram', () => {
  const mockClient = {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    session: {
      save: vi.fn().mockReturnValue('mock-session-string-1234567890abcdef'),
    },
    connected: true,
  };

  const MockStringSession = vi.fn().mockImplementation((session?: string) => ({
    _session: session || '',
    save: vi.fn().mockReturnValue(session || ''),
  }));

  return {
    TelegramClient: vi.fn().mockImplementation(() => mockClient),
    sessions: {
      StringSession: MockStringSession,
    },
  };
});

describe('SessionManager', () => {
  let sessionManager: import('../../src/services/session-manager.js').SessionManager;

  beforeEach(async () => {
    // 清除可能存在的測試目錄
    if (fs.existsSync(TEST_SESSION_DIR)) {
      fs.rmSync(TEST_SESSION_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_SESSION_DIR, { recursive: true });

    // 重置 mocks
    vi.clearAllMocks();

    // 動態載入以確保每次測試使用新實例
    const { SessionManager } = await import('../../src/services/session-manager.js');
    sessionManager = new SessionManager();
  });

  afterEach(() => {
    // 清理測試目錄
    if (fs.existsSync(TEST_SESSION_DIR)) {
      fs.rmSync(TEST_SESSION_DIR, { recursive: true });
    }
  });

  describe('ISessionManager 介面相容性', () => {
    it('應實作 saveSession 方法', () => {
      expect(typeof sessionManager.saveSession).toBe('function');
    });

    it('應實作 loadSession 方法', () => {
      expect(typeof sessionManager.loadSession).toBe('function');
    });

    it('應實作 deleteSession 方法', () => {
      expect(typeof sessionManager.deleteSession).toBe('function');
    });

    it('應實作 sessionExists 方法', () => {
      expect(typeof sessionManager.sessionExists).toBe('function');
    });

    it('應實作 validateSessionPermissions 方法', () => {
      expect(typeof sessionManager.validateSessionPermissions).toBe('function');
    });
  });

  describe('Session 儲存 (Requirement 1.5)', () => {
    it('應將 session 字串儲存至檔案', async () => {
      // Arrange
      const sessionString = 'test-session-string-1234567890';

      // Act
      const result = await sessionManager.saveSession(sessionString, TEST_SESSION_PATH);

      // Assert
      expect(result.success).toBe(true);
      expect(fs.existsSync(TEST_SESSION_PATH)).toBe(true);
      const savedContent = fs.readFileSync(TEST_SESSION_PATH, 'utf-8');
      expect(savedContent).toBe(sessionString);
    });

    it('應設定 session 檔案權限為 600 (owner read/write only)', async () => {
      // Arrange
      const sessionString = 'test-session-string';

      // Act
      await sessionManager.saveSession(sessionString, TEST_SESSION_PATH);

      // Assert
      const stats = fs.statSync(TEST_SESSION_PATH);
      // 0o600 = 384 in decimal, check mode bits (last 9 bits)
      const permissions = stats.mode & 0o777;
      expect(permissions).toBe(0o600);
    });

    it('應自動建立不存在的父目錄', async () => {
      // Arrange
      const nestedPath = path.join(TEST_SESSION_DIR, 'nested', 'deep', 'session.txt');
      const sessionString = 'nested-session';

      // Act
      const result = await sessionManager.saveSession(sessionString, nestedPath);

      // Assert
      expect(result.success).toBe(true);
      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('應使用原子寫入（先寫暫存檔再 rename）避免損毀', async () => {
      // Arrange
      const sessionString = 'atomic-write-session';

      // 在寫入期間檢查暫存檔是否存在
      // 驗證方式：成功寫入後，確認檔案內容正確且無暫存檔殘留
      await sessionManager.saveSession(sessionString, TEST_SESSION_PATH);

      // Assert - 驗證最終檔案存在且內容正確
      expect(fs.existsSync(TEST_SESSION_PATH)).toBe(true);
      const content = fs.readFileSync(TEST_SESSION_PATH, 'utf-8');
      expect(content).toBe(sessionString);

      // 驗證沒有暫存檔殘留（以 .tmp. 開頭的檔案）
      const dir = path.dirname(TEST_SESSION_PATH);
      const files = fs.readdirSync(dir);
      const tempFiles = files.filter((f) => f.includes('.tmp.'));
      expect(tempFiles.length).toBe(0);
    });

    it('寫入失敗時應回傳 WRITE_FAILED 錯誤', async () => {
      // Arrange
      const invalidPath = '/root/cannot/write/here/session.txt';
      const sessionString = 'will-fail';

      // Act
      const result = await sessionManager.saveSession(sessionString, invalidPath);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('WRITE_FAILED');
      }
    });
  });

  describe('Session 載入 (Requirement 1.5)', () => {
    it('應讀取並回傳既有 session 檔案內容', async () => {
      // Arrange
      const sessionContent = 'existing-session-content-12345';
      fs.writeFileSync(TEST_SESSION_PATH, sessionContent, { mode: 0o600 });

      // Act
      const result = await sessionManager.loadSession(TEST_SESSION_PATH);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(sessionContent);
      }
    });

    it('Session 檔案不存在時應回傳 null（不是錯誤）', async () => {
      // Arrange
      const nonExistentPath = path.join(TEST_SESSION_DIR, 'non-existent.txt');

      // Act
      const result = await sessionManager.loadSession(nonExistentPath);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('Session 檔案為空時應回傳 null', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, '', { mode: 0o600 });

      // Act
      const result = await sessionManager.loadSession(TEST_SESSION_PATH);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeNull();
      }
    });

    it('讀取失敗時應回傳 READ_FAILED 錯誤', async () => {
      // Arrange - 建立一個目錄而非檔案，導致讀取失敗
      const dirPath = path.join(TEST_SESSION_DIR, 'is-a-directory');
      fs.mkdirSync(dirPath, { recursive: true });

      // Act
      const result = await sessionManager.loadSession(dirPath);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('READ_FAILED');
      }
    });
  });

  describe('Session 刪除', () => {
    it('應成功刪除既有 session 檔案', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, 'to-be-deleted', { mode: 0o600 });

      // Act
      const result = await sessionManager.deleteSession(TEST_SESSION_PATH);

      // Assert
      expect(result.success).toBe(true);
      expect(fs.existsSync(TEST_SESSION_PATH)).toBe(false);
    });

    it('Session 檔案不存在時應回傳成功（idempotent）', async () => {
      // Arrange
      const nonExistentPath = path.join(TEST_SESSION_DIR, 'non-existent.txt');

      // Act
      const result = await sessionManager.deleteSession(nonExistentPath);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('Session 存在檢查', () => {
    it('Session 檔案存在且有內容時應回傳 true', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, 'valid-session', { mode: 0o600 });

      // Act
      const exists = await sessionManager.sessionExists(TEST_SESSION_PATH);

      // Assert
      expect(exists).toBe(true);
    });

    it('Session 檔案不存在時應回傳 false', async () => {
      // Arrange
      const nonExistentPath = path.join(TEST_SESSION_DIR, 'non-existent.txt');

      // Act
      const exists = await sessionManager.sessionExists(nonExistentPath);

      // Assert
      expect(exists).toBe(false);
    });

    it('Session 檔案為空時應回傳 false', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, '', { mode: 0o600 });

      // Act
      const exists = await sessionManager.sessionExists(TEST_SESSION_PATH);

      // Assert
      expect(exists).toBe(false);
    });
  });

  describe('Session 權限驗證', () => {
    it('權限為 600 時應回傳 valid: true', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, 'secure-session', { mode: 0o600 });

      // Act
      const result = await sessionManager.validateSessionPermissions(TEST_SESSION_PATH);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });

    it('權限過於寬鬆時應回傳警告', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, 'insecure-session', { mode: 0o644 });

      // Act
      const result = await sessionManager.validateSessionPermissions(TEST_SESSION_PATH);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('權限');
    });

    it('檔案不存在時應回傳 valid: false', async () => {
      // Arrange
      const nonExistentPath = path.join(TEST_SESSION_DIR, 'non-existent.txt');

      // Act
      const result = await sessionManager.validateSessionPermissions(nonExistentPath);

      // Assert
      expect(result.valid).toBe(false);
    });
  });
});

describe('ReconnectionManager', () => {
  let reconnectionManager: import('../../src/services/session-manager.js').ReconnectionManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    const { ReconnectionManager } = await import('../../src/services/session-manager.js');
    reconnectionManager = new ReconnectionManager();
  });

  describe('IReconnectionManager 介面相容性', () => {
    it('應實作 attemptReconnect 方法', () => {
      expect(typeof reconnectionManager.attemptReconnect).toBe('function');
    });

    it('應實作 getReconnectAttempts 方法', () => {
      expect(typeof reconnectionManager.getReconnectAttempts).toBe('function');
    });

    it('應實作 resetAttempts 方法', () => {
      expect(typeof reconnectionManager.resetAttempts).toBe('function');
    });

    it('應實作 onReconnectStatus 方法', () => {
      expect(typeof reconnectionManager.onReconnectStatus).toBe('function');
    });
  });

  describe('自動重連機制 (Requirement 1.6)', () => {
    it('連線成功時應回傳成功', async () => {
      // Arrange
      const mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        connected: true,
      } as unknown as TelegramClient;

      // Act
      const result = await reconnectionManager.attemptReconnect(mockClient);

      // Assert
      expect(result.success).toBe(true);
    });

    it('第一次連線失敗後應自動重試', async () => {
      // Arrange
      let callCount = 0;
      const mockClient = {
        connect: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('Network error'));
          }
          return Promise.resolve(undefined);
        }),
        connected: true,
      } as unknown as TelegramClient;

      // Act
      const result = await reconnectionManager.attemptReconnect(mockClient);

      // Assert
      expect(result.success).toBe(true);
      expect(mockClient.connect).toHaveBeenCalledTimes(2);
    });

    it('應最多重試 3 次', async () => {
      // Arrange
      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Persistent network error')),
        connected: false,
      } as unknown as TelegramClient;

      // Act
      const result = await reconnectionManager.attemptReconnect(mockClient);

      // Assert
      expect(result.success).toBe(false);
      expect(mockClient.connect).toHaveBeenCalledTimes(3);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
        expect(result.error.retryCount).toBe(3);
      }
    });

    it('應在重試之間使用指數退避等待', async () => {
      // Arrange
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
        if (ms && ms > 0) {
          delays.push(ms);
        }
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Network error')),
        connected: false,
      } as unknown as TelegramClient;

      // Act
      await reconnectionManager.attemptReconnect(mockClient);

      // Assert - 指數退避: 1000ms, 2000ms (第3次失敗後不再等待)
      expect(delays.length).toBeGreaterThanOrEqual(2);
      expect(delays[0]).toBe(1000); // 第一次重試前等待 1 秒
      expect(delays[1]).toBe(2000); // 第二次重試前等待 2 秒

      vi.mocked(global.setTimeout).mockRestore();
    });

    it('應追蹤重連嘗試次數', async () => {
      // Arrange
      let callCount = 0;
      const mockClient = {
        connect: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount < 3) {
            return Promise.reject(new Error('Network error'));
          }
          return Promise.resolve(undefined);
        }),
        connected: true,
      } as unknown as TelegramClient;

      // Act
      await reconnectionManager.attemptReconnect(mockClient);

      // Assert
      expect(reconnectionManager.getReconnectAttempts()).toBe(2); // 2 次失敗後第 3 次成功
    });

    it('resetAttempts 應重置嘗試次數', async () => {
      // Arrange
      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Network error')),
        connected: false,
      } as unknown as TelegramClient;
      await reconnectionManager.attemptReconnect(mockClient);

      // Act
      reconnectionManager.resetAttempts();

      // Assert
      expect(reconnectionManager.getReconnectAttempts()).toBe(0);
    });
  });

  describe('重連狀態回呼', () => {
    it('應在每次重連嘗試時觸發 onReconnectStatus 回呼', async () => {
      // Arrange
      const statusCallback = vi.fn();
      reconnectionManager.onReconnectStatus(statusCallback);

      let callCount = 0;
      const mockClient = {
        connect: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('Network error'));
          }
          return Promise.resolve(undefined);
        }),
        connected: true,
      } as unknown as TelegramClient;

      // Act
      await reconnectionManager.attemptReconnect(mockClient);

      // Assert
      expect(statusCallback).toHaveBeenCalled();
      const calls = statusCallback.mock.calls;
      // 應該有失敗的狀態更新
      expect(calls.some((call: unknown[]) => (call[0] as { status: string }).status === 'attempting')).toBe(true);
      // 應該有成功的狀態更新
      expect(calls.some((call: unknown[]) => (call[0] as { status: string }).status === 'connected')).toBe(true);
    });

    it('達到最大重試次數時應觸發 failed 狀態', async () => {
      // Arrange
      const statusCallback = vi.fn();
      reconnectionManager.onReconnectStatus(statusCallback);

      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Persistent error')),
        connected: false,
      } as unknown as TelegramClient;

      // Act
      await reconnectionManager.attemptReconnect(mockClient);

      // Assert
      const calls = statusCallback.mock.calls;
      expect(calls.some((call: unknown[]) => (call[0] as { status: string }).status === 'failed')).toBe(true);
    });
  });

  describe('自訂重連配置', () => {
    it('應支援自訂最大重試次數', async () => {
      // Arrange - Mock setTimeout to avoid actual delays
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      const { ReconnectionManager } = await import('../../src/services/session-manager.js');
      const customManager = new ReconnectionManager({ maxRetries: 5 });

      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Network error')),
        connected: false,
      } as unknown as TelegramClient;

      // Act
      await customManager.attemptReconnect(mockClient);

      // Assert
      expect(mockClient.connect).toHaveBeenCalledTimes(5);

      vi.mocked(global.setTimeout).mockRestore();
    });

    it('應支援自訂初始延遲時間', async () => {
      // Arrange
      const delays: number[] = [];
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void, ms?: number) => {
        if (ms && ms > 0) {
          delays.push(ms);
        }
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      });

      const { ReconnectionManager } = await import('../../src/services/session-manager.js');
      const customManager = new ReconnectionManager({ initialDelayMs: 500 });

      const mockClient = {
        connect: vi.fn().mockRejectedValue(new Error('Network error')),
        connected: false,
      } as unknown as TelegramClient;

      // Act
      await customManager.attemptReconnect(mockClient);

      // Assert
      expect(delays[0]).toBe(500);

      vi.mocked(global.setTimeout).mockRestore();
    });
  });
});
