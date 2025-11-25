/**
 * AuthService - Telegram 帳號驗證服務
 *
 * 實作 IAuthService 介面，提供 Telegram Userbot 驗證流程，
 * 包含電話號碼驗證、驗證碼輸入、2FA 密碼驗證與 session 管理。
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 * - 初始化 GramJS TelegramClient 並設定連線參數
 * - 實作互動式驗證流程：電話號碼輸入、驗證碼請求、驗證碼驗證
 * - 處理驗證碼輸入錯誤並允許重新輸入
 * - 支援兩步驟驗證 (2FA) 密碼輸入流程
 */

import { TelegramClient, sessions } from 'telegram';

const { StringSession } = sessions;
import * as fs from 'fs';
import * as path from 'path';
import { success, failure, type Result } from '../types/result.js';
import type { IAuthService } from '../types/interfaces.js';
import type { AuthConfig } from '../types/models.js';
import type { AuthError, FileError } from '../types/errors.js';

/**
 * 預設驗證碼輸入提示（由 CLI 層覆寫）
 */
const defaultCodePrompt = async (): Promise<string> => {
  // 預設行為：在 CLI 層會被覆寫
  throw new Error('Code input handler not configured');
};

/**
 * 預設 2FA 密碼輸入提示（由 CLI 層覆寫）
 */
const defaultPasswordPrompt = async (): Promise<string> => {
  // 預設行為：在 CLI 層會被覆寫
  throw new Error('Password input handler not configured');
};

/**
 * 預設連線重試次數
 */
const DEFAULT_CONNECTION_RETRIES = 5;

/**
 * 預設 FloodWait 自動處理門檻（秒）
 */
const DEFAULT_FLOOD_SLEEP_THRESHOLD = 300;

/**
 * AuthService 類別
 *
 * 管理 Telegram 帳號的 Userbot 驗證流程與 session 持久化
 */
export class AuthService implements IAuthService {
  private codePrompt: () => Promise<string>;
  private passwordPrompt: () => Promise<string>;

  constructor(options?: {
    codePrompt?: () => Promise<string>;
    passwordPrompt?: () => Promise<string>;
  }) {
    this.codePrompt = options?.codePrompt ?? defaultCodePrompt;
    this.passwordPrompt = options?.passwordPrompt ?? defaultPasswordPrompt;
  }

  /**
   * 使用既有 session 或互動式驗證取得已驗證的 client
   *
   * @param config - 驗證設定
   * @returns 已驗證的 TelegramClient 或錯誤
   */
  async authenticate(config: AuthConfig): Promise<Result<TelegramClient, AuthError>> {
    try {
      // 讀取既有 session（若存在）
      const existingSession = this.loadExistingSession(config.sessionPath);

      // 建立 StringSession
      const stringSession = new StringSession(existingSession);

      // 初始化 TelegramClient
      const client = new TelegramClient(stringSession, config.apiId, config.apiHash, {
        connectionRetries: config.connectionRetries ?? DEFAULT_CONNECTION_RETRIES,
        floodSleepThreshold: config.floodSleepThreshold ?? DEFAULT_FLOOD_SLEEP_THRESHOLD,
      });

      // 執行驗證流程
      await client.start({
        phoneNumber: async () => config.phoneNumber ?? '',
        phoneCode: this.codePrompt,
        password: this.passwordPrompt,
        onError: (err) => {
          // 錯誤處理在外層 catch 處理
          console.error('Authentication error:', err);
        },
      });

      return success(client);
    } catch (error) {
      return failure(this.mapToAuthError(error));
    }
  }

  /**
   * 儲存當前 session 至檔案
   *
   * @param client - TelegramClient 實例
   * @param sessionPath - 儲存路徑
   * @returns 成功或檔案錯誤
   */
  async saveSession(client: TelegramClient, sessionPath: string): Promise<Result<void, FileError>> {
    try {
      const sessionString = client.session.save() as unknown as string;

      // 確保目錄存在
      const dir = path.dirname(sessionPath);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 寫入 session 檔案
      fs.writeFileSync(sessionPath, sessionString, { encoding: 'utf-8', mode: 0o600 });

      return success(undefined);
    } catch (error) {
      return failure({
        type: 'WRITE_FAILED',
        path: sessionPath,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 檢查 session 檔案是否存在且有效
   *
   * @param sessionPath - Session 檔案路徑
   * @returns 是否有效
   */
  async hasValidSession(sessionPath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(sessionPath)) {
        return false;
      }

      const content = fs.readFileSync(sessionPath, 'utf-8');
      return content.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 中斷連線並清理資源
   *
   * @param client - TelegramClient 實例
   */
  async disconnect(client: TelegramClient): Promise<void> {
    await client.disconnect();
  }

  /**
   * 載入既有 session
   *
   * @param sessionPath - Session 檔案路徑
   * @returns Session 字串或空字串
   */
  private loadExistingSession(sessionPath: string): string {
    try {
      if (fs.existsSync(sessionPath)) {
        const content = fs.readFileSync(sessionPath, 'utf-8');
        return content.trim();
      }
    } catch {
      // 忽略讀取錯誤，使用空 session
    }
    return '';
  }

  /**
   * 將原始錯誤轉換為 AuthError
   *
   * @param error - 原始錯誤
   * @returns AuthError
   */
  private mapToAuthError(error: unknown): AuthError {
    // 處理 GramJS 錯誤物件
    if (error && typeof error === 'object' && 'errorMessage' in error) {
      const errorMessage = (error as { errorMessage: string }).errorMessage;

      if (errorMessage === 'PHONE_CODE_INVALID' || errorMessage === 'PHONE_CODE_EXPIRED') {
        return {
          type: 'INVALID_CODE',
          message: `驗證碼無效或已過期: ${errorMessage}`,
          attemptsLeft: 3, // GramJS 會自動處理重試
        };
      }

      if (errorMessage === 'PASSWORD_HASH_INVALID' || errorMessage === 'SRP_PASSWORD_CHANGED') {
        return {
          type: 'INVALID_2FA',
          message: `2FA 密碼無效: ${errorMessage}`,
        };
      }

      if (errorMessage === 'AUTH_KEY_UNREGISTERED' || errorMessage === 'SESSION_REVOKED') {
        return {
          type: 'SESSION_EXPIRED',
          message: `Session 已過期，請重新登入: ${errorMessage}`,
        };
      }

      if (errorMessage.includes('FLOOD')) {
        return {
          type: 'NETWORK_ERROR',
          message: `API 流量限制: ${errorMessage}`,
          retryCount: 0,
        };
      }
    }

    // 處理標準 Error 物件
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
        return {
          type: 'NETWORK_ERROR',
          message: error.message,
          retryCount: 0,
        };
      }

      if (message.includes('credentials') || message.includes('api_id') || message.includes('api_hash')) {
        return {
          type: 'INVALID_CREDENTIALS',
          message: error.message,
        };
      }

      // 預設為網路錯誤
      return {
        type: 'NETWORK_ERROR',
        message: error.message,
        retryCount: 0,
      };
    }

    // 未知錯誤
    return {
      type: 'NETWORK_ERROR',
      message: String(error),
      retryCount: 0,
    };
  }
}
