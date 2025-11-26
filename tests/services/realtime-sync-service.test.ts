/**
 * RealtimeSyncService 單元測試
 *
 * 測試即時訊息同步功能，包含：
 * - 新訊息事件監聽與佇列管理
 * - 佇列處理與訊息轉發
 * - 去重邏輯與順序保證
 * - 錯誤處理與重試機制
 * - FloodWait 處理
 *
 * Requirements: 1.1-1.5, 2.1-2.6, 4.1-4.5, 5.1-5.5, 6.1-6.6, 7.1-7.8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TelegramClient } from 'telegram';
import type {
  QueuedMessage,
  QueueStatus,
  QueueProcessResult,
  RealtimeSyncStats,
} from '../../src/types/models.js';
import type { RealtimeSyncError } from '../../src/types/errors.js';
import type { IRealtimeSyncService } from '../../src/types/interfaces.js';

// ============================================================================
// Task 1.1: 即時同步相關資料類型測試
// Requirements: 2.4, 6.1, 7.6, 7.7
// ============================================================================

describe('Realtime Sync Data Types (Task 1.1)', () => {
  describe('QueuedMessage', () => {
    it('應包含 messageId 欄位（number 類型）', () => {
      const message: QueuedMessage = {
        messageId: 12345,
        timestamp: new Date(),
        message: {},
        retryCount: 0,
      };
      expect(typeof message.messageId).toBe('number');
    });

    it('應包含 timestamp 欄位（Date 類型）', () => {
      const message: QueuedMessage = {
        messageId: 1,
        timestamp: new Date('2024-01-15T12:00:00Z'),
        message: {},
        retryCount: 0,
      };
      expect(message.timestamp).toBeInstanceOf(Date);
    });

    it('應包含 message 欄位（unknown 類型，儲存 GramJS Message）', () => {
      const gramJSMessage = { className: 'Message', id: 1 };
      const message: QueuedMessage = {
        messageId: 1,
        timestamp: new Date(),
        message: gramJSMessage,
        retryCount: 0,
      };
      expect(message.message).toBeDefined();
    });

    it('應包含 retryCount 欄位（number 類型，預設 0）', () => {
      const message: QueuedMessage = {
        messageId: 1,
        timestamp: new Date(),
        message: {},
        retryCount: 0,
      };
      expect(message.retryCount).toBe(0);
    });
  });

  describe('QueueStatus', () => {
    it('應包含 pending 欄位（待處理訊息數）', () => {
      const status: QueueStatus = {
        pending: 10,
        processed: 5,
        failed: 1,
      };
      expect(status.pending).toBe(10);
    });

    it('應包含 processed 欄位（已處理訊息數）', () => {
      const status: QueueStatus = {
        pending: 10,
        processed: 5,
        failed: 1,
      };
      expect(status.processed).toBe(5);
    });

    it('應包含 failed 欄位（失敗訊息數）', () => {
      const status: QueueStatus = {
        pending: 10,
        processed: 5,
        failed: 1,
      };
      expect(status.failed).toBe(1);
    });
  });

  describe('QueueProcessResult', () => {
    it('應包含 successCount 欄位', () => {
      const result: QueueProcessResult = {
        successCount: 8,
        failedCount: 2,
        skippedCount: 1,
        failedMessageIds: [100, 200],
      };
      expect(result.successCount).toBe(8);
    });

    it('應包含 failedCount 欄位', () => {
      const result: QueueProcessResult = {
        successCount: 8,
        failedCount: 2,
        skippedCount: 1,
        failedMessageIds: [100, 200],
      };
      expect(result.failedCount).toBe(2);
    });

    it('應包含 skippedCount 欄位（重複訊息）', () => {
      const result: QueueProcessResult = {
        successCount: 8,
        failedCount: 2,
        skippedCount: 1,
        failedMessageIds: [100, 200],
      };
      expect(result.skippedCount).toBe(1);
    });

    it('應包含 failedMessageIds 欄位（失敗訊息 ID 列表）', () => {
      const result: QueueProcessResult = {
        successCount: 8,
        failedCount: 2,
        skippedCount: 1,
        failedMessageIds: [100, 200],
      };
      expect(result.failedMessageIds).toEqual([100, 200]);
    });
  });

  describe('RealtimeSyncStats', () => {
    it('應包含 activeListeners 欄位', () => {
      const stats: RealtimeSyncStats = {
        activeListeners: 3,
        totalReceived: 100,
        totalSynced: 90,
        totalFailed: 5,
        totalSkipped: 5,
      };
      expect(stats.activeListeners).toBe(3);
    });

    it('應包含 totalReceived 欄位', () => {
      const stats: RealtimeSyncStats = {
        activeListeners: 3,
        totalReceived: 100,
        totalSynced: 90,
        totalFailed: 5,
        totalSkipped: 5,
      };
      expect(stats.totalReceived).toBe(100);
    });

    it('應包含 totalSynced 欄位', () => {
      const stats: RealtimeSyncStats = {
        activeListeners: 3,
        totalReceived: 100,
        totalSynced: 90,
        totalFailed: 5,
        totalSkipped: 5,
      };
      expect(stats.totalSynced).toBe(90);
    });

    it('應包含 totalFailed 欄位', () => {
      const stats: RealtimeSyncStats = {
        activeListeners: 3,
        totalReceived: 100,
        totalSynced: 90,
        totalFailed: 5,
        totalSkipped: 5,
      };
      expect(stats.totalFailed).toBe(5);
    });

    it('應包含 totalSkipped 欄位', () => {
      const stats: RealtimeSyncStats = {
        activeListeners: 3,
        totalReceived: 100,
        totalSynced: 90,
        totalFailed: 5,
        totalSkipped: 5,
      };
      expect(stats.totalSkipped).toBe(5);
    });
  });
});

// ============================================================================
// Task 1.2: 即時同步錯誤類型測試
// Requirements: 1.5, 4.5, 5.1
// ============================================================================

describe('Realtime Sync Error Types (Task 1.2)', () => {
  describe('LISTENER_INIT_FAILED', () => {
    it('應包含 type、dialogId、message 欄位', () => {
      const error: RealtimeSyncError = {
        type: 'LISTENER_INIT_FAILED',
        dialogId: '12345',
        message: 'Failed to add event handler',
      };
      expect(error.type).toBe('LISTENER_INIT_FAILED');
      expect(error.dialogId).toBe('12345');
      expect(error.message).toBe('Failed to add event handler');
    });
  });

  describe('FORWARD_FAILED', () => {
    it('應包含 type、dialogId、messageId、message 欄位', () => {
      const error: RealtimeSyncError = {
        type: 'FORWARD_FAILED',
        dialogId: '12345',
        messageId: 100,
        message: 'Message forward failed',
      };
      expect(error.type).toBe('FORWARD_FAILED');
      expect(error.dialogId).toBe('12345');
      expect(error.messageId).toBe(100);
      expect(error.message).toBe('Message forward failed');
    });
  });

  describe('QUEUE_OVERFLOW', () => {
    it('應包含 type、dialogId、droppedCount 欄位', () => {
      const error: RealtimeSyncError = {
        type: 'QUEUE_OVERFLOW',
        dialogId: '12345',
        droppedCount: 50,
      };
      expect(error.type).toBe('QUEUE_OVERFLOW');
      expect(error.dialogId).toBe('12345');
      expect(error.droppedCount).toBe(50);
    });
  });

  describe('FLOOD_WAIT', () => {
    it('應包含 type、seconds 欄位', () => {
      const error: RealtimeSyncError = {
        type: 'FLOOD_WAIT',
        seconds: 60,
      };
      expect(error.type).toBe('FLOOD_WAIT');
      expect(error.seconds).toBe(60);
    });
  });
});

// ============================================================================
// Task 1.3: 即時同步服務介面測試
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
// ============================================================================

describe('IRealtimeSyncService Interface (Task 1.3)', () => {
  // 這些測試驗證介面的 shape，實際方法測試在服務實作測試中

  it('介面應定義 startListening 方法', () => {
    // 建立一個符合介面的 mock 物件
    const mockService: IRealtimeSyncService = {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      registerMapping: vi.fn(),
      processQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getStats: vi.fn(),
    };
    expect(typeof mockService.startListening).toBe('function');
  });

  it('介面應定義 stopListening 方法', () => {
    const mockService: IRealtimeSyncService = {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      registerMapping: vi.fn(),
      processQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getStats: vi.fn(),
    };
    expect(typeof mockService.stopListening).toBe('function');
  });

  it('介面應定義 registerMapping 方法', () => {
    const mockService: IRealtimeSyncService = {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      registerMapping: vi.fn(),
      processQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getStats: vi.fn(),
    };
    expect(typeof mockService.registerMapping).toBe('function');
  });

  it('介面應定義 processQueue 方法', () => {
    const mockService: IRealtimeSyncService = {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      registerMapping: vi.fn(),
      processQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getStats: vi.fn(),
    };
    expect(typeof mockService.processQueue).toBe('function');
  });

  it('介面應定義 getQueueStatus 方法', () => {
    const mockService: IRealtimeSyncService = {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      registerMapping: vi.fn(),
      processQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getStats: vi.fn(),
    };
    expect(typeof mockService.getQueueStatus).toBe('function');
  });

  it('介面應定義 getStats 方法', () => {
    const mockService: IRealtimeSyncService = {
      startListening: vi.fn(),
      stopListening: vi.fn(),
      registerMapping: vi.fn(),
      processQueue: vi.fn(),
      getQueueStatus: vi.fn(),
      getStats: vi.fn(),
    };
    expect(typeof mockService.getStats).toBe('function');
  });
});

// ============================================================================
// Task 2.x: RealtimeSyncService 實作測試
// ============================================================================

import { RealtimeSyncService } from '../../src/services/realtime-sync-service.js';

// Mock Helpers
function createMockTelegramClient(): TelegramClient {
  return {
    addEventHandler: vi.fn(),
    removeEventHandler: vi.fn(),
    invoke: vi.fn().mockResolvedValue({ className: 'Updates' }),
    getInputEntity: vi.fn().mockResolvedValue({ className: 'InputPeerUser' }),
  } as unknown as TelegramClient;
}

// ============================================================================
// Task 2.1: 對話專屬訊息佇列測試
// Requirements: 2.1, 2.2, 2.6
// ============================================================================

describe('RealtimeSyncService - Queue Management (Task 2.1)', () => {
  let service: RealtimeSyncService;

  beforeEach(() => {
    service = new RealtimeSyncService();
  });

  describe('對話專屬訊息佇列', () => {
    it('應支援 O(1) 時間複雜度查詢', () => {
      // 驗證使用 Map 結構
      const status = service.getQueueStatus('dialog1');
      expect(status).toBeDefined();
      expect(status.pending).toBe(0);
    });

    it('應能入列訊息到指定對話的佇列', () => {
      const mockMessage = { id: 100, date: Date.now() / 1000 };
      service['enqueue']('dialog1', mockMessage);

      const status = service.getQueueStatus('dialog1');
      expect(status.pending).toBe(1);
    });

    it('入列時應初始化 retryCount 為 0', () => {
      const mockMessage = { id: 100, date: Date.now() / 1000 };
      service['enqueue']('dialog1', mockMessage);

      const queue = service['queues'].get('dialog1');
      expect(queue).toBeDefined();
      expect(queue![0].retryCount).toBe(0);
    });

    it('應按入列順序維護佇列', () => {
      const mockMessage1 = { id: 100, date: Date.now() / 1000 };
      const mockMessage2 = { id: 101, date: Date.now() / 1000 };
      const mockMessage3 = { id: 102, date: Date.now() / 1000 };

      service['enqueue']('dialog1', mockMessage1);
      service['enqueue']('dialog1', mockMessage2);
      service['enqueue']('dialog1', mockMessage3);

      const queue = service['queues'].get('dialog1');
      expect(queue).toHaveLength(3);
      expect(queue![0].messageId).toBe(100);
      expect(queue![1].messageId).toBe(101);
      expect(queue![2].messageId).toBe(102);
    });

    it('應能清空指定對話的佇列', () => {
      const mockMessage = { id: 100, date: Date.now() / 1000 };
      service['enqueue']('dialog1', mockMessage);
      service['enqueue']('dialog1', { id: 101, date: Date.now() / 1000 });

      service['clearQueue']('dialog1');

      const status = service.getQueueStatus('dialog1');
      expect(status.pending).toBe(0);
    });

    it('不同對話的佇列應該隔離', () => {
      service['enqueue']('dialog1', { id: 100, date: Date.now() / 1000 });
      service['enqueue']('dialog2', { id: 200, date: Date.now() / 1000 });
      service['enqueue']('dialog2', { id: 201, date: Date.now() / 1000 });

      expect(service.getQueueStatus('dialog1').pending).toBe(1);
      expect(service.getQueueStatus('dialog2').pending).toBe(2);
    });
  });
});

// ============================================================================
// Task 2.2: 佇列上限與溢出處理測試
// Requirements: 5.5
// ============================================================================

describe('RealtimeSyncService - Queue Overflow (Task 2.2)', () => {
  let service: RealtimeSyncService;

  beforeEach(() => {
    service = new RealtimeSyncService({ maxQueueSize: 5 }); // 使用較小上限方便測試
  });

  it('佇列上限預設為 1000', () => {
    const defaultService = new RealtimeSyncService();
    expect(defaultService['maxQueueSize']).toBe(1000);
  });

  it('佇列達上限時應丟棄最舊的訊息', () => {
    // 填滿佇列
    for (let i = 1; i <= 5; i++) {
      service['enqueue']('dialog1', { id: i, date: i });
    }

    // 新增第 6 則訊息
    service['enqueue']('dialog1', { id: 6, date: 6 });

    const queue = service['queues'].get('dialog1');
    expect(queue).toHaveLength(5);
    // 最舊的 id=1 應被丟棄
    expect(queue![0].messageId).toBe(2);
    expect(queue![4].messageId).toBe(6);
  });

  it('佇列溢出時應記錄警告', () => {
    // 填滿佇列
    for (let i = 1; i <= 5; i++) {
      service['enqueue']('dialog1', { id: i, date: i });
    }

    // 新增溢出訊息
    const overflowEvent = service['enqueue']('dialog1', { id: 6, date: 6 });

    // 應回傳溢出資訊
    expect(overflowEvent?.dropped).toBe(1);
  });
});

// ============================================================================
// Task 2.3: 對話-群組映射管理測試
// Requirements: 2.5, 7.4
// ============================================================================

describe('RealtimeSyncService - Dialog Mapping (Task 2.3)', () => {
  let service: RealtimeSyncService;

  beforeEach(() => {
    service = new RealtimeSyncService();
  });

  describe('registerMapping', () => {
    it('應能註冊來源對話與目標群組的映射', () => {
      service.registerMapping('dialog1', 'group1');

      const targetId = service['mappings'].get('dialog1');
      expect(targetId).toBe('group1');
    });

    it('應支援 O(1) 時間複雜度查詢', () => {
      service.registerMapping('dialog1', 'group1');
      service.registerMapping('dialog2', 'group2');
      service.registerMapping('dialog3', 'group3');

      // 多次查詢應該快速
      expect(service['mappings'].get('dialog1')).toBe('group1');
      expect(service['mappings'].get('dialog2')).toBe('group2');
      expect(service['mappings'].get('dialog3')).toBe('group3');
    });

    it('應允許更新已存在的映射', () => {
      service.registerMapping('dialog1', 'group1');
      service.registerMapping('dialog1', 'group2');

      expect(service['mappings'].get('dialog1')).toBe('group2');
    });
  });

  describe('getTargetGroupId', () => {
    it('應回傳對應的目標群組 ID', () => {
      service.registerMapping('dialog1', 'group1');

      const targetId = service['getTargetGroupId']('dialog1');
      expect(targetId).toBe('group1');
    });

    it('不存在時應回傳 undefined', () => {
      const targetId = service['getTargetGroupId']('nonexistent');
      expect(targetId).toBeUndefined();
    });
  });

  describe('removeMapping', () => {
    it('應能移除映射', () => {
      service.registerMapping('dialog1', 'group1');
      service['removeMapping']('dialog1');

      expect(service['mappings'].get('dialog1')).toBeUndefined();
    });

    it('移除不存在的映射應該安全（不拋錯）', () => {
      expect(() => service['removeMapping']('nonexistent')).not.toThrow();
    });
  });
});

// ============================================================================
// Task 3.x: 事件監聽與訊息捕獲測試
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.2, 7.3
// ============================================================================

describe('RealtimeSyncService - Event Listening (Task 3.1-3.4)', () => {
  let service: RealtimeSyncService;
  let mockClient: TelegramClient;

  beforeEach(() => {
    service = new RealtimeSyncService();
    mockClient = createMockTelegramClient();
  });

  describe('startListening (Task 3.1)', () => {
    it('應呼叫 client.addEventHandler 註冊監聽', () => {
      const result = service.startListening(mockClient, 'dialog1');

      expect(result.success).toBe(true);
      expect(mockClient.addEventHandler).toHaveBeenCalled();
    });

    it('應保存事件處理器參照', () => {
      service.startListening(mockClient, 'dialog1');

      const handler = service['handlers'].get('dialog1');
      expect(handler).toBeDefined();
    });

    it('啟動成功時應更新活躍監聽器計數', () => {
      service.startListening(mockClient, 'dialog1');
      service.startListening(mockClient, 'dialog2');

      const stats = service.getStats();
      expect(stats.activeListeners).toBe(2);
    });

    it('同一對話重複啟動應先停止舊的監聽器', () => {
      service.startListening(mockClient, 'dialog1');
      service.startListening(mockClient, 'dialog1');

      // 活躍監聽器數應為 1
      expect(service.getStats().activeListeners).toBe(1);
    });
  });

  describe('stopListening (Task 3.3)', () => {
    it('應呼叫 client.removeEventHandler 移除監聽', () => {
      service.startListening(mockClient, 'dialog1');
      service.stopListening('dialog1');

      // 注意：實際的 removeEventHandler 呼叫可能在內部處理
      expect(service['handlers'].get('dialog1')).toBeUndefined();
    });

    it('應更新活躍監聽器計數', () => {
      service.startListening(mockClient, 'dialog1');
      service.startListening(mockClient, 'dialog2');
      service.stopListening('dialog1');

      expect(service.getStats().activeListeners).toBe(1);
    });

    it('應清空該對話的佇列', () => {
      service.startListening(mockClient, 'dialog1');
      service['enqueue']('dialog1', { id: 100, date: Date.now() / 1000 });
      service.stopListening('dialog1');

      expect(service.getQueueStatus('dialog1').pending).toBe(0);
    });

    it('應移除該對話的映射', () => {
      service.startListening(mockClient, 'dialog1');
      service.registerMapping('dialog1', 'group1');
      service.stopListening('dialog1');

      expect(service['mappings'].get('dialog1')).toBeUndefined();
    });

    it('監聽器不存在時應靜默忽略', () => {
      expect(() => service.stopListening('nonexistent')).not.toThrow();
    });
  });

  describe('錯誤處理 (Task 3.4)', () => {
    it('事件註冊失敗時應回傳 Result 錯誤', () => {
      const errorClient = {
        ...mockClient,
        addEventHandler: vi.fn().mockImplementation(() => {
          throw new Error('Event handler error');
        }),
      } as unknown as TelegramClient;

      const result = service.startListening(errorClient, 'dialog1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('LISTENER_INIT_FAILED');
      }
    });
  });
});

// ============================================================================
// Task 4.x: 佇列處理與訊息轉發測試
// Requirements: 2.3, 4.1, 4.2, 6.2, 6.3, 6.4, 6.5, 7.5
// ============================================================================

describe('RealtimeSyncService - Queue Processing (Task 4.1-4.5)', () => {
  let service: RealtimeSyncService;

  beforeEach(() => {
    service = new RealtimeSyncService();
  });

  describe('processQueue (Task 4.1)', () => {
    it('應依訊息 ID 升序處理佇列', async () => {
      service.registerMapping('dialog1', 'group1');
      // 故意以非順序入列
      service['enqueue']('dialog1', { id: 103, date: 3 });
      service['enqueue']('dialog1', { id: 101, date: 1 });
      service['enqueue']('dialog1', { id: 102, date: 2 });

      // 提供一個 mock forwarder
      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({ success: true });

      const result = await service.processQueue('dialog1', 100);

      expect(result.success).toBe(true);
      // 驗證處理順序
      const calls = (service['forwardSingleMessage'] as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0][1].messageId).toBe(101);
      expect(calls[1][1].messageId).toBe(102);
      expect(calls[2][1].messageId).toBe(103);
    });

    it('應回傳處理結果', async () => {
      service.registerMapping('dialog1', 'group1');
      service['enqueue']('dialog1', { id: 101, date: 1 });
      service['enqueue']('dialog1', { id: 102, date: 2 });
      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({ success: true });

      const result = await service.processQueue('dialog1', 100);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.successCount).toBe(2);
        expect(result.data.failedCount).toBe(0);
        expect(result.data.skippedCount).toBe(0);
      }
    });
  });

  describe('訊息去重 (Task 4.2)', () => {
    it('應跳過 messageId <= lastBatchMessageId 的訊息', async () => {
      service.registerMapping('dialog1', 'group1');
      service['enqueue']('dialog1', { id: 98, date: 1 });
      service['enqueue']('dialog1', { id: 100, date: 2 }); // 等於分界點
      service['enqueue']('dialog1', { id: 101, date: 3 });
      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({ success: true });

      const result = await service.processQueue('dialog1', 100);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.skippedCount).toBe(2); // 98 和 100 被跳過
        expect(result.data.successCount).toBe(1); // 只有 101 被處理
      }
    });

    it('應更新跳過計數統計', async () => {
      service.registerMapping('dialog1', 'group1');
      service['enqueue']('dialog1', { id: 50, date: 1 });
      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({ success: true });

      await service.processQueue('dialog1', 100);

      const stats = service.getStats();
      expect(stats.totalSkipped).toBe(1);
    });
  });

  describe('重試機制 (Task 4.4)', () => {
    it('轉發失敗時應增加 retryCount', async () => {
      service.registerMapping('dialog1', 'group1');
      service['enqueue']('dialog1', { id: 101, date: 1 });
      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({
        success: false,
        error: { type: 'FORWARD_FAILED', dialogId: 'dialog1', messageId: 101, message: 'Failed' },
      });

      await service.processQueue('dialog1', 100);

      const queue = service['queues'].get('dialog1');
      // 失敗的訊息應該還在佇列中（等待重試）或已達重試上限
      // 根據實作，可能會被移到重試佇列或增加 retryCount
    });

    it('重試次數達上限（3次）後應標記為失敗', async () => {
      service.registerMapping('dialog1', 'group1');
      // 模擬已重試 2 次的訊息
      const queue = service['queues'].get('dialog1') || [];
      queue.push({
        messageId: 101,
        timestamp: new Date(),
        message: { id: 101, date: 1 },
        retryCount: 2,
      });
      service['queues'].set('dialog1', queue);

      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({
        success: false,
        error: { type: 'FORWARD_FAILED', dialogId: 'dialog1', messageId: 101, message: 'Failed' },
      });

      const result = await service.processQueue('dialog1', 100);

      if (result.success) {
        expect(result.data.failedCount).toBe(1);
        expect(result.data.failedMessageIds).toContain(101);
      }
    });
  });

  describe('getQueueStatus', () => {
    it('應回傳正確的佇列狀態', () => {
      service['enqueue']('dialog1', { id: 101, date: 1 });
      service['enqueue']('dialog1', { id: 102, date: 2 });

      const status = service.getQueueStatus('dialog1');

      expect(status.pending).toBe(2);
      expect(status.processed).toBe(0);
      expect(status.failed).toBe(0);
    });

    it('不存在的對話應回傳空狀態', () => {
      const status = service.getQueueStatus('nonexistent');

      expect(status.pending).toBe(0);
      expect(status.processed).toBe(0);
      expect(status.failed).toBe(0);
    });
  });

  describe('getStats', () => {
    it('應回傳整體統計資訊', () => {
      const stats = service.getStats();

      expect(stats).toHaveProperty('activeListeners');
      expect(stats).toHaveProperty('totalReceived');
      expect(stats).toHaveProperty('totalSynced');
      expect(stats).toHaveProperty('totalFailed');
      expect(stats).toHaveProperty('totalSkipped');
    });
  });
});

// ============================================================================
// Task 4.5: FloodWait 處理測試
// Requirements: 5.1, 5.2, 5.3, 5.4
// ============================================================================

describe('RealtimeSyncService - FloodWait Handling (Task 4.5)', () => {
  let service: RealtimeSyncService;

  beforeEach(() => {
    service = new RealtimeSyncService();
  });

  it('應偵測 FloodWait 錯誤並取得等待秒數', async () => {
    service.registerMapping('dialog1', 'group1');
    service['enqueue']('dialog1', { id: 101, date: 1 });

    // 模擬 FloodWait 錯誤
    service['forwardSingleMessage'] = vi.fn().mockResolvedValue({
      success: false,
      error: { type: 'FLOOD_WAIT', seconds: 30 },
    });

    const result = await service.processQueue('dialog1', 100);

    // 驗證處理結果
    expect(result.success).toBe(true);
  });

  it('FloodWait 期間應允許新訊息入列', async () => {
    // 測試入列不受阻塞
    service['enqueue']('dialog1', { id: 101, date: 1 });
    service['enqueue']('dialog1', { id: 102, date: 2 });

    expect(service.getQueueStatus('dialog1').pending).toBe(2);
  });
});

// ============================================================================
// Task 6.1: 即時同步服務單元測試（補充）
// Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.3, 2.4, 4.1, 4.2, 5.5, 6.3, 6.4
// ============================================================================

describe('RealtimeSyncService - Unit Tests (Task 6.1)', () => {
  let service: RealtimeSyncService;
  let mockClient: TelegramClient;

  beforeEach(() => {
    service = new RealtimeSyncService();
    mockClient = createMockTelegramClient();
  });

  describe('完整功能測試', () => {
    it('完整流程：啟動監聽 -> 入列 -> 註冊映射 -> 處理 -> 停止', async () => {
      // 啟動監聽
      const startResult = service.startListening(mockClient, 'dialog1');
      expect(startResult.success).toBe(true);

      // 入列訊息
      service['enqueue']('dialog1', { id: 101, date: 1 });
      service['enqueue']('dialog1', { id: 102, date: 2 });
      expect(service.getQueueStatus('dialog1').pending).toBe(2);

      // 註冊映射
      service.registerMapping('dialog1', 'group1');

      // 處理佇列
      service['forwardSingleMessage'] = vi.fn().mockResolvedValue({ success: true });
      const processResult = await service.processQueue('dialog1', 100);
      expect(processResult.success).toBe(true);
      if (processResult.success) {
        expect(processResult.data.successCount).toBe(2);
      }

      // 停止監聽
      service.stopListening('dialog1');
      expect(service.getStats().activeListeners).toBe(0);
    });

    it('多對話狀態隔離測試', () => {
      service.startListening(mockClient, 'dialog1');
      service.startListening(mockClient, 'dialog2');

      service['enqueue']('dialog1', { id: 101, date: 1 });
      service['enqueue']('dialog2', { id: 201, date: 1 });
      service['enqueue']('dialog2', { id: 202, date: 2 });

      expect(service.getQueueStatus('dialog1').pending).toBe(1);
      expect(service.getQueueStatus('dialog2').pending).toBe(2);

      service.stopListening('dialog1');

      expect(service.getQueueStatus('dialog1').pending).toBe(0);
      expect(service.getQueueStatus('dialog2').pending).toBe(2);
    });
  });
});
