/**
 * Task 2.1: 實作設定載入服務
 *
 * TDD 測試 - 驗證 ConfigLoader 符合 design.md 與 interfaces.ts 規格
 *
 * Requirements: 8.2, 8.4, 8.5
 * - 從環境變數與設定檔讀取 API ID、API Hash 等敏感資訊
 * - 驗證必要設定欄位存在且格式正確
 * - 提供預設值：批次大小 100、群組名稱前綴 "[Migrated] "、FloodWait 門檻 300 秒
 * - 支援對話過濾條件與日期範圍設定
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppConfig, IConfigLoader, ConfigError, Result } from '../../src/types/index.js';
import { LogLevel } from '../../src/types/index.js';

describe('ConfigLoader Service', () => {
  // 備份原始環境變數
  const originalEnv = process.env;

  beforeEach(() => {
    // 重置環境變數
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('環境變數讀取', () => {
    it('應從環境變數讀取必要設定', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiId).toBe(12345);
        expect(result.data.apiHash).toBe('abcdef1234567890abcdef1234567890');
        expect(result.data.phoneNumberA).toBe('+886912345678');
        expect(result.data.targetUserB).toBe('@user_b');
      }
    });

    it('應從環境變數讀取選填設定', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';
      process.env.TG_SESSION_PATH = './custom-session.txt';
      process.env.TG_PROGRESS_PATH = './custom-progress.json';
      process.env.TG_BATCH_SIZE = '50';
      process.env.TG_BATCH_DELAY = '2000';
      process.env.TG_FLOOD_WAIT_THRESHOLD = '600';
      process.env.TG_GROUP_PREFIX = '[Backup] ';
      process.env.TG_LOG_LEVEL = 'debug';
      process.env.TG_LOG_FILE = './custom.log';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sessionPath).toBe('./custom-session.txt');
        expect(result.data.progressPath).toBe('./custom-progress.json');
        expect(result.data.batchSize).toBe(50);
        expect(result.data.batchDelay).toBe(2000);
        expect(result.data.floodWaitThreshold).toBe(600);
        expect(result.data.groupNamePrefix).toBe('[Backup] ');
        expect(result.data.logLevel).toBe(LogLevel.Debug);
        expect(result.data.logFilePath).toBe('./custom.log');
      }
    });
  });

  describe('必要欄位驗證', () => {
    it('缺少 TG_API_ID 時應回傳錯誤', async () => {
      // Arrange - 不設定 TG_API_ID
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.field).toBe('apiId');
      }
    });

    it('缺少 TG_API_HASH 時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.field).toBe('apiHash');
      }
    });

    it('缺少 TG_PHONE_A 時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.field).toBe('phoneNumberA');
      }
    });

    it('缺少 TG_TARGET_USER_B 時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.field).toBe('targetUserB');
      }
    });
  });

  describe('格式驗證', () => {
    it('API ID 非數字時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = 'not-a-number';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('apiId');
      }
    });

    it('API ID 為負數時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '-12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('apiId');
      }
    });

    it('API Hash 長度不正確時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'tooshort';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('apiHash');
      }
    });

    it('API Hash 包含非十六進位字元時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'ghijkl1234567890ghijkl1234567890'; // g-k 不是十六進位
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('apiHash');
      }
    });

    it('批次大小為非正整數時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';
      process.env.TG_BATCH_SIZE = '0';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('batchSize');
      }
    });

    it('日誌等級無效時應回傳錯誤', async () => {
      // Arrange
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';
      process.env.TG_LOG_LEVEL = 'invalid';

      // Act
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      // Assert
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('logLevel');
      }
    });
  });

  describe('預設值', () => {
    beforeEach(() => {
      // 設定必要欄位
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';
    });

    it('批次大小預設值應為 100', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.batchSize).toBe(100);
      }
    });

    it('批次延遲預設值應為 1000 毫秒', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.batchDelay).toBe(1000);
      }
    });

    it('FloodWait 門檻預設值應為 300 秒', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.floodWaitThreshold).toBe(300);
      }
    });

    it('群組名稱前綴預設值應為 "[Migrated] "', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.groupNamePrefix).toBe('[Migrated] ');
      }
    });

    it('日誌等級預設值應為 info', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.logLevel).toBe(LogLevel.Info);
      }
    });

    it('Session 路徑預設值應為 "./session.txt"', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sessionPath).toBe('./session.txt');
      }
    });

    it('進度檔案路徑預設值應為 "./progress.json"', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.progressPath).toBe('./progress.json');
      }
    });

    it('日誌檔案路徑預設值應為 "./migration.log"', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.logFilePath).toBe('./migration.log');
      }
    });
  });

  describe('validate 方法', () => {
    it('應驗證部分設定並回傳完整設定', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();

      const partialConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        phoneNumberA: '+886912345678',
        targetUserB: '@user_b',
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.apiId).toBe(12345);
        expect(result.data.batchSize).toBe(100); // 預設值
        expect(result.data.groupNamePrefix).toBe('[Migrated] '); // 預設值
      }
    });

    it('部分設定缺少必要欄位時應回傳錯誤', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();

      const partialConfig = {
        apiId: 12345,
        // 缺少 apiHash, phoneNumberA, targetUserB
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
      }
    });

    it('部分設定包含無效值時應回傳錯誤', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();

      const partialConfig = {
        apiId: -1, // 無效值
        apiHash: 'abcdef1234567890abcdef1234567890',
        phoneNumberA: '+886912345678',
        targetUserB: '@user_b',
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_VALUE');
        expect(result.error.field).toBe('apiId');
      }
    });
  });

  describe('對話過濾條件支援', () => {
    beforeEach(() => {
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';
    });

    it('應從環境變數讀取 TG_EXCLUDE_TYPES', async () => {
      process.env.TG_EXCLUDE_TYPES = 'bot,channel';

      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const { DialogType } = await import('../../src/types/index.js');
      const loader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dialogFilter).toBeDefined();
        expect(result.data.dialogFilter?.excludeTypes).toEqual([DialogType.Bot, DialogType.Channel]);
      }
    });

    it('應從環境變數讀取 TG_INCLUDE_TYPES', async () => {
      process.env.TG_INCLUDE_TYPES = 'private,group';

      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const { DialogType } = await import('../../src/types/index.js');
      const loader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dialogFilter).toBeDefined();
        expect(result.data.dialogFilter?.includeTypes).toEqual([DialogType.Private, DialogType.Group]);
      }
    });

    it('應同時支援 TG_EXCLUDE_TYPES 和 TG_INCLUDE_TYPES', async () => {
      process.env.TG_EXCLUDE_TYPES = 'bot';
      process.env.TG_INCLUDE_TYPES = 'private,group,supergroup';

      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const { DialogType } = await import('../../src/types/index.js');
      const loader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dialogFilter?.excludeTypes).toEqual([DialogType.Bot]);
        expect(result.data.dialogFilter?.includeTypes).toEqual([
          DialogType.Private,
          DialogType.Group,
          DialogType.Supergroup,
        ]);
      }
    });

    it('應忽略無效的對話類型', async () => {
      process.env.TG_EXCLUDE_TYPES = 'bot,invalid,channel';

      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const { DialogType } = await import('../../src/types/index.js');
      const loader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        // 'invalid' 應被忽略
        expect(result.data.dialogFilter?.excludeTypes).toEqual([DialogType.Bot, DialogType.Channel]);
      }
    });

    it('空白的環境變數應不設定過濾條件', async () => {
      process.env.TG_EXCLUDE_TYPES = '';

      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader = new ConfigLoader();
      const result = loader.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dialogFilter).toBeUndefined();
      }
    });

    it('應支援透過 validate 設定對話過濾條件', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const { DialogType } = await import('../../src/types/index.js');
      const loader: IConfigLoader = new ConfigLoader();

      const partialConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        phoneNumberA: '+886912345678',
        targetUserB: '@user_b',
        dialogFilter: {
          includeIds: ['123', '456'],
          excludeIds: ['789'],
          types: [DialogType.Private, DialogType.Group],
        },
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dialogFilter).toBeDefined();
        expect(result.data.dialogFilter?.includeIds).toEqual(['123', '456']);
        expect(result.data.dialogFilter?.excludeIds).toEqual(['789']);
        expect(result.data.dialogFilter?.types).toEqual([DialogType.Private, DialogType.Group]);
      }
    });
  });

  describe('日期範圍支援', () => {
    beforeEach(() => {
      process.env.TG_API_ID = '12345';
      process.env.TG_API_HASH = 'abcdef1234567890abcdef1234567890';
      process.env.TG_PHONE_A = '+886912345678';
      process.env.TG_TARGET_USER_B = '@user_b';
    });

    it('應支援透過 validate 設定日期範圍', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();

      const fromDate = new Date('2024-01-01');
      const toDate = new Date('2024-12-31');

      const partialConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        phoneNumberA: '+886912345678',
        targetUserB: '@user_b',
        dateRange: {
          from: fromDate,
          to: toDate,
        },
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dateRange).toBeDefined();
        expect(result.data.dateRange?.from).toEqual(fromDate);
        expect(result.data.dateRange?.to).toEqual(toDate);
      }
    });

    it('應支援只設定起始日期', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();

      const fromDate = new Date('2024-01-01');

      const partialConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        phoneNumberA: '+886912345678',
        targetUserB: '@user_b',
        dateRange: {
          from: fromDate,
        },
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dateRange?.from).toEqual(fromDate);
        expect(result.data.dateRange?.to).toBeUndefined();
      }
    });

    it('應支援只設定結束日期', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader: IConfigLoader = new ConfigLoader();

      const toDate = new Date('2024-12-31');

      const partialConfig = {
        apiId: 12345,
        apiHash: 'abcdef1234567890abcdef1234567890',
        phoneNumberA: '+886912345678',
        targetUserB: '@user_b',
        dateRange: {
          to: toDate,
        },
      };

      const result = loader.validate(partialConfig);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dateRange?.from).toBeUndefined();
        expect(result.data.dateRange?.to).toEqual(toDate);
      }
    });
  });

  describe('IConfigLoader 介面相容性', () => {
    it('應實作 load 方法', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader = new ConfigLoader();
      expect(typeof loader.load).toBe('function');
    });

    it('應實作 validate 方法', async () => {
      const { ConfigLoader } = await import('../../src/services/config-loader.js');
      const loader = new ConfigLoader();
      expect(typeof loader.validate).toBe('function');
    });
  });
});
