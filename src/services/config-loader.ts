/**
 * ConfigLoader Service
 *
 * 載入與驗證應用程式設定
 *
 * Requirements: 8.2, 8.4, 8.5
 * - 從環境變數與設定檔讀取 API ID、API Hash 等敏感資訊
 * - 驗證必要設定欄位存在且格式正確
 * - 提供預設值：批次大小 100、群組名稱前綴 "[Migrated] "、FloodWait 門檻 300 秒
 * - 支援對話過濾條件與日期範圍設定
 */

// @ts-expect-error - input module has no type declarations
import input from 'input';
import type { IConfigLoader } from '../types/interfaces.js';
import type { AppConfig, Result, ConfigError, DialogFilter } from '../types/index.js';
import { LogLevel, DialogType } from '../types/index.js';
import { success, failure } from '../types/result.js';

/**
 * 預設設定值
 */
const DEFAULT_CONFIG = {
  sessionPath: './session.txt',
  progressPath: './progress.json',
  batchSize: 100,
  batchDelay: 1000,
  floodWaitThreshold: 300,
  groupCreationDelayMs: 60000, // 1 分鐘
  dailyGroupLimit: 50, // Telegram 每日群組建立上限
  groupNamePrefix: '[Migrated] ',
  logLevel: LogLevel.Info,
  logFilePath: './migration.log',
} as const;

/**
 * 環境變數名稱映射
 */
const ENV_KEYS = {
  apiId: 'TG_API_ID',
  apiHash: 'TG_API_HASH',
  phoneNumberA: 'TG_PHONE_A',
  targetUserB: 'TG_TARGET_USER_B',
  sessionPath: 'TG_SESSION_PATH',
  progressPath: 'TG_PROGRESS_PATH',
  batchSize: 'TG_BATCH_SIZE',
  batchDelay: 'TG_BATCH_DELAY',
  floodWaitThreshold: 'TG_FLOOD_WAIT_THRESHOLD',
  groupCreationDelayMs: 'TG_GROUP_CREATION_DELAY_MS',
  dailyGroupLimit: 'TG_DAILY_GROUP_LIMIT',
  groupNamePrefix: 'TG_GROUP_PREFIX',
  logLevel: 'TG_LOG_LEVEL',
  logFilePath: 'TG_LOG_FILE',
  // 對話過濾條件
  excludeTypes: 'TG_EXCLUDE_TYPES',
  includeTypes: 'TG_INCLUDE_TYPES',
} as const;

/**
 * 有效的對話類型值
 */
const VALID_DIALOG_TYPES = new Set<string>([
  DialogType.Private,
  DialogType.Group,
  DialogType.Supergroup,
  DialogType.Channel,
  DialogType.Bot,
]);

/**
 * 有效的日誌等級值
 */
const VALID_LOG_LEVELS = new Set<string>([
  LogLevel.Debug,
  LogLevel.Info,
  LogLevel.Warn,
  LogLevel.Error,
]);

/**
 * 設定載入器實作
 */
export class ConfigLoader implements IConfigLoader {
  /**
   * 從環境變數載入完整設定
   *
   * @param configPath - 設定檔路徑（目前未使用，保留供未來擴充）
   * @returns 設定或錯誤
   */
  load(_configPath?: string): Result<AppConfig, ConfigError> {
    const partialConfig = this.loadFromEnv();
    return this.validate(partialConfig);
  }

  /**
   * 互動式載入設定
   * 若環境變數未提供必要設定，會提示使用者輸入
   *
   * @returns 完整設定或錯誤
   */
  async loadInteractive(): Promise<Result<AppConfig, ConfigError>> {
    const partialConfig = this.loadFromEnv();

    // 檢查並互動式取得缺少的必要欄位
    console.log('\n=== Telegram 訊息遷移工具設定 ===\n');

    // API ID
    if (partialConfig.apiId === undefined || isNaN(partialConfig.apiId)) {
      const apiIdStr = await input.text('請輸入 Telegram API ID: ');
      const parsed = parseInt(apiIdStr, 10);
      if (isNaN(parsed)) {
        return failure({
          type: 'INVALID_VALUE',
          field: 'apiId',
          message: 'API ID 必須為正整數',
        });
      }
      partialConfig.apiId = parsed;
    } else {
      console.log(`✓ API ID: ${partialConfig.apiId} (從環境變數載入)`);
    }

    // API Hash
    if (!partialConfig.apiHash) {
      partialConfig.apiHash = await input.text('請輸入 Telegram API Hash: ');
    } else {
      console.log(`✓ API Hash: ${partialConfig.apiHash.substring(0, 8)}... (從環境變數載入)`);
    }

    // Phone Number A
    if (!partialConfig.phoneNumberA) {
      partialConfig.phoneNumberA = await input.text('請輸入來源帳號 A 的電話號碼 (例如 +886912345678): ');
    } else {
      console.log(`✓ 來源帳號: ${this.maskPhone(partialConfig.phoneNumberA)} (從環境變數載入)`);
    }

    // Target User B
    if (!partialConfig.targetUserB) {
      partialConfig.targetUserB = await input.text('請輸入目標帳號 B 的使用者名稱或電話號碼: ');
    } else {
      console.log(`✓ 目標帳號: ${partialConfig.targetUserB} (從環境變數載入)`);
    }

    console.log('');

    return this.validate(partialConfig);
  }

