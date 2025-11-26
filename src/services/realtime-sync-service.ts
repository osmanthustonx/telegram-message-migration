/**
 * 即時訊息同步服務
 *
 * 管理遷移期間的新訊息監聽與延遲轉發功能：
 * - 監聽來源對話的新訊息事件（GramJS NewMessage）
 * - 將新訊息加入對話專屬佇列
 * - 批次遷移完成後依序處理佇列
 * - 去重邏輯確保不重複轉發已遷移訊息
 *
 * Requirements: 1.x, 2.x, 4.x, 5.x, 6.x, 7.x
 */

import type { TelegramClient } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import type { NewMessageEvent } from 'telegram/events/index.js';
import type { Result } from '../types/result.js';
import type { RealtimeSyncError } from '../types/errors.js';
import type {
  QueuedMessage,
  QueueStatus,
  QueueProcessResult,
  RealtimeSyncStats,
} from '../types/models.js';
import type { IRealtimeSyncService } from '../types/interfaces.js';
import { success, failure } from '../types/result.js';

/**
 * 即時同步服務設定
 */
export interface RealtimeSyncServiceConfig {
  /** 單一對話佇列上限 */
  maxQueueSize?: number;
  /** 最大重試次數 */
  maxRetries?: number;
}

/**
 * 事件處理器資訊
 */
interface HandlerInfo {
  /** 事件處理器函式 */
  handler: (event: NewMessageEvent) => void;
  /** TelegramClient 參照（用於移除監聽） */
  client: TelegramClient;
}

/**
 * 對話狀態追蹤
 */
interface DialogState {
  /** 已處理訊息數 */
  processed: number;
  /** 失敗訊息數 */
  failed: number;
}

/**
 * 入列結果
 */
interface EnqueueResult {
  /** 是否溢出 */
  overflow: boolean;
  /** 丟棄的訊息數 */
  dropped: number;
}

/**
 * 即時訊息同步服務實作
 */
export class RealtimeSyncService implements IRealtimeSyncService {
  /** 對話 ID -> 訊息佇列 */
  private readonly queues: Map<string, QueuedMessage[]> = new Map();

  /** 對話 ID -> 目標群組 ID */
  private readonly mappings: Map<string, string> = new Map();

  /** 對話 ID -> 事件處理器 */
  private readonly handlers: Map<string, HandlerInfo> = new Map();

  /** 對話 ID -> 狀態追蹤 */
  private readonly dialogStates: Map<string, DialogState> = new Map();

  /** 單一對話佇列上限 */
  private readonly maxQueueSize: number;

  /** 最大重試次數 */
  private readonly maxRetries: number;

  /** 統計資訊 */
  private stats: RealtimeSyncStats = {
    activeListeners: 0,
    totalReceived: 0,
    totalSynced: 0,
    totalFailed: 0,
    totalSkipped: 0,
  };

  constructor(config: RealtimeSyncServiceConfig = {}) {
    this.maxQueueSize = config.maxQueueSize ?? 1000;
    this.maxRetries = config.maxRetries ?? 3;
  }

