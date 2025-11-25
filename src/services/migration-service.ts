/**
 * MigrationService - 訊息遷移核心服務
 *
 * 實作訊息遷移核心功能，包含：
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

import type { TelegramClient, Api as ApiTypes } from 'telegram';
import type { EntityLike } from 'telegram/define.js';
import { Api } from 'telegram/tl/index.js';
import bigInt from 'big-integer';
import type { Result } from '../types/result.js';
import type { MigrationError } from '../types/errors.js';
import type { IMigrationService } from '../types/interfaces.js';
import type {
  DialogInfo,
  GroupInfo,
  MigrationConfig,
  MigrationOptions,
  MigrationResult,
  DialogMigrationResult,
  MessageBatch,
  MessageInfo,
  GetMessagesOptions,
  ForwardResult,
  ProgressCallback,
  ProgressEvent,
} from '../types/models.js';
import { success, failure } from '../types/result.js';

/**
 * 遷移服務實作
 *
 * 負責執行訊息遷移的核心邏輯，包含批次轉發與流量控制
 */
export class MigrationService implements IMigrationService {
  /**
   * 執行完整遷移流程
   *
   * 協調對話遷移的完整流程，包含對話列舉、群組建立與訊息轉發。
   *
   * @param client - 已驗證的 TelegramClient
   * @param config - 遷移設定
   * @param options - 遷移選項
   * @returns 遷移結果或錯誤
   */
  async migrate(
    _client: TelegramClient,
    _config: MigrationConfig,
    _options?: MigrationOptions
  ): Promise<Result<MigrationResult, MigrationError>> {
    // 此方法將在後續任務中實作完整的遷移流程協調
    return success({
      totalDialogs: 0,
      completedDialogs: 0,
      failedDialogs: 0,
      totalMessages: 0,
      migratedMessages: 0,
      duration: 0,
    });
  }