  /**
   * 遮蔽電話號碼中間部分
   */
  private maskPhone(phone: string): string {
    if (phone.length <= 6) return phone;
    const start = phone.substring(0, 4);
    const end = phone.substring(phone.length - 3);
    return `${start}****${end}`;
  }

  /**
   * 驗證設定完整性並填入預設值
   *
   * @param config - 部分設定
   * @returns 完整設定或錯誤
   */
  validate(config: Partial<AppConfig>): Result<AppConfig, ConfigError> {
    // 驗證必要欄位
    const requiredFields = ['apiId', 'apiHash', 'phoneNumberA', 'targetUserB'] as const;

    for (const field of requiredFields) {
      if (config[field] === undefined || config[field] === null || config[field] === '') {
        return failure({ type: 'MISSING_REQUIRED', field });
      }
    }

    // 驗證 apiId 格式
    const apiIdValidation = this.validateApiId(config.apiId!);
    if (!apiIdValidation.success) {
      return apiIdValidation;
    }

    // 驗證 apiHash 格式
    const apiHashValidation = this.validateApiHash(config.apiHash!);
    if (!apiHashValidation.success) {
      return apiHashValidation;
    }

    // 驗證 batchSize 格式（若有提供）
    if (config.batchSize !== undefined) {
      const batchSizeValidation = this.validateBatchSize(config.batchSize);
      if (!batchSizeValidation.success) {
        return batchSizeValidation;
      }
    }

    // 驗證 logLevel 格式（若有提供）
    if (config.logLevel !== undefined) {
      const logLevelValidation = this.validateLogLevel(config.logLevel);
      if (!logLevelValidation.success) {
        return logLevelValidation;
      }
    }

    // 建立完整設定，使用預設值填補未提供的欄位
    const fullConfig: AppConfig = {
      apiId: config.apiId!,
      apiHash: config.apiHash!,
      phoneNumberA: config.phoneNumberA!,
      targetUserB: config.targetUserB!,
      sessionPath: config.sessionPath ?? DEFAULT_CONFIG.sessionPath,
      progressPath: config.progressPath ?? DEFAULT_CONFIG.progressPath,
      batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
      batchDelay: config.batchDelay ?? DEFAULT_CONFIG.batchDelay,
      floodWaitThreshold: config.floodWaitThreshold ?? DEFAULT_CONFIG.floodWaitThreshold,
      groupCreationDelayMs: config.groupCreationDelayMs ?? DEFAULT_CONFIG.groupCreationDelayMs,
      dailyGroupLimit: config.dailyGroupLimit ?? DEFAULT_CONFIG.dailyGroupLimit,
      groupNamePrefix: config.groupNamePrefix ?? DEFAULT_CONFIG.groupNamePrefix,
      logLevel: config.logLevel ?? DEFAULT_CONFIG.logLevel,
      logFilePath: config.logFilePath ?? DEFAULT_CONFIG.logFilePath,
      dialogFilter: config.dialogFilter,
      dateRange: config.dateRange,
    };

    return success(fullConfig);
  }

  /**
   * 從環境變數讀取設定值
   */
  private loadFromEnv(): Partial<AppConfig> {
    const config: Partial<AppConfig> = {};

    // 必要欄位
    const apiIdStr = process.env[ENV_KEYS.apiId];
    if (apiIdStr !== undefined) {
      const parsed = parseInt(apiIdStr, 10);
      if (!isNaN(parsed)) {
        config.apiId = parsed;
      } else {
        // 設定為特殊值以觸發格式驗證錯誤
        config.apiId = NaN as unknown as number;
      }
    }

    const apiHash = process.env[ENV_KEYS.apiHash];
    if (apiHash !== undefined) {
      config.apiHash = apiHash;
    }

    const phoneNumberA = process.env[ENV_KEYS.phoneNumberA];
    if (phoneNumberA !== undefined) {
      config.phoneNumberA = phoneNumberA;
    }

    const targetUserB = process.env[ENV_KEYS.targetUserB];
    if (targetUserB !== undefined) {
      config.targetUserB = targetUserB;
    }

    // 選填欄位
    const sessionPath = process.env[ENV_KEYS.sessionPath];
    if (sessionPath !== undefined) {
      config.sessionPath = sessionPath;
    }

    const progressPath = process.env[ENV_KEYS.progressPath];
    if (progressPath !== undefined) {
      config.progressPath = progressPath;
    }

    const batchSizeStr = process.env[ENV_KEYS.batchSize];
    if (batchSizeStr !== undefined) {
      const parsed = parseInt(batchSizeStr, 10);
      if (!isNaN(parsed)) {
        config.batchSize = parsed;
      } else {
        config.batchSize = 0; // 觸發驗證錯誤
      }
    }

    const batchDelayStr = process.env[ENV_KEYS.batchDelay];
    if (batchDelayStr !== undefined) {
      const parsed = parseInt(batchDelayStr, 10);
      if (!isNaN(parsed)) {
        config.batchDelay = parsed;
      }
    }

    const floodWaitThresholdStr = process.env[ENV_KEYS.floodWaitThreshold];
    if (floodWaitThresholdStr !== undefined) {
      const parsed = parseInt(floodWaitThresholdStr, 10);
      if (!isNaN(parsed)) {
        config.floodWaitThreshold = parsed;
      }
    }

    const groupCreationDelayMsStr = process.env[ENV_KEYS.groupCreationDelayMs];
    if (groupCreationDelayMsStr !== undefined) {
      const parsed = parseInt(groupCreationDelayMsStr, 10);
      if (!isNaN(parsed)) {
        config.groupCreationDelayMs = parsed;
      }
    }

    const dailyGroupLimitStr = process.env[ENV_KEYS.dailyGroupLimit];
    if (dailyGroupLimitStr !== undefined) {
      const parsed = parseInt(dailyGroupLimitStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        config.dailyGroupLimit = parsed;
      }
    }

    const groupNamePrefix = process.env[ENV_KEYS.groupNamePrefix];
    if (groupNamePrefix !== undefined) {
      config.groupNamePrefix = groupNamePrefix;
    }

    const logLevel = process.env[ENV_KEYS.logLevel];
    if (logLevel !== undefined) {
      config.logLevel = logLevel as AppConfig['logLevel'];
    }

    const logFilePath = process.env[ENV_KEYS.logFilePath];
    if (logFilePath !== undefined) {
      config.logFilePath = logFilePath;
    }

    // 對話過濾條件
    const dialogFilter = this.parseDialogFilterFromEnv();
    if (dialogFilter !== undefined) {
      config.dialogFilter = dialogFilter;
    }

    return config;
  }