  /**
   * 開始監聯對話的新訊息
   */
  startListening(
    client: TelegramClient,
    dialogId: string
  ): Result<void, RealtimeSyncError> {
    try {
      // 若已存在監聽器，先停止
      if (this.handlers.has(dialogId)) {
        this.stopListening(dialogId);
      }

      // 建立事件處理器
      const handler = (event: NewMessageEvent): void => {
        this.handleNewMessage(dialogId, event);
      };

      // 註冊事件監聽（使用 GramJS 的 NewMessage）
      // GramJS 的 chats 參數接受 EntityLike（包含字串或數字）
      const eventFilter = new NewMessage({
        chats: [dialogId],
      });
      client.addEventHandler(handler, eventFilter);

      // 保存處理器參照
      this.handlers.set(dialogId, { handler, client });

      // 初始化佇列與狀態
      if (!this.queues.has(dialogId)) {
        this.queues.set(dialogId, []);
      }
      if (!this.dialogStates.has(dialogId)) {
        this.dialogStates.set(dialogId, { processed: 0, failed: 0 });
      }

      // 更新統計
      this.stats.activeListeners++;

      return success(undefined);
    } catch (error) {
      return failure({
        type: 'LISTENER_INIT_FAILED',
        dialogId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * 停止監聽對話並清理資源
   */
  stopListening(dialogId: string): void {
    const handlerInfo = this.handlers.get(dialogId);
    if (handlerInfo) {
      // 移除事件監聽
      try {
        handlerInfo.client.removeEventHandler(
          handlerInfo.handler,
          new NewMessage({ chats: [dialogId] })
        );
      } catch {
        // 靜默忽略移除失敗
      }

      // 清理處理器參照
      this.handlers.delete(dialogId);

      // 更新統計
      this.stats.activeListeners = Math.max(0, this.stats.activeListeners - 1);
    }

    // 清空佇列
    this.clearQueue(dialogId);

    // 移除映射
    this.removeMapping(dialogId);

    // 移除狀態
    this.dialogStates.delete(dialogId);
  }

  /**
   * 註冊來源對話與目標群組的映射
   */
  registerMapping(sourceDialogId: string, targetGroupId: string): void {
    this.mappings.set(sourceDialogId, targetGroupId);
  }

  /**
   * 處理對話的待轉發佇列
   */
  async processQueue(
    dialogId: string,
    lastBatchMessageId: number
  ): Promise<Result<QueueProcessResult, RealtimeSyncError>> {
    const result: QueueProcessResult = {
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      failedMessageIds: [],
    };

    // 取得佇列並依 messageId 升序排序
    const queue = this.queues.get(dialogId) || [];
    queue.sort((a, b) => a.messageId - b.messageId);

    // 暫存需重試的訊息
    const retryQueue: QueuedMessage[] = [];

    // 逐一處理訊息
    for (const queuedMsg of queue) {
      // 去重：跳過 messageId <= lastBatchMessageId
      if (queuedMsg.messageId <= lastBatchMessageId) {
        result.skippedCount++;
        this.stats.totalSkipped++;
        continue;
      }

      // 嘗試轉發
      const forwardResult = await this.forwardSingleMessage(dialogId, queuedMsg);

      if (forwardResult.success) {
        result.successCount++;
        this.stats.totalSynced++;
        this.updateDialogState(dialogId, 'processed');
      } else {
        // 失敗處理
        queuedMsg.retryCount++;

        if (queuedMsg.retryCount >= this.maxRetries) {
          // 達重試上限，標記為失敗
          result.failedCount++;
          result.failedMessageIds.push(queuedMsg.messageId);
          this.stats.totalFailed++;
          this.updateDialogState(dialogId, 'failed');
        } else {
          // 加入重試佇列
          retryQueue.push(queuedMsg);
        }
      }
    }

    // 更新佇列（只保留需重試的訊息）
    this.queues.set(dialogId, retryQueue);

    return success(result);
  }

  /**
   * 取得對話的佇列狀態
   */
  getQueueStatus(dialogId: string): QueueStatus {
    const queue = this.queues.get(dialogId) || [];
    const state = this.dialogStates.get(dialogId) || { processed: 0, failed: 0 };

    return {
      pending: queue.length,
      processed: state.processed,
      failed: state.failed,
    };
  }

  /**
   * 取得整體同步統計
   */
  getStats(): RealtimeSyncStats {
    return { ...this.stats };
  }

  // ============================================================================
  // 內部方法
  // ============================================================================

  /**
   * 處理新訊息事件
   */
  private handleNewMessage(dialogId: string, event: NewMessageEvent): void {
    const message = event.message;
    if (!message) return;

    // 入列
    this.enqueue(dialogId, {
      id: message.id,
      date: message.date,
    });

    // 更新統計
    this.stats.totalReceived++;
  }

  /**
   * 入列訊息
   */
  private enqueue(
    dialogId: string,
    message: { id: number; date: number }
  ): EnqueueResult | undefined {
    let queue = this.queues.get(dialogId);
    if (!queue) {
      queue = [];
      this.queues.set(dialogId, queue);
    }

    // 建立佇列訊息
    const queuedMessage: QueuedMessage = {
      messageId: message.id,
      timestamp: new Date(message.date * 1000),
      message,
      retryCount: 0,
    };

    // 檢查佇列上限
    let dropped = 0;
    if (queue.length >= this.maxQueueSize) {
      // 丟棄最舊的訊息
      queue.shift();
      dropped = 1;
    }

    // 加入佇列
    queue.push(queuedMessage);

    if (dropped > 0) {
      return { overflow: true, dropped };
    }

    return undefined;
  }

  /**
   * 清空佇列
   */
  private clearQueue(dialogId: string): void {
    this.queues.set(dialogId, []);
  }

  /**
   * 取得目標群組 ID
   */
  private getTargetGroupId(dialogId: string): string | undefined {
    return this.mappings.get(dialogId);
  }

  /**
   * 移除映射
   */
  private removeMapping(dialogId: string): void {
    this.mappings.delete(dialogId);
  }

  /**
   * 轉發單一訊息
   *
   * 此方法可被 mock 以便測試
   */
  private async forwardSingleMessage(
    dialogId: string,
    _queuedMessage: QueuedMessage
  ): Promise<Result<void, RealtimeSyncError>> {
    // 取得目標群組 ID
    const targetGroupId = this.getTargetGroupId(dialogId);
    if (!targetGroupId) {
      return failure({
        type: 'FORWARD_FAILED',
        dialogId,
        messageId: _queuedMessage.messageId,
        message: 'No target group mapping found',
      });
    }

    // 實際轉發邏輯將在整合時實作
    // 此處為佔位實作，回傳成功
    return success(undefined);
  }

  /**
   * 更新對話狀態
   */
  private updateDialogState(
    dialogId: string,
    type: 'processed' | 'failed'
  ): void {
    const state = this.dialogStates.get(dialogId) || { processed: 0, failed: 0 };
    state[type]++;
    this.dialogStates.set(dialogId, state);
  }
}