  /**
   * 遷移單一對話
   *
   * 對單一對話執行完整遷移流程，包含取得訊息與轉發。
   * 會透過 onProgress 回呼報告進度。
   *
   * @param client - 已驗證的 TelegramClient
   * @param sourceDialog - 來源對話
   * @param targetGroup - 目標群組
   * @param config - 遷移設定
   * @param onProgress - 進度回呼
   * @returns 遷移結果或錯誤
   */
  async migrateDialog(
    client: TelegramClient,
    sourceDialog: DialogInfo,
    targetGroup: GroupInfo,
    config: MigrationConfig,
    onProgress?: ProgressCallback
  ): Promise<Result<DialogMigrationResult, MigrationError>> {
    let migratedMessages = 0;
    let failedMessages = 0;
    const errors: string[] = [];
    let offsetId: number | undefined = undefined;
    let hasMore = true;
    let totalProcessed = 0;

    // 報告開始
    if (onProgress) {
      const event: ProgressEvent = {
        type: 'dialog_started',
        dialogId: sourceDialog.id,
        totalMessages: sourceDialog.messageCount,
      };
      onProgress(event);
    }

    try {
      // 取得來源與目標的 InputPeer
      const fromPeer = await client.getInputEntity(sourceDialog.entity as EntityLike);
      const toPeer = await client.getInputEntity(targetGroup.entity as EntityLike);

      // 持續取得訊息直到沒有更多
      while (hasMore) {
        // 取得訊息批次
        const messagesResult = await this.getMessages(client, sourceDialog, {
          offsetId,
          limit: config.batchSize,
          minDate: config.dateRange?.from,
          maxDate: config.dateRange?.to,
        });

        if (!messagesResult.success) {
          // 從錯誤中提取訊息
          const errorMsg = this.extractErrorMessage(messagesResult.error);
          errors.push(errorMsg);
          break;
        }

        const batch = messagesResult.data;
        hasMore = batch.hasMore;
        offsetId = batch.nextOffsetId ?? undefined;

        // 如果沒有訊息，結束迴圈
        if (batch.messages.length === 0) {
          break;
        }

        // 取得訊息 ID 列表
        const messageIds = batch.messages.map((m) => m.id);

        // 轉發訊息
        const forwardResult = await this.forwardMessages(
          client,
          fromPeer,
          toPeer,
          messageIds
        );

        if (forwardResult.success) {
          migratedMessages += forwardResult.data.successCount;
          failedMessages += forwardResult.data.failedIds.length;
        } else {
          // 處理轉發錯誤
          if (forwardResult.error.type === 'FORWARD_FAILED') {
            errors.push(forwardResult.error.message);
            failedMessages += messageIds.length;
          } else if (forwardResult.error.type === 'FLOOD_WAIT') {
            // FloodWait 需要特殊處理，暫時記錄錯誤
            errors.push(`FloodWait: ${forwardResult.error.seconds}s`);
            break;
          }
        }

        totalProcessed += batch.messages.length;

        // 報告批次完成
        if (onProgress) {
          const event: ProgressEvent = {
            type: 'batch_completed',
            dialogId: sourceDialog.id,
            count: totalProcessed,
            total: sourceDialog.messageCount,
          };
          onProgress(event);
        }
      }

      const result: DialogMigrationResult = {
        dialogId: sourceDialog.id,
        success: failedMessages === 0 && errors.length === 0,
        migratedMessages,
        failedMessages,
        errors,
      };

      // 報告完成
      if (onProgress) {
        const event: ProgressEvent = {
          type: 'dialog_completed',
          dialogId: sourceDialog.id,
          result,
        };
        onProgress(event);
      }

      return success(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(errorMessage);

      const result: DialogMigrationResult = {
        dialogId: sourceDialog.id,
        success: false,
        migratedMessages,
        failedMessages,
        errors,
      };

      // 報告完成（即使失敗）
      if (onProgress) {
        const event: ProgressEvent = {
          type: 'dialog_completed',
          dialogId: sourceDialog.id,
          result,
        };
        onProgress(event);
      }

      return success(result);
    }
  }

  /**
   * 取得對話的歷史訊息（分頁）
   *
   * 使用 messages.GetHistory API 按時間順序分頁取得訊息。
   * 支援從指定訊息 ID 繼續取得（斷點續傳）與日期範圍過濾。
   *
   * @param client - 已驗證的 TelegramClient
   * @param dialog - 對話資訊
   * @param options - 取得選項
   * @returns 訊息批次或錯誤
   */
  async getMessages(
    client: TelegramClient,
    dialog: DialogInfo,
    options: GetMessagesOptions
  ): Promise<Result<MessageBatch, MigrationError>> {
    try {
      const limit = options.limit ?? 100;
      const offsetId = options.offsetId ?? 0;

      // 取得對話的 InputPeer
      const peer = await client.getInputEntity(dialog.entity as EntityLike);

      // 使用 messages.GetHistory API 取得訊息
      const result = await client.invoke(
        new Api.messages.GetHistory({
          peer,
          offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit,
          maxId: 0,
          minId: 0,
          hash: bigInt(0),
        })
      );

      // 取得訊息列表
      const rawMessages = (result as Api.messages.Messages).messages || [];

      // 轉換為 MessageInfo 格式並過濾日期
      // 支援 GramJS Message 物件（有 className）與測試 mock 物件（無 className）
      const messages: MessageInfo[] = rawMessages
        .filter((msg): msg is Api.Message => {
          // 過濾掉服務訊息（如 MessageService），只保留一般訊息
          const msgAny = msg as { className?: string; id?: number };
          if (msgAny.className) {
            return msgAny.className === 'Message';
          }
          // Mock 物件：只要有 id 就視為有效訊息
          return typeof msgAny.id === 'number';
        })
        .map((msg) => {
          const msgAny = msg as {
            id: number;
            date: number;
            media?: unknown;
          };
          return {
            id: msgAny.id,
            date: new Date(msgAny.date * 1000),
            hasMedia: msgAny.media !== undefined && msgAny.media !== null,
          };
        })
        .filter((msg) => {
          // 日期範圍過濾
          if (options.minDate && msg.date < options.minDate) {
            return false;
          }
          if (options.maxDate && msg.date > options.maxDate) {
            return false;
          }
          return true;
        });

      // 判斷是否還有更多訊息
      // 當取得的訊息數量等於 limit 且有訊息時，可能還有更多
      const hasMore = rawMessages.length >= limit && messages.length > 0;

      // 下一個 offsetId 為最後一則訊息的 ID
      const lastMessage = messages[messages.length - 1];
      const nextOffsetId = lastMessage ? lastMessage.id : null;

      return success({
        messages,
        hasMore,
        nextOffsetId: hasMore ? nextOffsetId : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return failure({
        type: 'DIALOG_FETCH_FAILED',
        message,
      });
    }
  }

  /**
   * 批次轉發訊息
   *
   * 使用 messages.ForwardMessages API 批次轉發訊息。
   * 為每則訊息生成唯一 randomId 防止重複，保留原始發送者資訊。
   *
   * @param client - 已驗證的 TelegramClient
   * @param fromPeer - 來源 peer
   * @param toPeer - 目標 peer
   * @param messageIds - 訊息 ID 列表
   * @returns 轉發結果或錯誤
   */
  async forwardMessages(
    client: TelegramClient,
    fromPeer: unknown,
    toPeer: unknown,
    messageIds: number[]
  ): Promise<Result<ForwardResult, MigrationError>> {
    try {
      // 為每則訊息生成唯一的 randomId（使用 big-integer 以符合 GramJS 要求）
      const randomIds = messageIds.map(() =>
        bigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
      );

      // 使用 messages.ForwardMessages API 轉發訊息
      await client.invoke(
        new Api.messages.ForwardMessages({
          fromPeer: fromPeer as ApiTypes.TypeInputPeer,
          id: messageIds,
          toPeer: toPeer as ApiTypes.TypeInputPeer,
          randomId: randomIds,
          dropAuthor: false,
          dropMediaCaptions: false,
        })
      );

      // 轉發成功
      return success({
        successCount: messageIds.length,
        failedIds: [],
      });
    } catch (error) {
      return this.handleForwardError(error, messageIds);
    }
  }

  /**
   * 處理轉發錯誤
   *
   * @param error - 錯誤物件
   * @param messageIds - 訊息 ID 列表
   * @returns 失敗的 Result
   */
  private handleForwardError(
    error: unknown,
    messageIds: number[]
  ): Result<ForwardResult, MigrationError> {
    // 檢查是否為 FloodWait 錯誤
    if (this.isFloodWaitError(error)) {
      const seconds = this.extractFloodWaitSeconds(error);
      return failure({
        type: 'FLOOD_WAIT',
        seconds,
      });
    }

    // 檢查是否有部分失敗的訊息 ID
    const failedIds = this.extractFailedIds(error, messageIds);
    const message = error instanceof Error ? error.message : 'Unknown error';

    return failure({
      type: 'FORWARD_FAILED',
      dialogId: '',
      messageIds: failedIds,
      message,
    });
  }

  /**
   * 檢查是否為 FloodWait 錯誤
   */
  private isFloodWaitError(error: unknown): boolean {
    if (error instanceof Error) {
      const errorWithClass = error as Error & { className?: string };
      return (
        errorWithClass.className === 'FloodWaitError' ||
        error.message.includes('FloodWait')
      );
    }
    return false;
  }

  /**
   * 從 FloodWait 錯誤中提取等待秒數
   */
  private extractFloodWaitSeconds(error: unknown): number {
    if (error instanceof Error) {
      const errorWithSeconds = error as Error & { seconds?: number };
      if (typeof errorWithSeconds.seconds === 'number') {
        return errorWithSeconds.seconds;
      }
    }
    return 60; // 預設 60 秒
  }

  /**
   * 從錯誤中提取失敗的訊息 ID
   */
  private extractFailedIds(error: unknown, defaultIds: number[]): number[] {
    if (error instanceof Error) {
      const errorWithFailedIds = error as Error & { failedIds?: number[] };
      if (Array.isArray(errorWithFailedIds.failedIds)) {
        return errorWithFailedIds.failedIds;
      }
    }
    return defaultIds;
  }

  /**
   * 從 MigrationError 中提取錯誤訊息
   */
  private extractErrorMessage(error: MigrationError): string {
    switch (error.type) {
      case 'DIALOG_FETCH_FAILED':
        return error.message;
      case 'GROUP_CREATE_FAILED':
        return error.message;
      case 'INVITE_FAILED':
        return error.message;
      case 'FORWARD_FAILED':
        return error.message;
      case 'FLOOD_WAIT':
        return `FloodWait: ${error.seconds}s`;
      case 'ABORTED':
        return error.reason;
      default:
        return 'Unknown error';
    }
  }
}