  /**
   * 從環境變數解析對話過濾條件
   *
   * 支援的環境變數：
   * - TG_EXCLUDE_TYPES: 排除的對話類型，以逗號分隔（如 "bot,channel"）
   * - TG_INCLUDE_TYPES: 僅包含的對話類型，以逗號分隔（如 "private,group"）
   *
   * @returns 對話過濾條件或 undefined
   */
  private parseDialogFilterFromEnv(): DialogFilter | undefined {
    const excludeTypesStr = process.env[ENV_KEYS.excludeTypes];
    const includeTypesStr = process.env[ENV_KEYS.includeTypes];

    if (excludeTypesStr === undefined && includeTypesStr === undefined) {
      return undefined;
    }

    const filter: DialogFilter = {};

    if (excludeTypesStr !== undefined && excludeTypesStr.trim() !== '') {
      const types = this.parseDialogTypes(excludeTypesStr);
      if (types.length > 0) {
        filter.excludeTypes = types;
      }
    }

    if (includeTypesStr !== undefined && includeTypesStr.trim() !== '') {
      const types = this.parseDialogTypes(includeTypesStr);
      if (types.length > 0) {
        filter.includeTypes = types;
      }
    }

    // 若無有效過濾條件則回傳 undefined
    if (filter.excludeTypes === undefined && filter.includeTypes === undefined) {
      return undefined;
    }

    return filter;
  }

  /**
   * 解析對話類型字串
   *
   * @param typesStr - 逗號分隔的類型字串（如 "bot,channel"）
   * @returns 有效的對話類型陣列
   */
  private parseDialogTypes(typesStr: string): DialogType[] {
    return typesStr
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => VALID_DIALOG_TYPES.has(t)) as DialogType[];
  }

  /**
   * 驗證 API ID 格式
   */
  private validateApiId(apiId: number): Result<void, ConfigError> {
    if (isNaN(apiId) || !Number.isInteger(apiId) || apiId <= 0) {
      return failure({
        type: 'INVALID_VALUE',
        field: 'apiId',
        message: 'API ID 必須為正整數',
      });
    }
    return success(undefined);
  }

  /**
   * 驗證 API Hash 格式
   * API Hash 必須為 32 字元的十六進位字串
   */
  private validateApiHash(apiHash: string): Result<void, ConfigError> {
    const hexPattern = /^[a-f0-9]{32}$/i;
    if (!hexPattern.test(apiHash)) {
      return failure({
        type: 'INVALID_VALUE',
        field: 'apiHash',
        message: 'API Hash 必須為 32 字元的十六進位字串',
      });
    }
    return success(undefined);
  }

  /**
   * 驗證批次大小格式
   */
  private validateBatchSize(batchSize: number): Result<void, ConfigError> {
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      return failure({
        type: 'INVALID_VALUE',
        field: 'batchSize',
        message: '批次大小必須為正整數',
      });
    }
    return success(undefined);
  }

  /**
   * 驗證日誌等級格式
   */
  private validateLogLevel(logLevel: string): Result<void, ConfigError> {
    if (!VALID_LOG_LEVELS.has(logLevel)) {
      return failure({
        type: 'INVALID_VALUE',
        field: 'logLevel',
        message: `日誌等級必須為 ${Array.from(VALID_LOG_LEVELS).join(', ')} 其中之一`,
      });
    }
    return success(undefined);
  }
}
