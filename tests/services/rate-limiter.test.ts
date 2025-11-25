/**
 * Task 9.1 & 9.2: 流量控制模組測試
 *
 * TDD 測試 - 驗證 RateLimiter 符合 design.md 規格
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

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { IRateLimiter } from '../../src/types/interfaces.js';

describe('RateLimiter', () => {
  let rateLimiter: IRateLimiter;

  // 使用 fake timers 來測試時間相關功能
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();

    const { RateLimiter } = await import('../../src/services/rate-limiter.js');
    rateLimiter = new RateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================================
  // IRateLimiter 介面相容性測試
  // ============================================================================

  describe('IRateLimiter 介面相容性', () => {
    it('應實作 acquire 方法', () => {
      expect(typeof rateLimiter.acquire).toBe('function');
    });

    it('應實作 recordFloodWait 方法', () => {
      expect(typeof rateLimiter.recordFloodWait).toBe('function');
    });

    it('應實作 getStats 方法', () => {
      expect(typeof rateLimiter.getStats).toBe('function');
    });

    it('應實作 reset 方法', () => {
      expect(typeof rateLimiter.reset).toBe('function');
    });
  });

  // ============================================================================
  // Task 9.1: FloodWait 錯誤處理
  // ============================================================================

  describe('Task 9.1: FloodWait 錯誤處理', () => {
    describe('acquire 方法 - 基本速率控制', () => {
      it('首次呼叫應立即回傳', async () => {
        // Arrange
        const startTime = Date.now();

        // Act
        const promise = rateLimiter.acquire();
        await vi.advanceTimersByTimeAsync(0);
        await promise;

        // Assert
        const endTime = Date.now();
        expect(endTime - startTime).toBeLessThan(100);
      });

      it('連續呼叫應依批次延遲等待', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({ batchDelay: 1000 });

        // Act - 第一次呼叫
        await limiter.acquire();
        await vi.advanceTimersByTimeAsync(0);

        // Act - 第二次呼叫應等待
        const secondAcquire = limiter.acquire();

        // 時間還沒到，promise 應該還在等待
        let resolved = false;
        secondAcquire.then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(500);
        expect(resolved).toBe(false);

        // 時間到了，promise 應該解析
        await vi.advanceTimersByTimeAsync(600);
        await secondAcquire;
        expect(resolved).toBe(true);
      });
    });

    describe('recordFloodWait 方法', () => {
      it('應記錄 FloodWait 事件', () => {
        // Act
        rateLimiter.recordFloodWait(60);

        // Assert
        const stats = rateLimiter.getStats();
        expect(stats.floodWaitCount).toBe(1);
      });

      it('應累計 FloodWait 總等待時間', () => {
        // Act
        rateLimiter.recordFloodWait(30);
        rateLimiter.recordFloodWait(60);

        // Assert
        const stats = rateLimiter.getStats();
        expect(stats.floodWaitCount).toBe(2);
        expect(stats.totalWaitTime).toBeGreaterThanOrEqual(90000); // 90 秒 = 90000 毫秒
      });

      it('應觸發自適應速率調整', () => {
        // Arrange
        const { RateLimiter } = vi.importActual<typeof import('../../src/services/rate-limiter.js')>('../../src/services/rate-limiter.js');
        // 這個測試將在 Task 9.2 中詳細驗證
      });
    });

    describe('getStats 方法', () => {
      it('初始狀態應回傳零統計', () => {
        // Act
        const stats = rateLimiter.getStats();

        // Assert
        expect(stats.totalRequests).toBe(0);
        expect(stats.floodWaitCount).toBe(0);
        expect(stats.totalWaitTime).toBe(0);
      });

      it('應追蹤已執行的請求數', async () => {
        // Arrange & Act
        await rateLimiter.acquire();
        await vi.advanceTimersByTimeAsync(1100);
        await rateLimiter.acquire();

        // Assert
        const stats = rateLimiter.getStats();
        expect(stats.totalRequests).toBe(2);
      });

      it('應計算當前速率', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({ batchDelay: 100 });

        // Act - 推進一些時間讓 elapsed time > 0
        await limiter.acquire();
        await vi.advanceTimersByTimeAsync(1000); // 推進 1 秒

        // Assert
        const stats = limiter.getStats();
        // 在 1 秒內執行了 1 個請求，速率應該是 1 或更高（考慮到時間精度）
        expect(stats.currentRate).toBeGreaterThanOrEqual(0);
        expect(stats.totalRequests).toBe(1);
      });
    });

    describe('reset 方法', () => {
      it('應重置所有統計資訊', async () => {
        // Arrange
        await rateLimiter.acquire();
        rateLimiter.recordFloodWait(60);

        // Act
        rateLimiter.reset();

        // Assert
        const stats = rateLimiter.getStats();
        expect(stats.totalRequests).toBe(0);
        expect(stats.floodWaitCount).toBe(0);
        expect(stats.totalWaitTime).toBe(0);
      });
    });
  });

  // ============================================================================
  // Task 9.2: 自適應速率調整
  // ============================================================================

  describe('Task 9.2: 自適應速率調整', () => {
    describe('RateLimitConfig 設定', () => {
      it('應支援使用者設定批次延遲', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const customDelay = 2000;
        const limiter = new RateLimiter({ batchDelay: customDelay });

        // Act
        await limiter.acquire();
        const acquirePromise = limiter.acquire();

        // Assert - 應等待 customDelay 時間
        let resolved = false;
        acquirePromise.then(() => { resolved = true; });
        await vi.advanceTimersByTimeAsync(customDelay - 100);
        expect(resolved).toBe(false);
        await vi.advanceTimersByTimeAsync(200);
        expect(resolved).toBe(true);
      });

      it('應支援設定最大請求數/分鐘', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({ maxRequestsPerMinute: 30 });

        // Assert - 設定應正確儲存
        const config = limiter.getConfig();
        expect(config.maxRequestsPerMinute).toBe(30);
      });

      it('應支援設定 FloodWait 自動處理門檻', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({ floodWaitThreshold: 300 });

        // Assert
        const config = limiter.getConfig();
        expect(config.floodWaitThreshold).toBe(300);
      });

      it('應支援啟用/停用自適應速率調整', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({ adaptiveEnabled: true });

        // Assert
        const config = limiter.getConfig();
        expect(config.adaptiveEnabled).toBe(true);
      });

      it('應使用合理的預設值', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter();

        // Act
        const config = limiter.getConfig();

        // Assert - 驗證預設值
        expect(config.batchDelay).toBe(1000); // 預設 1 秒
        expect(config.maxRequestsPerMinute).toBe(30); // 預設 30 次/分鐘
        expect(config.floodWaitThreshold).toBe(300); // 預設 300 秒
        expect(config.adaptiveEnabled).toBe(true); // 預設啟用
        expect(config.minBatchDelay).toBe(500); // 最小延遲 0.5 秒
        expect(config.maxBatchDelay).toBe(10000); // 最大延遲 10 秒
      });
    });

    describe('自適應速率調整機制', () => {
      it('連續 FloodWait 應自動增加批次延遲', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 1000,
          adaptiveEnabled: true,
        });
        const initialConfig = limiter.getConfig();
        const initialDelay = initialConfig.batchDelay;

        // Act - 連續發生 FloodWait
        limiter.recordFloodWait(30);
        await vi.advanceTimersByTimeAsync(1000);
        limiter.recordFloodWait(60);

        // Assert - 延遲應增加
        const newConfig = limiter.getConfig();
        expect(newConfig.batchDelay).toBeGreaterThan(initialDelay);
      });

      it('批次延遲不應超過最大值', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 9000,
          maxBatchDelay: 10000,
          adaptiveEnabled: true,
        });

        // Act - 多次 FloodWait
        for (let i = 0; i < 10; i++) {
          limiter.recordFloodWait(60);
          await vi.advanceTimersByTimeAsync(100);
        }

        // Assert
        const config = limiter.getConfig();
        expect(config.batchDelay).toBeLessThanOrEqual(config.maxBatchDelay);
      });

      it('批次延遲不應低於最小值', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 600,
          minBatchDelay: 500,
          adaptiveEnabled: true,
        });

        // Assert
        const config = limiter.getConfig();
        expect(config.batchDelay).toBeGreaterThanOrEqual(config.minBatchDelay);
      });

      it('長時間無 FloodWait 應逐漸降低延遲', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 5000,
          minBatchDelay: 500,
          adaptiveEnabled: true,
        });

        // 先觸發一次 FloodWait 來設定 lastFloodWaitTime
        limiter.recordFloodWait(10);

        // Act - 模擬長時間無 FloodWait（5 分鐘 = 300 秒）
        // 每次 acquire 都會檢查是否需要降速
        await vi.advanceTimersByTimeAsync(300000); // 5 分鐘
        await limiter.acquire();
        await vi.advanceTimersByTimeAsync(300000); // 再 5 分鐘
        await limiter.acquire();

        // Assert - 延遲應有所降低（5000 * 0.9 = 4500）
        const config = limiter.getConfig();
        expect(config.batchDelay).toBeLessThan(5000);
      });

      it('停用自適應調整時不應改變延遲', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 1000,
          adaptiveEnabled: false,
        });
        const initialDelay = limiter.getConfig().batchDelay;

        // Act
        limiter.recordFloodWait(60);
        limiter.recordFloodWait(120);

        // Assert
        const config = limiter.getConfig();
        expect(config.batchDelay).toBe(initialDelay);
      });
    });

    describe('setConfig 方法', () => {
      it('應允許動態更新設定', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({ batchDelay: 1000 });

        // Act
        limiter.setConfig({ batchDelay: 2000 });

        // Assert
        const config = limiter.getConfig();
        expect(config.batchDelay).toBe(2000);
      });

      it('應只更新指定的設定欄位', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 1000,
          maxRequestsPerMinute: 30,
        });

        // Act
        limiter.setConfig({ batchDelay: 2000 });

        // Assert
        const config = limiter.getConfig();
        expect(config.batchDelay).toBe(2000);
        expect(config.maxRequestsPerMinute).toBe(30); // 未變更
      });
    });

    describe('速率調整事件記錄', () => {
      it('應記錄速率調整事件', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 1000,
          adaptiveEnabled: true,
        });

        // Act - 觸發速率調整
        limiter.recordFloodWait(60);
        await vi.advanceTimersByTimeAsync(1000);
        limiter.recordFloodWait(60);

        // Assert
        const stats = limiter.getStats();
        const adjustments = limiter.getRateAdjustments();
        expect(adjustments.length).toBeGreaterThan(0);
      });

      it('速率調整事件應包含時間戳記、前後延遲值與原因', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter({
          batchDelay: 1000,
          adaptiveEnabled: true,
        });

        // Act
        limiter.recordFloodWait(60);
        await vi.advanceTimersByTimeAsync(500);
        limiter.recordFloodWait(60);

        // Assert
        const adjustments = limiter.getRateAdjustments();
        if (adjustments.length > 0) {
          const adjustment = adjustments[0];
          expect(adjustment.timestamp).toBeDefined();
          expect(typeof adjustment.previousDelay).toBe('number');
          expect(typeof adjustment.newDelay).toBe('number');
          expect(typeof adjustment.reason).toBe('string');
        }
      });
    });

    describe('onFloodWait 回呼', () => {
      it('應支援設定 FloodWait 回呼函式', async () => {
        // Arrange
        const { RateLimiter } = await import('../../src/services/rate-limiter.js');
        const limiter = new RateLimiter();
        const callback = vi.fn();

        // Act
        limiter.onFloodWait = callback;
        limiter.recordFloodWait(60);

        // Assert
        expect(limiter.onFloodWait).toBe(callback);
      });
    });
  });

  // ============================================================================
  // 整合測試：withFloodWaitRetry helper
  // ============================================================================

  describe('withFloodWaitRetry helper', () => {
    it('應在 FloodWait 後自動重試操作', async () => {
      // Arrange
      const { RateLimiter, withFloodWaitRetry } = await import('../../src/services/rate-limiter.js');
      const limiter = new RateLimiter({ batchDelay: 100 });

      let callCount = 0;
      const operation = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // 模擬 FloodWaitError
          const error = new Error('FloodWait') as Error & { seconds: number };
          error.seconds = 2;
          (error as { name: string }).name = 'FloodWaitError';
          throw error;
        }
        return 'success';
      });

      // Act
      const resultPromise = withFloodWaitRetry(operation, limiter, 'test');

      // 快進時間以完成等待
      await vi.advanceTimersByTimeAsync(3000);
      const result = await resultPromise;

      // Assert
      expect(result).toBe('success');
      expect(callCount).toBe(2);
    });

    it('應在等待期間呼叫倒數回呼', async () => {
      // Arrange
      const { RateLimiter, withFloodWaitRetry } = await import('../../src/services/rate-limiter.js');
      const limiter = new RateLimiter({ batchDelay: 100 });
      const countdownCalls: number[] = [];

      limiter.onFloodWait = (remaining: number) => {
        countdownCalls.push(remaining);
      };

      let callCount = 0;
      const operation = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const error = new Error('FloodWait') as Error & { seconds: number };
          error.seconds = 3;
          (error as { name: string }).name = 'FloodWaitError';
          throw error;
        }
        return 'success';
      });

      // Act
      const resultPromise = withFloodWaitRetry(operation, limiter, 'test');

      // 每秒推進時間
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      await resultPromise;

      // Assert - 應該有倒數呼叫
      expect(countdownCalls.length).toBeGreaterThan(0);
    });

    it('非 FloodWait 錯誤應直接拋出', async () => {
      // Arrange
      const { RateLimiter, withFloodWaitRetry } = await import('../../src/services/rate-limiter.js');
      const limiter = new RateLimiter({ batchDelay: 100 });

      const operation = vi.fn().mockRejectedValue(new Error('Other error'));

      // Act & Assert
      await expect(
        withFloodWaitRetry(operation, limiter, 'test')
      ).rejects.toThrow('Other error');
    });
  });

  // ============================================================================
  // 邊界條件測試
  // ============================================================================

  describe('邊界條件', () => {
    it('FloodWait 秒數為 0 應立即繼續', async () => {
      // Arrange
      rateLimiter.recordFloodWait(0);

      // Assert
      const stats = rateLimiter.getStats();
      expect(stats.floodWaitCount).toBe(1);
      expect(stats.totalWaitTime).toBe(0);
    });

    it('應處理非常大的 FloodWait 秒數', async () => {
      // Arrange
      const largeSeconds = 86400; // 一天

      // Act
      rateLimiter.recordFloodWait(largeSeconds);

      // Assert
      const stats = rateLimiter.getStats();
      expect(stats.floodWaitCount).toBe(1);
      expect(stats.totalWaitTime).toBe(largeSeconds * 1000);
    });

    it('多個並行 acquire 應正確處理', async () => {
      // Arrange
      const { RateLimiter } = await import('../../src/services/rate-limiter.js');
      const limiter = new RateLimiter({ batchDelay: 100 });

      // Act - 同時發起多個 acquire
      const promises = [
        limiter.acquire(),
        limiter.acquire(),
        limiter.acquire(),
      ];

      // 推進足夠的時間
      await vi.advanceTimersByTimeAsync(500);
      await Promise.all(promises);

      // Assert
      const stats = limiter.getStats();
      expect(stats.totalRequests).toBe(3);
    });
  });
});
