/**
 * DialogService - 對話列舉服務
 *
 * 實作對話探索與列舉功能，包含：
 * - 使用 GramJS getDialogs() 方法取得所有對話清單
 * - 自動處理對話數量超過 API 回應上限的分頁情境
 * - 辨識對話類型：私人聊天、群組、超級群組、頻道、機器人對話
 * - 記錄每個對話的 ID、類型、名稱、訊息總數
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import type { TelegramClient } from 'telegram';
import type { Api } from 'telegram/tl/index.js';
import type { Result } from '../types/result.js';
import type { DialogServiceError } from '../types/errors.js';
import type { IDialogService } from '../types/interfaces.js';
import type { DialogInfo, DialogFilter } from '../types/models.js';
import { DialogType } from '../types/enums.js';
import { success, failure } from '../types/result.js';

/**
 * 對話服務實作
 */
export class DialogService implements IDialogService {
  /**
   * 取得所有對話（自動處理分頁）
   *
   * 使用 GramJS client.getDialogs() 方法取得所有對話。
   * GramJS 的高階 API 會自動處理分頁，回傳完整的對話清單。
   *
   * @param client - 已驗證的 TelegramClient
   * @returns 對話清單或錯誤
   */
  async getAllDialogs(
    client: TelegramClient
  ): Promise<Result<DialogInfo[], DialogServiceError>> {
    try {
      // GramJS getDialogs() 會自動處理分頁
      const dialogs = await client.getDialogs({});

      const dialogInfoList: DialogInfo[] = [];

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (!entity) {
          continue;
        }

        const dialogInfo = this.extractDialogInfo(dialog, entity);
        dialogInfoList.push(dialogInfo);
      }

      return success(dialogInfoList);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return failure({ type: 'FETCH_FAILED', message });
    }
  }

  /**
   * 根據過濾條件篩選對話
   *
   * 過濾優先順序：
   * 1. ID 過濾（includeIds 先套用，再套用 excludeIds）
   * 2. 類型過濾（includeTypes 先套用，再套用 excludeTypes）
   * 3. 訊息數量過濾（minMessageCount, maxMessageCount）
   *
   * @param dialogs - 原始對話清單
   * @param filter - 過濾條件
   * @returns 篩選後的對話清單
   */
  filterDialogs(dialogs: DialogInfo[], filter: DialogFilter): DialogInfo[] {
    let result = dialogs;

    // Step 1: Apply ID filters
    if (filter.includeIds !== undefined) {
      result = this.applyWhitelist(result, filter.includeIds);
    }
    if (filter.excludeIds !== undefined) {
      result = this.applyBlacklist(result, filter.excludeIds);
    }

    // Step 2: Apply type filters
    // Support both legacy 'types' field and new 'includeTypes' field
    const includeTypes = filter.includeTypes ?? filter.types;
    result = this.filterByType(result, includeTypes, filter.excludeTypes);

    // Step 3: Apply message count filters
    result = this.filterByMessageCount(result, filter.minMessageCount, filter.maxMessageCount);

    return result;
  }

  /**
   * 套用白名單過濾
   *
   * 若 includeIds 為空陣列或 undefined，則不過濾（回傳所有對話）
   *
   * @param dialogs - 對話清單
   * @param includeIds - 白名單 ID 列表
   * @returns 過濾後的對話清單
   */
  applyWhitelist(dialogs: DialogInfo[], includeIds: string[]): DialogInfo[] {
    // Empty whitelist means no filtering (include all)
    if (includeIds.length === 0) {
      return dialogs;
    }
    return dialogs.filter(dialog => includeIds.includes(dialog.id));
  }

  /**
   * 套用黑名單過濾
   *
   * @param dialogs - 對話清單
   * @param excludeIds - 黑名單 ID 列表
   * @returns 過濾後的對話清單
   */
  applyBlacklist(dialogs: DialogInfo[], excludeIds: string[]): DialogInfo[] {
    // Empty blacklist means no filtering (exclude none)
    if (excludeIds.length === 0) {
      return dialogs;
    }
    return dialogs.filter(dialog => !excludeIds.includes(dialog.id));
  }

  /**
   * 依對話類型過濾
   *
   * @param dialogs - 對話清單
   * @param includeTypes - 僅包含的類型（若為空或 undefined，則不過濾）
   * @param excludeTypes - 排除的類型（若為空或 undefined，則不過濾）
   * @returns 過濾後的對話清單
   */
  filterByType(
    dialogs: DialogInfo[],
    includeTypes?: DialogType[],
    excludeTypes?: DialogType[]
  ): DialogInfo[] {
    let result = dialogs;

    // Apply include filter first
    if (includeTypes !== undefined && includeTypes.length > 0) {
      result = result.filter(dialog => includeTypes.includes(dialog.type));
    }

    // Then apply exclude filter
    if (excludeTypes !== undefined && excludeTypes.length > 0) {
      result = result.filter(dialog => !excludeTypes.includes(dialog.type));
    }

    return result;
  }

  /**
   * 依訊息數量過濾
   *
   * @param dialogs - 對話清單
   * @param min - 最小訊息數量（包含邊界值）
   * @param max - 最大訊息數量（包含邊界值）
   * @returns 過濾後的對話清單
   */
  filterByMessageCount(
    dialogs: DialogInfo[],
    min?: number,
    max?: number
  ): DialogInfo[] {
    return dialogs.filter(dialog => {
      if (min !== undefined && dialog.messageCount < min) {
        return false;
      }
      if (max !== undefined && dialog.messageCount > max) {
        return false;
      }
      return true;
    });
  }

  /**
   * 取得單一對話的詳細資訊
   *
   * @param client - 已驗證的 TelegramClient
   * @param dialogId - 對話 ID
   * @returns 對話資訊或錯誤
   */
  async getDialogInfo(
    client: TelegramClient,
    dialogId: string
  ): Promise<Result<DialogInfo, DialogServiceError>> {
    try {
      // 取得所有對話並尋找目標
      const allDialogsResult = await this.getAllDialogs(client);

      if (!allDialogsResult.success) {
        return failure(allDialogsResult.error);
      }

      const targetDialog = allDialogsResult.data.find(d => d.id === dialogId);

      if (!targetDialog) {
        return failure({ type: 'NOT_FOUND', dialogId });
      }

      return success(targetDialog);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return failure({ type: 'FETCH_FAILED', message });
    }
  }

  /**
   * 辨識對話類型
   *
   * 根據 GramJS entity 的 className 與屬性判斷對話類型：
   * - Api.User with bot=true -> Bot
   * - Api.User with bot=false -> Private
   * - Api.Chat -> Group
   * - Api.Channel with megagroup=true -> Supergroup
   * - Api.Channel with megagroup=false -> Channel
   *
   * @param entity - GramJS entity (User, Chat, or Channel)
   * @returns 對話類型
   */
  classifyDialogType(entity: Api.User | Api.Chat | Api.Channel): DialogType {
    const className = (entity as { className?: string }).className;

    if (className === 'User') {
      const user = entity as Api.User;
      return user.bot ? DialogType.Bot : DialogType.Private;
    }

    if (className === 'Chat') {
      return DialogType.Group;
    }

    if (className === 'Channel') {
      const channel = entity as Api.Channel;
      return channel.megagroup ? DialogType.Supergroup : DialogType.Channel;
    }

    // 預設為私人聊天
    return DialogType.Private;
  }

  /**
   * 從對話中提取 DialogInfo
   *
   * @param dialog - GramJS dialog 物件
   * @param entity - GramJS entity 物件
   * @returns DialogInfo
   */
  private extractDialogInfo(
    dialog: unknown,
    entity: Api.User | Api.Chat | Api.Channel | unknown
  ): DialogInfo {
    const typedEntity = entity as Api.User | Api.Chat | Api.Channel;
    const typedDialog = dialog as {
      message?: { id?: number };
      unreadCount?: number;
      archived?: boolean;
    };

    return {
      id: this.extractId(typedEntity),
      accessHash: this.extractAccessHash(typedEntity),
      type: this.classifyDialogType(typedEntity),
      name: this.extractName(typedEntity),
      messageCount: this.extractMessageCount(typedDialog),
      unreadCount: typedDialog.unreadCount ?? 0,
      isArchived: typedDialog.archived ?? false,
      entity: entity,
    };
  }

  /**
   * 從 entity 中提取 ID
   *
   * GramJS 使用 BigInteger 類型，需要使用 toString() 轉換
   *
   * @param entity - GramJS entity
   * @returns ID 字串
   */
  private extractId(entity: Api.User | Api.Chat | Api.Channel): string {
    const entityWithId = entity as unknown as { id?: { toString(): string } };
    if (entityWithId.id !== undefined) {
      return entityWithId.id.toString();
    }
    return '';
  }

  /**
   * 從 entity 中提取 accessHash
   *
   * User 和 Channel 有 accessHash，Chat 沒有
   * GramJS 使用 BigInteger 類型，需要使用 toString() 轉換
   *
   * @param entity - GramJS entity
   * @returns accessHash 字串
   */
  private extractAccessHash(entity: Api.User | Api.Chat | Api.Channel): string {
    const entityWithHash = entity as unknown as { accessHash?: { toString(): string } };
    if (entityWithHash.accessHash !== undefined) {
      return entityWithHash.accessHash.toString();
    }
    return '';
  }

  /**
   * 從 entity 中提取名稱
   *
   * User: firstName + lastName
   * Chat/Channel: title
   *
   * @param entity - GramJS entity
   * @returns 名稱字串
   */
  private extractName(entity: Api.User | Api.Chat | Api.Channel): string {
    const className = (entity as { className?: string }).className;

    if (className === 'User') {
      const user = entity as Api.User;
      const firstName = user.firstName ?? '';
      const lastName = user.lastName ?? '';
      return [firstName, lastName].filter(Boolean).join(' ');
    }

    // Chat 或 Channel
    const titled = entity as { title?: string };
    return titled.title ?? '';
  }

  /**
   * 從對話中提取訊息數量
   *
   * 使用最後一則訊息的 ID 作為近似值
   *
   * @param dialog - GramJS dialog
   * @returns 訊息數量
   */
  private extractMessageCount(dialog: { message?: { id?: number } }): number {
    return dialog.message?.id ?? 0;
  }
}
