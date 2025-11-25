/**
 * SessionManager - Session 管理與自動重連服務
 *
 * 實作 ISessionManager 與 IReconnectionManager 介面，提供：
 * - Session 檔案的安全儲存與載入
 * - 原子寫入機制避免檔案損毀
 * - 檔案權限檢查與安全警告
 * - 網路中斷時的自動重連機制
 *
 * Requirements: 1.5, 1.6
 * - 使用 StringSession 將驗證狀態序列化儲存至檔案
 * - 程式啟動時檢查並載入既有 session 以跳過驗證
 * - 實作網路中斷時的自動重連機制（最多 3 次）
 * - 設定 session 檔案權限為 600 避免敏感資料外洩
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TelegramClient } from 'telegram';
import { success, failure, type Result } from '../types/result.js';
import type {
  ISessionManager,
  IReconnectionManager,
  SessionPermissionResult,
  ReconnectStatusCallback,
  ReconnectStatusEvent,
  ReconnectionConfig,
} from '../types/interfaces.js';
import type { FileError, AuthError } from '../types/errors.js';

/**
 * 預設最大重連次數
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * 預設初始延遲時間（毫秒）
 */
const DEFAULT_INITIAL_DELAY_MS = 1000;

/**
 * 安全的檔案權限（owner read/write only）
 */
const SECURE_FILE_MODE = 0o600;

/**
 * SessionManager 類別
 *
 * 管理 Telegram session 檔案的儲存、載入與安全性
 */
