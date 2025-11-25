/**
 * Task 4.1: 實作 Telegram 帳號驗證流程
 *
 * TDD 測試 - 驗證 AuthService 符合 design.md 與 interfaces.ts 規格
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 * - 初始化 GramJS TelegramClient 並設定連線參數
 * - 實作互動式驗證流程：電話號碼輸入、驗證碼請求、驗證碼驗證
 * - 處理驗證碼輸入錯誤並允許重新輸入
 * - 支援兩步驟驗證 (2FA) 密碼輸入流程
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { IAuthService } from '../../src/types/index.js';
import type { AuthConfig } from '../../src/types/index.js';
import * as fs from 'fs';

// Mock telegram module
vi.mock('telegram', () => {
  const mockClient = {
    connect: vi.fn(),
    start: vi.fn(),
    disconnect: vi.fn(),
    session: {
      save: vi.fn().mockReturnValue('mock-session-string'),
    },
    connected: false,
  };

  const MockStringSession = vi.fn().mockImplementation((session?: string) => ({
    _session: session || '',
  }));

  return {
    TelegramClient: vi.fn().mockImplementation(() => mockClient),
    sessions: {
      StringSession: MockStringSession,
    },
  };
});

// 測試用的設定
const TEST_SESSION_PATH = './test-session.txt';
const VALID_AUTH_CONFIG: AuthConfig = {
  apiId: 12345,
  apiHash: 'abcdef1234567890abcdef1234567890',
  sessionPath: TEST_SESSION_PATH,
  phoneNumber: '+886912345678',
  connectionRetries: 3,
  floodSleepThreshold: 300,
};

describe('AuthService', () => {
  let authService: IAuthService;

  beforeEach(async () => {
    // 清除可能存在的測試 session 檔案
    if (fs.existsSync(TEST_SESSION_PATH)) {
      fs.unlinkSync(TEST_SESSION_PATH);
    }

    // 重置 mocks
    vi.clearAllMocks();
    vi.resetModules();

    // 動態載入以確保每次測試使用新實例
    const { AuthService } = await import('../../src/services/auth-service.js');
    authService = new AuthService();
  });

  afterEach(() => {
    // 清理測試 session 檔案
    if (fs.existsSync(TEST_SESSION_PATH)) {
      fs.unlinkSync(TEST_SESSION_PATH);
    }
  });

  describe('IAuthService 介面相容性', () => {
    it('應實作 authenticate 方法', () => {
      expect(typeof authService.authenticate).toBe('function');
    });

    it('應實作 saveSession 方法', () => {
      expect(typeof authService.saveSession).toBe('function');
    });

    it('應實作 hasValidSession 方法', () => {
      expect(typeof authService.hasValidSession).toBe('function');
    });

    it('應實作 disconnect 方法', () => {
      expect(typeof authService.disconnect).toBe('function');
    });
  });

  describe('TelegramClient 初始化 (Requirement 1.1)', () => {
    it('應使用正確的 API ID 和 API Hash 初始化 TelegramClient', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockTelegramClient = TelegramClient as unknown as Mock;

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(mockTelegramClient).toHaveBeenCalledWith(
        expect.anything(), // StringSession
        VALID_AUTH_CONFIG.apiId,
        VALID_AUTH_CONFIG.apiHash,
        expect.objectContaining({
          connectionRetries: VALID_AUTH_CONFIG.connectionRetries,
        })
      );
    });

    it('應使用預設連線重試次數 5 當未指定時', async () => {
      // Arrange
      const configWithoutRetries: AuthConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        sessionPath: TEST_SESSION_PATH,
      };
      const { TelegramClient } = await import('telegram');
      const mockTelegramClient = TelegramClient as unknown as Mock;

      // Act
      await authService.authenticate(configWithoutRetries);

      // Assert
      expect(mockTelegramClient).toHaveBeenCalledWith(
        expect.anything(),
        configWithoutRetries.apiId,
        configWithoutRetries.apiHash,
        expect.objectContaining({
          connectionRetries: 5,
        })
      );
    });

    it('應設定 floodSleepThreshold 參數', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockTelegramClient = TelegramClient as unknown as Mock;

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(mockTelegramClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          floodSleepThreshold: VALID_AUTH_CONFIG.floodSleepThreshold,
        })
      );
    });

    it('應使用預設 floodSleepThreshold 300 當未指定時', async () => {
      // Arrange
      const configWithoutThreshold: AuthConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        sessionPath: TEST_SESSION_PATH,
      };
      const { TelegramClient } = await import('telegram');
      const mockTelegramClient = TelegramClient as unknown as Mock;

      // Act
      await authService.authenticate(configWithoutThreshold);

      // Assert
      expect(mockTelegramClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          floodSleepThreshold: 300,
        })
      );
    });
  });

  describe('互動式驗證流程 (Requirement 1.2)', () => {
    it('應呼叫 client.start() 進行驗證', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockClientInstance = new (TelegramClient as unknown as new () => {
        start: Mock;
        connect: Mock;
        session: { save: Mock };
      })();

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(mockClientInstance.start).toHaveBeenCalled();
    });

    it('應傳遞電話號碼給 client.start()', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockClientInstance = new (TelegramClient as unknown as new () => {
        start: Mock;
        connect: Mock;
        session: { save: Mock };
      })();

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      const startOptions = mockClientInstance.start.mock.calls[0][0];
      expect(startOptions.phoneNumber).toBeDefined();

      // phoneNumber 可能是函式或字串
      if (typeof startOptions.phoneNumber === 'function') {
        const phone = await startOptions.phoneNumber();
        expect(phone).toBe(VALID_AUTH_CONFIG.phoneNumber);
      } else {
        expect(startOptions.phoneNumber).toBe(VALID_AUTH_CONFIG.phoneNumber);
      }
    });

    it('應提供驗證碼輸入回呼 (phoneCode)', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockClientInstance = new (TelegramClient as unknown as new () => {
        start: Mock;
        connect: Mock;
        session: { save: Mock };
      })();

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      const startOptions = mockClientInstance.start.mock.calls[0][0];
      expect(startOptions.phoneCode).toBeDefined();
      expect(typeof startOptions.phoneCode).toBe('function');
    });

    it('驗證成功時應回傳包含 TelegramClient 的成功 Result', async () => {
      // Act
      const result = await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeDefined();
      }
    });
  });

  describe('驗證碼錯誤處理 (Requirement 1.3)', () => {
    it('驗證碼錯誤時應回傳 INVALID_CODE 錯誤', async () => {
      // Arrange
      vi.resetModules();

      // 重新 mock 以模擬驗證碼錯誤
      vi.doMock('telegram', () => {
        const mockClient = {
          connect: vi.fn(),
          start: vi.fn().mockRejectedValue({
            errorMessage: 'PHONE_CODE_INVALID',
          }),
          disconnect: vi.fn(),
          session: {
            save: vi.fn().mockReturnValue('mock-session-string'),
          },
          connected: false,
        };

        const MockStringSession = vi.fn().mockImplementation((session?: string) => ({
          _session: session || '',
        }));

        return {
          TelegramClient: vi.fn().mockImplementation(() => mockClient),
          sessions: {
            StringSession: MockStringSession,
          },
        };
      });

      const { AuthService } = await import('../../src/services/auth-service.js');
      const errorAuthService = new AuthService();

      // Act
      const result = await errorAuthService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CODE');
      }
    });
  });

  describe('兩步驟驗證 (2FA) 支援 (Requirement 1.4)', () => {
    it('應提供 2FA 密碼輸入回呼 (password)', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockClientInstance = new (TelegramClient as unknown as new () => {
        start: Mock;
        connect: Mock;
        session: { save: Mock };
      })();

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      const startOptions = mockClientInstance.start.mock.calls[0][0];
      expect(startOptions.password).toBeDefined();
      expect(typeof startOptions.password).toBe('function');
    });

    it('2FA 密碼錯誤時應回傳 INVALID_2FA 錯誤', async () => {
      // Arrange
      vi.resetModules();

      // 重新 mock 以模擬 2FA 錯誤
      vi.doMock('telegram', () => {
        const mockClient = {
          connect: vi.fn(),
          start: vi.fn().mockRejectedValue({
            errorMessage: 'PASSWORD_HASH_INVALID',
          }),
          disconnect: vi.fn(),
          session: {
            save: vi.fn().mockReturnValue('mock-session-string'),
          },
          connected: false,
        };

        const MockStringSession = vi.fn().mockImplementation((session?: string) => ({
          _session: session || '',
        }));

        return {
          TelegramClient: vi.fn().mockImplementation(() => mockClient),
          sessions: {
            StringSession: MockStringSession,
          },
        };
      });

      const { AuthService } = await import('../../src/services/auth-service.js');
      const errorAuthService = new AuthService();

      // Act
      const result = await errorAuthService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_2FA');
      }
    });
  });

  describe('Session 管理', () => {
    it('hasValidSession 應在 session 檔案不存在時回傳 false', async () => {
      // Act
      const result = await authService.hasValidSession(TEST_SESSION_PATH);

      // Assert
      expect(result).toBe(false);
    });

    it('hasValidSession 應在 session 檔案存在且有內容時回傳 true', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, 'valid-session-content');

      // Act
      const result = await authService.hasValidSession(TEST_SESSION_PATH);

      // Assert
      expect(result).toBe(true);
    });

    it('hasValidSession 應在 session 檔案為空時回傳 false', async () => {
      // Arrange
      fs.writeFileSync(TEST_SESSION_PATH, '');

      // Act
      const result = await authService.hasValidSession(TEST_SESSION_PATH);

      // Assert
      expect(result).toBe(false);
    });

    it('saveSession 應將 session 寫入檔案', async () => {
      // Arrange
      const mockClient = {
        session: {
          save: vi.fn().mockReturnValue('saved-session-string'),
        },
      };

      // Act
      const result = await authService.saveSession(
        mockClient as unknown as Parameters<IAuthService['saveSession']>[0],
        TEST_SESSION_PATH
      );

      // Assert
      expect(result.success).toBe(true);
      const savedContent = fs.readFileSync(TEST_SESSION_PATH, 'utf-8');
      expect(savedContent).toBe('saved-session-string');
    });

    it('saveSession 檔案寫入失敗時應回傳錯誤', async () => {
      // Arrange
      const mockClient = {
        session: {
          save: vi.fn().mockReturnValue('session-string'),
        },
      };
      const invalidPath = '/invalid/path/that/does/not/exist/session.txt';

      // Act
      const result = await authService.saveSession(
        mockClient as unknown as Parameters<IAuthService['saveSession']>[0],
        invalidPath
      );

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('WRITE_FAILED');
      }
    });
  });

  describe('disconnect 方法', () => {
    it('應呼叫 client.disconnect()', async () => {
      // Arrange
      const mockClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      // Act
      await authService.disconnect(
        mockClient as unknown as Parameters<IAuthService['disconnect']>[0]
      );

      // Assert
      expect(mockClient.disconnect).toHaveBeenCalled();
    });

    it('應不拋出錯誤當 disconnect 成功', async () => {
      // Arrange
      const mockClient = {
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      // Act & Assert
      await expect(
        authService.disconnect(mockClient as unknown as Parameters<IAuthService['disconnect']>[0])
      ).resolves.not.toThrow();
    });
  });

  describe('既有 Session 重新連線', () => {
    it('應在 session 檔案存在時使用既有 session 初始化', async () => {
      // Arrange
      const existingSession = 'existing-session-string';
      fs.writeFileSync(TEST_SESSION_PATH, existingSession);

      const { sessions } = await import('telegram');
      const mockStringSession = sessions.StringSession as unknown as Mock;

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(mockStringSession).toHaveBeenCalledWith(existingSession);
    });

    it('應在 session 檔案不存在時使用空 session 初始化', async () => {
      // Arrange - 確保檔案不存在
      if (fs.existsSync(TEST_SESSION_PATH)) {
        fs.unlinkSync(TEST_SESSION_PATH);
      }

      const { sessions } = await import('telegram');
      const mockStringSession = sessions.StringSession as unknown as Mock;

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(mockStringSession).toHaveBeenCalledWith('');
    });
  });

  describe('錯誤處理', () => {
    it('網路錯誤時應回傳 NETWORK_ERROR', async () => {
      // Arrange
      vi.resetModules();

      vi.doMock('telegram', () => {
        const mockClient = {
          connect: vi.fn(),
          start: vi.fn().mockRejectedValue(new Error('Network error')),
          disconnect: vi.fn(),
          session: {
            save: vi.fn().mockReturnValue('mock-session-string'),
          },
          connected: false,
        };

        const MockStringSession = vi.fn().mockImplementation((session?: string) => ({
          _session: session || '',
        }));

        return {
          TelegramClient: vi.fn().mockImplementation(() => mockClient),
          sessions: {
            StringSession: MockStringSession,
          },
        };
      });

      const { AuthService } = await import('../../src/services/auth-service.js');
      const errorAuthService = new AuthService();

      // Act
      const result = await errorAuthService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
      }
    });

    it('Session 過期時應回傳 SESSION_EXPIRED', async () => {
      // Arrange
      vi.resetModules();

      vi.doMock('telegram', () => {
        const mockClient = {
          connect: vi.fn(),
          start: vi.fn().mockRejectedValue({
            errorMessage: 'AUTH_KEY_UNREGISTERED',
          }),
          disconnect: vi.fn(),
          session: {
            save: vi.fn().mockReturnValue('mock-session-string'),
          },
          connected: false,
        };

        const MockStringSession = vi.fn().mockImplementation((session?: string) => ({
          _session: session || '',
        }));

        return {
          TelegramClient: vi.fn().mockImplementation(() => mockClient),
          sessions: {
            StringSession: MockStringSession,
          },
        };
      });

      const { AuthService } = await import('../../src/services/auth-service.js');
      const errorAuthService = new AuthService();

      // Act
      const result = await errorAuthService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SESSION_EXPIRED');
      }
    });
  });

  describe('onError 回呼', () => {
    it('應提供 onError 回呼給 client.start()', async () => {
      // Arrange
      const { TelegramClient } = await import('telegram');
      const mockClientInstance = new (TelegramClient as unknown as new () => {
        start: Mock;
        connect: Mock;
        session: { save: Mock };
      })();

      // Act
      await authService.authenticate(VALID_AUTH_CONFIG);

      // Assert
      const startOptions = mockClientInstance.start.mock.calls[0][0];
      expect(startOptions.onError).toBeDefined();
      expect(typeof startOptions.onError).toBe('function');
    });
  });
});
