/**
 * Task 9.1 & 9.2: 流量控制模組
 *
 * 實作 IRateLimiter 介面
 *
 * Task 9.1 Requirements: 5.2, 5.3
 * - 捕捉 FloodWaitError 並取得等待秒數
 * - 設定 floodSleepThreshold 讓 GramJS 自動處理較短等待
 * - 顯示 FloodWait 倒數計時資訊供使用者知悉
 * - 等待完成後自動重試操作
 *
 * Task 9.2 Requirements: 5.1, 5.4, 5.5
 * - 支援使用者設定轉發速率上限
 * - 連續發生多次 FloodWait 時自動降低轉發速率
 * - 記錄速率調整事件供後續分析
 * - 設定合理的批次間隔時間
 */

import type {
  IRateLimiter,
  RateLimitConfig,
  RateAdjustmentEvent,
} from '../types/interfaces.js';
import type { RateLimiterStats } from '../types/models.js';

/**
 * 預設速率限制設定
 */
const DEFAULT_CONFIG: RateLimitConfig = {
  batchDelay: 1000, // 1 秒
  maxRequestsPerMinute: 30,
  floodWaitThreshold: 300, // 5 分鐘
  adaptiveEnabled: true,
  minBatchDelay: 500, // 0.5 秒
  maxBatchDelay: 10000, // 10 秒
};

/**
 * 自適應速率調整參數
 */
const ADAPTIVE_PARAMS = {
  /** 連續 FloodWait 觸發降速的門檻（事件數） */
  consecutiveFloodWaitThreshold: 2,
  /** 連續 FloodWait 的時間視窗（毫秒） */
  consecutiveFloodWaitWindow: 60000, // 1 分鐘
  /** 降速時的增加比例 */
  slowdownFactor: 1.5,
  /** 加速時的減少比例 */
  speedupFactor: 0.9,
  /** 無 FloodWait 後加速的等待時間（毫秒） */
  speedupInterval: 300000, // 5 分鐘
};

/**
 * 速率限制器實作
 *
 * 管理 API 請求速率與 FloodWait 處理
 */
export class RateLimiter implements IRateLimiter {
  /** 當前設定 */
  private config: RateLimitConfig;

  /** 統計資訊 */
  private stats: {
    totalRequests: number;
    floodWaitCount: number;
    totalWaitTime: number; // 毫秒
    startTime: number;
  };

  /** 速率調整事件記錄 */
  private rateAdjustments: RateAdjustmentEvent[] = [];

  /** 最近的 FloodWait 事件時間戳（用於自適應調整） */
  private recentFloodWaitTimestamps: number[] = [];

  /** 上次請求時間 */
  private lastRequestTime: number = 0;

  /** 上次 FloodWait 時間（用於判斷加速） */
  private lastFloodWaitTime: number = 0;

  /** FloodWait 倒數回呼 */
  public onFloodWait?: (secondsRemaining: number, operation?: string) => void;