export class SessionManager implements ISessionManager {
  /**
   * 儲存 session 字串至檔案
   *
   * 使用原子寫入機制：先寫入暫存檔再 rename，避免寫入過程中斷導致檔案損毀。
   * 設定檔案權限為 600（owner read/write only）確保安全性。
   *
   * @param sessionString - Session 字串
   * @param filePath - 檔案路徑
   * @returns 成功或錯誤
   */
  async saveSession(sessionString: string, filePath: string): Promise<Result<void, FileError>> {
    try {
      // 確保目錄存在
      const dir = path.dirname(filePath);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 使用原子寫入：先寫入暫存檔
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, sessionString, { encoding: 'utf-8', mode: SECURE_FILE_MODE });

      // 重新命名暫存檔為目標檔案（原子操作）
      fs.renameSync(tempPath, filePath);

      // 確保最終檔案權限正確（某些系統 rename 可能不保留權限）
      fs.chmodSync(filePath, SECURE_FILE_MODE);

      return success(undefined);
    } catch (error) {
      return failure({
        type: 'WRITE_FAILED',
        path: filePath,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 載入 session 檔案
   *
   * @param filePath - 檔案路徑
   * @returns Session 字串或 null（若不存在）或錯誤
   */
  async loadSession(filePath: string): Promise<Result<string | null, FileError>> {
    try {
      // 檔案不存在時回傳 null（不是錯誤）
      if (!fs.existsSync(filePath)) {
        return success(null);
      }

      // 檢查是否為檔案（而非目錄）
      const stats = fs.statSync(filePath);
      if (!stats.isFile()) {
        return failure({
          type: 'READ_FAILED',
          path: filePath,
          message: 'Path is not a file',
        });
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const trimmedContent = content.trim();

      // 空檔案視為不存在
      if (trimmedContent.length === 0) {
        return success(null);
      }

      return success(trimmedContent);
    } catch (error) {
      return failure({
        type: 'READ_FAILED',
        path: filePath,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 刪除 session 檔案
   *
   * @param filePath - 檔案路徑
   * @returns 成功或錯誤
   */
  async deleteSession(filePath: string): Promise<Result<void, FileError>> {
    try {
      // 檔案不存在時視為成功（idempotent）
      if (!fs.existsSync(filePath)) {
        return success(undefined);
      }

      fs.unlinkSync(filePath);
      return success(undefined);
    } catch (error) {
      return failure({
        type: 'WRITE_FAILED',
        path: filePath,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 檢查 session 檔案是否存在且有效
   *
   * @param filePath - 檔案路徑
   * @returns 是否存在且有效
   */
  async sessionExists(filePath: string): Promise<boolean> {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      return content.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 驗證 session 檔案權限
   *
   * @param filePath - 檔案路徑
   * @returns 權限驗證結果
   */
  async validateSessionPermissions(filePath: string): Promise<SessionPermissionResult> {
    try {
      if (!fs.existsSync(filePath)) {
        return { valid: false };
      }

      const stats = fs.statSync(filePath);
      const permissions = stats.mode & 0o777;

      // 檢查是否為安全權限（600 或更嚴格）
      if (permissions === SECURE_FILE_MODE) {
        return { valid: true };
      }

      // 權限過於寬鬆，回傳警告
      const permissionString = permissions.toString(8).padStart(3, '0');
      return {
        valid: true,
        warning: `Session 檔案權限過於寬鬆 (${permissionString})。建議設定為 600 以保護敏感資料。`,
      };
    } catch {
      return { valid: false };
    }
  }
}

/**
 * ReconnectionManager 類別
 *
 * 管理 Telegram 連線的自動重連機制
 */
export class ReconnectionManager implements IReconnectionManager {
  private maxRetries: number;
  private initialDelayMs: number;
  private attempts: number = 0;
  private statusCallbacks: ReconnectStatusCallback[] = [];

  constructor(config?: ReconnectionConfig) {
    this.maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  }

  /**
   * 嘗試重新連線
   *
   * 使用指數退避策略：第一次重試等待 initialDelayMs，
   * 之後每次等待時間加倍。
   *
   * @param client - TelegramClient 實例
   * @returns 成功或錯誤
   */
  async attemptReconnect(client: TelegramClient): Promise<Result<void, AuthError>> {
    this.attempts = 0;
    let lastError: Error | null = null;

    for (let i = 0; i < this.maxRetries; i++) {
      this.attempts = i;

      // 第一次直接嘗試，之後使用指數退避
      if (i > 0) {
        const delayMs = this.initialDelayMs * Math.pow(2, i - 1);
        await this.sleep(delayMs);
      }

      // 發送嘗試中狀態
      this.emitStatus({
        status: 'attempting',
        attempt: i + 1,
        maxAttempts: this.maxRetries,
      });

      try {
        await client.connect();

        // 連線成功
        this.emitStatus({
          status: 'connected',
          attempt: i + 1,
          maxAttempts: this.maxRetries,
        });

        return success(undefined);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.attempts = i + 1;
      }
    }

    // 所有重試都失敗
    this.emitStatus({
      status: 'failed',
      attempt: this.maxRetries,
      maxAttempts: this.maxRetries,
      error: lastError?.message,
    });

    return failure({
      type: 'NETWORK_ERROR',
      message: lastError?.message ?? 'Unknown error',
      retryCount: this.maxRetries,
    });
  }

  /**
   * 取得目前重連嘗試次數
   *
   * @returns 嘗試次數
   */
  getReconnectAttempts(): number {
    return this.attempts;
  }

  /**
   * 重置重連嘗試次數
   */
  resetAttempts(): void {
    this.attempts = 0;
  }

  /**
   * 註冊重連狀態回呼
   *
   * @param callback - 狀態回呼函式
   */
  onReconnectStatus(callback: ReconnectStatusCallback): void {
    this.statusCallbacks.push(callback);
  }

  /**
   * 發送狀態事件給所有已註冊的回呼
   *
   * @param event - 狀態事件
   */
  private emitStatus(event: ReconnectStatusEvent): void {
    for (const callback of this.statusCallbacks) {
      try {
        callback(event);
      } catch {
        // 忽略回呼錯誤，避免影響重連流程
      }
    }
  }

  /**
   * 非同步等待
   *
   * @param ms - 等待毫秒數
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
