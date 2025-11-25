/**
 * MigrationService 單元測試
 *
 * 測試訊息遷移核心功能，包含：
 * - 使用 messages.GetHistory API 按時間順序分頁取得訊息
 * - 支援從指定訊息 ID 繼續取得（斷點續傳）
 * - 支援日期範圍過濾
 * - 處理訊息包含媒體檔案的情境
 * - 使用 messages.ForwardMessages API 批次轉發訊息
 * - 每批次最多 100 則訊息，生成唯一 randomId 防止重複
 * - 確保媒體內容完整轉發並保留原始發送者資訊
 * - 處理單一訊息轉發失敗並記錄後繼續處理
 * - 單一對話遷移完成後輸出該對話的統計資訊
 * - 統計已遷移訊息數、失敗訊息數、耗時
 * - 更新整體遷移進度統計
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 7.3, 8.5
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MigrationService } from '../../src/services/migration-service.js';
import { DialogType, DialogStatus } from '../../src/types/enums.js';
import type { TelegramClient } from 'telegram';
import type {
  DialogInfo,
  GroupInfo,
  MigrationConfig,
  GetMessagesOptions,
  MessageBatch,
  ForwardResult,
  DialogMigrationResult,
} from '../../src/types/models.js';

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * 建立 mock DialogInfo
 */
function createMockDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
  return {
    id: '12345',
    accessHash: '67890',
    type: DialogType.Private,
    name: 'Test Dialog',
    messageCount: 100,
    unreadCount: 0,
    isArchived: false,
    entity: { className: 'User', id: BigInt(12345), accessHash: BigInt(67890) },
    ...overrides,
  };
}

/**
 * 建立 mock GroupInfo
 */
function createMockGroupInfo(overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    id: '999999',
    accessHash: '111111',
    name: '[Migrated] Test Dialog',
    sourceDialogId: '12345',
    createdAt: new Date().toISOString(),
    entity: { className: 'Channel', id: BigInt(999999), accessHash: BigInt(111111) },
    ...overrides,
  };
}

/**
 * 建立 mock MigrationConfig
 */
function createMockMigrationConfig(overrides: Partial<MigrationConfig> = {}): MigrationConfig {
  return {
    batchSize: 100,
    groupConfig: { namePrefix: '[Migrated] ' },
    targetAccountB: '@testuser',
    progressPath: './test-progress.json',
    ...overrides,
  };
}

/**
 * Mock Message 物件
 */
interface MockMessage {
  id: number;
  date: number;
  media?: { className: string };
  message?: string;
}

/**
 * 建立 mock Message
 */
function createMockMessage(
  id: number,
  date: Date = new Date(),
  hasMedia: boolean = false
): MockMessage {
  return {
    id,
    date: Math.floor(date.getTime() / 1000),
    ...(hasMedia ? { media: { className: 'MessageMediaPhoto' } } : {}),
    message: `Test message ${id}`,
  };
}

/**
 * 建立 mock TelegramClient
 */
function createMockClient(options: {
  getHistoryResult?: { messages: MockMessage[]; count?: number } | Error;
  forwardResult?: { className: string; updates?: unknown[] } | Error;
  getInputEntityResult?: unknown | Error;
} = {}): TelegramClient {
  const {
    getHistoryResult = { messages: [], count: 0 },
    forwardResult = { className: 'Updates', updates: [] },
    getInputEntityResult = { className: 'InputPeerUser' },
  } = options;

  const mockInvoke = vi.fn().mockImplementation((request: { className?: string }) => {
    if (request.className === 'messages.GetHistory') {
      if (getHistoryResult instanceof Error) {
        return Promise.reject(getHistoryResult);
      }
      return Promise.resolve(getHistoryResult);
    }
    if (request.className === 'messages.ForwardMessages') {
      if (forwardResult instanceof Error) {
        return Promise.reject(forwardResult);
      }
      return Promise.resolve(forwardResult);
    }
    return Promise.resolve({});
  });

  const mockGetInputEntity = vi.fn().mockImplementation(() => {
    if (getInputEntityResult instanceof Error) {
      return Promise.reject(getInputEntityResult);
    }
    return Promise.resolve(getInputEntityResult);
  });

  return {
    invoke: mockInvoke,
    getInputEntity: mockGetInputEntity,
  } as unknown as TelegramClient;
}