  /**
   * 建構子
   *
   * @param config - 可選的初始設定
   */
  constructor(config?: Partial<RateLimitConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      totalRequests: 0,
      floodWaitCount: 0,
      totalWaitTime: 0,
      startTime: Date.now(),
    };
  }

  /**
   * 取得執行權限
   *
   * 實作基本的速率限制邏輯，確保請求間隔不小於 batchDelay
   */
  async acquire(): Promise<void> {
    const now = Date.now();

    // 計算需要等待的時間
    const timeSinceLastRequest = now - this.lastRequestTime;
    const waitTime = Math.max(0, this.config.batchDelay - timeSinceLastRequest);

    // 檢查是否需要加速（長時間無 FloodWait）
    if (this.config.adaptiveEnabled && this.lastFloodWaitTime > 0) {
      const timeSinceLastFloodWait = now - this.lastFloodWaitTime;
      if (timeSinceLastFloodWait >= ADAPTIVE_PARAMS.speedupInterval) {
        this.trySpeedUp();
      }
    }

    if (waitTime > 0) {
      await this.sleep(waitTime);
    }

    this.lastRequestTime = Date.now();
    this.stats.totalRequests++;
  }

  /**
   * 記錄 FloodWait 事件並調整速率
   *
   * @param seconds - 等待秒數
   */
  recordFloodWait(seconds: number): void {
    const now = Date.now();
    this.stats.floodWaitCount++;
    this.stats.totalWaitTime += seconds * 1000; // 轉換為毫秒
    this.lastFloodWaitTime = now;

    // 記錄 FloodWait 時間戳用於自適應調整
    this.recentFloodWaitTimestamps.push(now);

    // 清理過期的時間戳
    this.recentFloodWaitTimestamps = this.recentFloodWaitTimestamps.filter(
      (ts) => now - ts <= ADAPTIVE_PARAMS.consecutiveFloodWaitWindow
    );

    // 檢查是否需要自適應降速
    if (this.config.adaptiveEnabled) {
      this.checkAdaptiveSlowdown();
    }
  }

  /**
   * 取得統計資訊
   *
   * @returns 速率限制器統計
   */
  getStats(): RateLimiterStats {
    const elapsed = (Date.now() - this.stats.startTime) / 1000; // 秒
    const currentRate = elapsed > 0 ? this.stats.totalRequests / elapsed : 0;

    return {
      totalRequests: this.stats.totalRequests,
      floodWaitCount: this.stats.floodWaitCount,
      totalWaitTime: this.stats.totalWaitTime,
      currentRate,
    };
  }

  /**
   * 重置統計資訊
   */
  reset(): void {
    this.stats = {
      totalRequests: 0,
      floodWaitCount: 0,
      totalWaitTime: 0,
      startTime: Date.now(),
    };
    this.rateAdjustments = [];
    this.recentFloodWaitTimestamps = [];
    this.lastRequestTime = 0;
    this.lastFloodWaitTime = 0;
  }

  /**
   * 取得當前設定
   *
   * @returns 速率限制設定
   */
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * 更新設定
   *
   * @param config - 部分設定
   */
  setConfig(config: Partial<RateLimitConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 取得速率調整事件記錄
   *
   * @returns 速率調整事件列表
   */
  getRateAdjustments(): RateAdjustmentEvent[] {
    return [...this.rateAdjustments];
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * 檢查並執行自適應降速
   */
  private checkAdaptiveSlowdown(): void {
    // 如果連續 FloodWait 次數達到門檻，增加延遲
    if (
      this.recentFloodWaitTimestamps.length >=
      ADAPTIVE_PARAMS.consecutiveFloodWaitThreshold
    ) {
      const previousDelay = this.config.batchDelay;
      const newDelay = Math.min(
        Math.round(previousDelay * ADAPTIVE_PARAMS.slowdownFactor),
        this.config.maxBatchDelay
      );

      if (newDelay !== previousDelay) {
        this.config.batchDelay = newDelay;
        this.recordAdjustment(
          previousDelay,
          newDelay,
          `連續 ${this.recentFloodWaitTimestamps.length} 次 FloodWait，增加延遲`
        );
      }

      // 清空以避免重複調整
      this.recentFloodWaitTimestamps = [];
    }
  }

  /**
   * 嘗試加速（減少延遲）
   */
  private trySpeedUp(): void {
    const previousDelay = this.config.batchDelay;
    const newDelay = Math.max(
      Math.round(previousDelay * ADAPTIVE_PARAMS.speedupFactor),
      this.config.minBatchDelay
    );

    if (newDelay !== previousDelay) {
      this.config.batchDelay = newDelay;
      this.recordAdjustment(
        previousDelay,
        newDelay,
        '長時間無 FloodWait，減少延遲'
      );
    }

    // 重置 FloodWait 時間以避免連續加速
    this.lastFloodWaitTime = Date.now();
  }

  /**
   * 記錄速率調整事件
   */
  private recordAdjustment(
    previousDelay: number,
    newDelay: number,
    reason: string
  ): void {
    this.rateAdjustments.push({
      timestamp: new Date(),
      previousDelay,
      newDelay,
      reason,
    });
  }

  /**
   * 等待指定毫秒數
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 判斷錯誤是否為 FloodWaitError
 */
function isFloodWaitError(error: unknown): error is Error & { seconds: number } {
  return (
    error instanceof Error &&
    (error.name === 'FloodWaitError' ||
      error.message.includes('FloodWait') ||
      'seconds' in error)
  );
}

/**
 * FloodWait 重試包裝器
 *
 * 自動處理 FloodWaitError，在等待後重試操作
 *
 * @param operation - 要執行的操作
 * @param rateLimiter - 速率限制器實例
 * @param operationName - 操作名稱（用於日誌）
 * @returns 操作結果
 */
export async function withFloodWaitRetry<T>(
  operation: () => Promise<T>,
  rateLimiter: IRateLimiter,
  operationName: string
): Promise<T> {
  while (true) {
    try {
      await rateLimiter.acquire();
      return await operation();
    } catch (error) {
      if (isFloodWaitError(error)) {
        const seconds = error.seconds;
        rateLimiter.recordFloodWait(seconds);

        // 執行倒數回呼
        if (rateLimiter.onFloodWait) {
          for (let remaining = seconds; remaining > 0; remaining--) {
            rateLimiter.onFloodWait(remaining, operationName);
            await sleep(1000);
          }
        } else {
          // 沒有回呼時直接等待
          await sleep(seconds * 1000);
        }

        // 等待完成後重試
        continue;
      }
      // 非 FloodWait 錯誤直接拋出
      throw error;
    }
  }
}

/**
 * 簡單的 sleep 函式
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