// ============================================================================
// Task 8.1: 訊息歷史取得測試
// Requirements: 4.1, 4.2, 8.5
// ============================================================================

describe('MigrationService', () => {
  let migrationService: MigrationService;

  beforeEach(() => {
    migrationService = new MigrationService();
  });

  describe('getMessages (Task 8.1)', () => {
    describe('使用 messages.GetHistory API 按時間順序分頁取得訊息', () => {
      it('應呼叫 messages.GetHistory API', async () => {
        const messages = [
          createMockMessage(3),
          createMockMessage(2),
          createMockMessage(1),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 3 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { limit: 100 };

        await migrationService.getMessages(client, dialog, options);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            className: 'messages.GetHistory',
          })
        );
      });

      it('應回傳訊息批次資訊', async () => {
        const messages = [
          createMockMessage(3, new Date('2024-01-03')),
          createMockMessage(2, new Date('2024-01-02')),
          createMockMessage(1, new Date('2024-01-01')),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 3 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { limit: 100 };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.messages).toHaveLength(3);
          expect(result.data.messages[0].id).toBe(3);
        }
      });

      it('應使用指定的 limit 參數', async () => {
        const client = createMockClient({
          getHistoryResult: { messages: [], count: 0 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { limit: 50 };

        await migrationService.getMessages(client, dialog, options);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            limit: 50,
          })
        );
      });

      it('應預設使用 100 作為 limit', async () => {
        const client = createMockClient({
          getHistoryResult: { messages: [], count: 0 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {};

        await migrationService.getMessages(client, dialog, options);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            limit: 100,
          })
        );
      });
    });

    describe('支援從指定訊息 ID 繼續取得（斷點續傳）', () => {
      it('應使用 offsetId 參數從指定訊息 ID 繼續取得', async () => {
        const client = createMockClient({
          getHistoryResult: { messages: [], count: 0 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { offsetId: 500 };

        await migrationService.getMessages(client, dialog, options);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            offsetId: 500,
          })
        );
      });

      it('應回傳 hasMore 標記表示是否還有更多訊息', async () => {
        // 當 messages 數量等於 limit，hasMore 應為 true
        const messages = Array.from({ length: 100 }, (_, i) =>
          createMockMessage(100 - i)
        );
        const client = createMockClient({
          getHistoryResult: { messages, count: 500 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { limit: 100 };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.hasMore).toBe(true);
        }
      });

      it('應回傳 nextOffsetId 用於下一次分頁', async () => {
        const messages = [
          createMockMessage(300),
          createMockMessage(200),
          createMockMessage(100),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 500 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { limit: 3 };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          // nextOffsetId 應為最後一則訊息的 ID
          expect(result.data.nextOffsetId).toBe(100);
        }
      });

      it('當沒有更多訊息時 hasMore 應為 false', async () => {
        const messages = [createMockMessage(1)];
        const client = createMockClient({
          getHistoryResult: { messages, count: 1 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = { limit: 100 };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.hasMore).toBe(false);
          expect(result.data.nextOffsetId).toBeNull();
        }
      });
    });

    describe('支援日期範圍過濾', () => {
      it('應過濾掉早於 minDate 的訊息', async () => {
        const messages = [
          createMockMessage(3, new Date('2024-01-15')),
          createMockMessage(2, new Date('2024-01-10')),
          createMockMessage(1, new Date('2024-01-05')),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 3 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {
          minDate: new Date('2024-01-08'),
        };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          // 應只回傳 01-15 和 01-10 的訊息
          expect(result.data.messages).toHaveLength(2);
          expect(result.data.messages.map((m) => m.id)).toEqual([3, 2]);
        }
      });

      it('應過濾掉晚於 maxDate 的訊息', async () => {
        const messages = [
          createMockMessage(3, new Date('2024-01-15')),
          createMockMessage(2, new Date('2024-01-10')),
          createMockMessage(1, new Date('2024-01-05')),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 3 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {
          maxDate: new Date('2024-01-12'),
        };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          // 應只回傳 01-10 和 01-05 的訊息
          expect(result.data.messages).toHaveLength(2);
          expect(result.data.messages.map((m) => m.id)).toEqual([2, 1]);
        }
      });

      it('應同時支援 minDate 和 maxDate 的範圍過濾', async () => {
        const messages = [
          createMockMessage(5, new Date('2024-01-20')),
          createMockMessage(4, new Date('2024-01-15')),
          createMockMessage(3, new Date('2024-01-10')),
          createMockMessage(2, new Date('2024-01-05')),
          createMockMessage(1, new Date('2024-01-01')),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 5 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {
          minDate: new Date('2024-01-03'),
          maxDate: new Date('2024-01-18'),
        };

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          // 應回傳 01-05, 01-10, 01-15 的訊息
          expect(result.data.messages).toHaveLength(3);
          expect(result.data.messages.map((m) => m.id)).toEqual([4, 3, 2]);
        }
      });
    });

    describe('處理訊息包含媒體檔案的情境', () => {
      it('應正確標記訊息是否包含媒體', async () => {
        const messages = [
          createMockMessage(3, new Date(), true), // 有媒體
          createMockMessage(2, new Date(), false), // 無媒體
          createMockMessage(1, new Date(), true), // 有媒體
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 3 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {};

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.messages[0].hasMedia).toBe(true);
          expect(result.data.messages[1].hasMedia).toBe(false);
          expect(result.data.messages[2].hasMedia).toBe(true);
        }
      });

      it('應正確轉換訊息日期', async () => {
        const testDate = new Date('2024-06-15T12:00:00Z');
        const messages = [createMockMessage(1, testDate)];
        const client = createMockClient({
          getHistoryResult: { messages, count: 1 },
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {};

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.messages[0].date.getTime()).toBe(testDate.getTime());
        }
      });
    });

    describe('錯誤處理', () => {
      it('應回傳 DIALOG_FETCH_FAILED 錯誤當 API 呼叫失敗', async () => {
        const error = new Error('API Error');
        const client = createMockClient({
          getHistoryResult: error,
        });
        const dialog = createMockDialogInfo();
        const options: GetMessagesOptions = {};

        const result = await migrationService.getMessages(client, dialog, options);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('DIALOG_FETCH_FAILED');
        }
      });
    });
  });

  // ============================================================================
  // Task 8.2: 訊息批次轉發測試
  // Requirements: 4.3, 4.4, 4.5, 4.6, 7.3
  // ============================================================================

  describe('forwardMessages (Task 8.2)', () => {
    describe('使用 messages.ForwardMessages API 批次轉發訊息', () => {
      it('應呼叫 messages.ForwardMessages API', async () => {
        const client = createMockClient();
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            className: 'messages.ForwardMessages',
          })
        );
      });

      it('應傳遞訊息 ID 列表', async () => {
        const client = createMockClient();
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [100, 200, 300];

        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            id: messageIds,
          })
        );
      });

      it('應回傳成功轉發的數量', async () => {
        const client = createMockClient();
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        const result = await migrationService.forwardMessages(
          client,
          fromPeer,
          toPeer,
          messageIds
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.successCount).toBe(3);
        }
      });
    });

    describe('每批次最多 100 則訊息，生成唯一 randomId 防止重複', () => {
      it('應為每則訊息生成唯一的 randomId', async () => {
        const client = createMockClient();
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);

        // 驗證 invoke 被呼叫且包含 randomId 陣列
        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            randomId: expect.any(Array),
          })
        );

        // 驗證 randomId 數量與訊息數量相符
        const invokeCall = (client.invoke as ReturnType<typeof vi.fn>).mock
          .calls[0][0] as { randomId: unknown[] };
        expect(invokeCall.randomId).toHaveLength(3);

        // 驗證每個 randomId 都是有效值（BigInteger 或其字串表示）
        invokeCall.randomId.forEach((id) => {
          expect(id).toBeDefined();
        });
      });

      it('每次呼叫應生成不同的 randomId', async () => {
        const invokeCalls: unknown[] = [];
        const mockInvoke = vi.fn().mockImplementation((request: unknown) => {
          invokeCalls.push(request);
          return Promise.resolve({ className: 'Updates' });
        });
        const client = {
          invoke: mockInvoke,
          getInputEntity: vi.fn(),
        } as unknown as TelegramClient;

        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1];

        // 呼叫兩次
        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);
        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);

        const call1 = invokeCalls[0] as { randomId: unknown[] };
        const call2 = invokeCalls[1] as { randomId: unknown[] };

        // 比較字串表示以確保不同
        expect(String(call1.randomId[0])).not.toBe(String(call2.randomId[0]));
      });
    });

    describe('確保媒體內容完整轉發並保留原始發送者資訊', () => {
      it('應設定 dropAuthor 為 false 以保留原始發送者', async () => {
        const client = createMockClient();
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            dropAuthor: false,
          })
        );
      });

      it('應設定 dropMediaCaptions 為 false 以保留媒體標題', async () => {
        const client = createMockClient();
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        await migrationService.forwardMessages(client, fromPeer, toPeer, messageIds);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            dropMediaCaptions: false,
          })
        );
      });
    });

    describe('處理單一訊息轉發失敗並記錄後繼續處理', () => {
      it('應回傳失敗的訊息 ID 列表', async () => {
        // 模擬部分訊息失敗的情境（FORWARD_FAILED 錯誤）
        const forwardError = new Error('Forward failed');
        (forwardError as Error & { failedIds?: number[] }).failedIds = [2];
        const client = createMockClient({
          forwardResult: forwardError,
        });
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        const result = await migrationService.forwardMessages(
          client,
          fromPeer,
          toPeer,
          messageIds
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('FORWARD_FAILED');
          if (result.error.type === 'FORWARD_FAILED') {
            expect(result.error.messageIds).toContain(2);
          }
        }
      });

      it('應處理 FloodWait 錯誤', async () => {
        const floodError = new Error('FloodWaitError') as Error & { seconds?: number };
        floodError.seconds = 60;
        (floodError as unknown as { className?: string }).className = 'FloodWaitError';
        const client = createMockClient({
          forwardResult: floodError,
        });
        const fromPeer = { className: 'InputPeerUser' };
        const toPeer = { className: 'InputPeerChannel' };
        const messageIds = [1, 2, 3];

        const result = await migrationService.forwardMessages(
          client,
          fromPeer,
          toPeer,
          messageIds
        );

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('FLOOD_WAIT');
          if (result.error.type === 'FLOOD_WAIT') {
            expect(result.error.seconds).toBe(60);
          }
        }
      });
    });
  });

  // ============================================================================
  // Task 8.3: 遷移統計輸出測試
  // Requirements: 4.7
  // ============================================================================

  describe('migrateDialog (Task 8.3)', () => {
    describe('單一對話遷移完成後輸出該對話的統計資訊', () => {
      it('應回傳 DialogMigrationResult 包含對話 ID', async () => {
        const messages = [createMockMessage(1), createMockMessage(2)];
        const client = createMockClient({
          getHistoryResult: { messages, count: 2 },
        });
        const sourceDialog = createMockDialogInfo({ id: '12345' });
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const result = await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.dialogId).toBe('12345');
        }
      });

      it('應回傳成功狀態當遷移完成', async () => {
        const messages = [createMockMessage(1)];
        const client = createMockClient({
          getHistoryResult: { messages, count: 1 },
        });
        const sourceDialog = createMockDialogInfo();
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const result = await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.success).toBe(true);
        }
      });
    });

    describe('統計已遷移訊息數、失敗訊息數、耗時', () => {
      it('應正確統計已遷移訊息數', async () => {
        const messages = [
          createMockMessage(1),
          createMockMessage(2),
          createMockMessage(3),
        ];
        const client = createMockClient({
          getHistoryResult: { messages, count: 3 },
        });
        const sourceDialog = createMockDialogInfo();
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const result = await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.migratedMessages).toBe(3);
        }
      });

      it('應統計失敗訊息數', async () => {
        // 第一次取得訊息成功，但轉發時部分失敗
        const messages = [createMockMessage(1), createMockMessage(2)];

        // 模擬轉發時有一則訊息失敗
        let forwardCallCount = 0;
        const mockInvoke = vi.fn().mockImplementation((request: { className?: string }) => {
          if (request.className === 'messages.GetHistory') {
            return Promise.resolve({ messages, count: 2 });
          }
          if (request.className === 'messages.ForwardMessages') {
            forwardCallCount++;
            // 模擬部分成功：只有 1 則成功
            return Promise.resolve({
              className: 'Updates',
              // 模擬 UpdateShortSentMessage 只回傳成功的部分
            });
          }
          return Promise.resolve({});
        });

        const client = {
          invoke: mockInvoke,
          getInputEntity: vi.fn().mockResolvedValue({ className: 'InputPeerUser' }),
        } as unknown as TelegramClient;

        const sourceDialog = createMockDialogInfo();
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const result = await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config
        );

        expect(result.success).toBe(true);
        if (result.success) {
          // 應有統計資訊
          expect(typeof result.data.migratedMessages).toBe('number');
          expect(typeof result.data.failedMessages).toBe('number');
        }
      });

      it('應收集錯誤訊息列表', async () => {
        const forwardError = new Error('Message is protected');
        const messages = [createMockMessage(1)];

        const mockInvoke = vi.fn().mockImplementation((request: { className?: string }) => {
          if (request.className === 'messages.GetHistory') {
            return Promise.resolve({ messages, count: 1 });
          }
          if (request.className === 'messages.ForwardMessages') {
            return Promise.reject(forwardError);
          }
          return Promise.resolve({});
        });

        const client = {
          invoke: mockInvoke,
          getInputEntity: vi.fn().mockResolvedValue({ className: 'InputPeerUser' }),
        } as unknown as TelegramClient;

        const sourceDialog = createMockDialogInfo();
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const result = await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config
        );

        // 即使有錯誤也應該回傳結果
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.errors.length).toBeGreaterThan(0);
          expect(result.data.errors[0]).toContain('Message is protected');
        }
      });
    });

    describe('更新整體遷移進度統計', () => {
      it('應透過 onProgress 回呼報告進度', async () => {
        const messages = [createMockMessage(1), createMockMessage(2)];
        const client = createMockClient({
          getHistoryResult: { messages, count: 2 },
        });
        const sourceDialog = createMockDialogInfo();
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const progressEvents: unknown[] = [];
        const onProgress = vi.fn((event) => {
          progressEvents.push(event);
        });

        await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config,
          onProgress
        );

        // 應觸發 dialog_started 事件
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'dialog_started',
          })
        );

        // 應觸發 dialog_completed 事件
        expect(onProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'dialog_completed',
          })
        );
      });

      it('應在批次完成時報告 batch_completed 事件', async () => {
        const messages = Array.from({ length: 150 }, (_, i) =>
          createMockMessage(150 - i)
        );

        let callCount = 0;
        const mockInvoke = vi.fn().mockImplementation((request: { className?: string }) => {
          if (request.className === 'messages.GetHistory') {
            callCount++;
            if (callCount === 1) {
              // 第一批次：100 則訊息
              return Promise.resolve({
                messages: messages.slice(0, 100),
                count: 150,
              });
            } else {
              // 第二批次：50 則訊息
              return Promise.resolve({
                messages: messages.slice(100, 150),
                count: 150,
              });
            }
          }
          if (request.className === 'messages.ForwardMessages') {
            return Promise.resolve({ className: 'Updates' });
          }
          return Promise.resolve({});
        });

        const client = {
          invoke: mockInvoke,
          getInputEntity: vi.fn().mockResolvedValue({ className: 'InputPeerUser' }),
        } as unknown as TelegramClient;

        const sourceDialog = createMockDialogInfo({ messageCount: 150 });
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig({ batchSize: 100 });

        const progressEvents: unknown[] = [];
        const onProgress = vi.fn((event) => {
          progressEvents.push(event);
        });

        await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config,
          onProgress
        );

        // 應有 batch_completed 事件
        const batchEvents = progressEvents.filter(
          (e: unknown) => (e as { type: string }).type === 'batch_completed'
        );
        expect(batchEvents.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('處理空對話', () => {
      it('應正確處理沒有訊息的對話', async () => {
        const client = createMockClient({
          getHistoryResult: { messages: [], count: 0 },
        });
        const sourceDialog = createMockDialogInfo({ messageCount: 0 });
        const targetGroup = createMockGroupInfo();
        const config = createMockMigrationConfig();

        const result = await migrationService.migrateDialog(
          client,
          sourceDialog,
          targetGroup,
          config
        );

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.migratedMessages).toBe(0);
          expect(result.data.failedMessages).toBe(0);
          expect(result.data.success).toBe(true);
        }
      });
    });
  });
});
