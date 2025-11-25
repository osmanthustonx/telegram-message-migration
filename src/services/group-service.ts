/**
 * GroupService - 群組管理服務
 *
 * 實作群組建立與成員邀請功能，包含：
 * - 使用 channels.CreateChannel API 建立超級群組 (megagroup)
 * - 使用原始對話名稱加上設定的前綴作為新群組名稱
 * - 記錄原始對話與新群組的對應關係
 * - 處理群組建立失敗並記錄錯誤
 * - 使用 channels.InviteToChannel API 將 B 帳號加入群組
 * - 驗證 B 帳號的使用者名稱或電話號碼是否有效
 * - 處理 B 帳號無法被邀請的情境（USER_RESTRICTED、USER_NOT_FOUND）
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import type { TelegramClient } from 'telegram';
import { Api } from 'telegram/tl/index.js';
import bigInt from 'big-integer';
import type { Result } from '../types/result.js';
import type { GroupError } from '../types/errors.js';
import type { IGroupService } from '../types/interfaces.js';
import type { DialogInfo, GroupInfo, GroupConfig } from '../types/models.js';
import { success, failure } from '../types/result.js';

/**
 * 群組服務實作
 *
 * 負責為來源對話建立對應的目標群組並邀請 B 帳號
 */
export class GroupService implements IGroupService {
  /**
   * 為來源對話建立對應的目標群組
   *
   * 使用 channels.CreateChannel API 建立超級群組 (megagroup)。
   * 群組名稱使用設定的前綴加上原始對話名稱。
   *
   * @param client - 已驗證的 TelegramClient
   * @param sourceDialog - 來源對話資訊
   * @param config - 群組設定
   * @returns 新群組資訊或錯誤
   */
  async createTargetGroup(
    client: TelegramClient,
    sourceDialog: DialogInfo,
    config: GroupConfig
  ): Promise<Result<GroupInfo, GroupError>> {
    try {
      // 組合群組名稱：前綴 + 原始對話名稱
      const groupTitle = `${config.namePrefix}${sourceDialog.name}`;

      // 使用 channels.CreateChannel API 建立超級群組
      const result = await client.invoke(
        new Api.channels.CreateChannel({
          title: groupTitle,
          about: `Migrated from: ${sourceDialog.name}`,
          megagroup: true,
          broadcast: false,
        })
      );

      // 從回傳結果取得新建立的 Channel
      const updates = result as Api.Updates;
      const channel = updates.chats?.[0] as Api.Channel;

      if (!channel) {
        return failure({
          type: 'CREATE_FAILED',
          message: 'No channel returned from CreateChannel API',
        });
      }

      // 建構 GroupInfo
      const groupInfo: GroupInfo = {
        id: channel.id.toString(),
        accessHash: channel.accessHash?.toString() ?? '',
        name: channel.title,
        sourceDialogId: sourceDialog.id,
        createdAt: new Date().toISOString(),
        entity: channel,
      };

      return success(groupInfo);
    } catch (error) {
      return this.handleCreateError(error);
    }
  }

  /**
   * 邀請使用者加入群組
   *
   * 使用 channels.InviteToChannel API 將指定使用者加入群組。
   * 會先解析使用者識別碼（username 或電話號碼）取得使用者實體。
   *
   * @param client - 已驗證的 TelegramClient
   * @param group - 目標群組
   * @param userIdentifier - 使用者識別碼（username 或電話）
   * @returns 成功或錯誤
   */
  async inviteUser(
    client: TelegramClient,
    group: GroupInfo,
    userIdentifier: string
  ): Promise<Result<void, GroupError>> {
    try {
      // 先解析使用者
      const userResult = await this.resolveUser(client, userIdentifier);
      if (!userResult.success) {
        return failure(userResult.error);
      }

      const user = userResult.data as Api.User;

      // 建立 InputChannel (GramJS 使用 big-integer 而非原生 bigint)
      const inputChannel = new Api.InputChannel({
        channelId: bigInt(group.id),
        accessHash: bigInt(group.accessHash),
      });

      // 建立 InputUser
      const inputUser = new Api.InputUser({
        userId: user.id,
        accessHash: user.accessHash ?? bigInt(0),
      });

      // 邀請使用者加入群組
      await client.invoke(
        new Api.channels.InviteToChannel({
          channel: inputChannel,
          users: [inputUser],
        })
      );

      return success(undefined);
    } catch (error) {
      return this.handleInviteError(error, userIdentifier);
    }
  }

  /**
   * 驗證使用者是否可被邀請
   *
   * 嘗試解析使用者識別碼，若成功則表示使用者存在且可能可被邀請。
   *
   * @param client - 已驗證的 TelegramClient
   * @param userIdentifier - 使用者識別碼
   * @returns 是否可邀請或錯誤
   */
  async canInviteUser(
    client: TelegramClient,
    userIdentifier: string
  ): Promise<Result<boolean, GroupError>> {
    try {
      await client.getEntity(userIdentifier);
      return success(true);
    } catch (error) {
      // 若是使用者不存在，回傳 false 而非錯誤
      if (this.isUserNotFoundError(error)) {
        return success(false);
      }

      // 其他錯誤則回傳錯誤
      return failure({
        type: 'USER_NOT_FOUND',
        userIdentifier,
      });
    }
  }

  /**
   * 解析使用者
   *
   * 使用 client.getEntity 解析使用者識別碼（username 或電話號碼）。
   *
   * @param client - 已驗證的 TelegramClient
   * @param userIdentifier - 使用者識別碼
   * @returns 使用者實體或錯誤
   */
  private async resolveUser(
    client: TelegramClient,
    userIdentifier: string
  ): Promise<Result<Api.User, GroupError>> {
    try {
      const entity = await client.getEntity(userIdentifier);
      return success(entity as Api.User);
    } catch (error) {
      if (this.isUserNotFoundError(error)) {
        return failure({
          type: 'USER_NOT_FOUND',
          userIdentifier,
        });
      }

      return failure({
        type: 'USER_NOT_FOUND',
        userIdentifier,
      });
    }
  }

  /**
   * 處理群組建立錯誤
   *
   * @param error - 錯誤物件
   * @returns 失敗的 Result
   */
  private handleCreateError(error: unknown): Result<GroupInfo, GroupError> {
    // 檢查是否為 FloodWait 錯誤
    if (this.isFloodWaitError(error)) {
      const seconds = this.extractFloodWaitSeconds(error);
      return failure({
        type: 'FLOOD_WAIT',
        seconds,
      });
    }

    // 一般錯誤
    const message = error instanceof Error ? error.message : 'Unknown error';
    return failure({
      type: 'CREATE_FAILED',
      message,
    });
  }

  /**
   * 處理邀請錯誤
   *
   * @param error - 錯誤物件
   * @param userIdentifier - 使用者識別碼
   * @returns 失敗的 Result
   */
  private handleInviteError(
    error: unknown,
    userIdentifier: string
  ): Result<void, GroupError> {
    // 檢查是否為 FloodWait 錯誤
    if (this.isFloodWaitError(error)) {
      const seconds = this.extractFloodWaitSeconds(error);
      return failure({
        type: 'FLOOD_WAIT',
        seconds,
      });
    }

    // 檢查是否為 UserRestricted 錯誤
    if (this.isUserRestrictedError(error)) {
      const message = error instanceof Error ? error.message : 'User is restricted';
      return failure({
        type: 'USER_RESTRICTED',
        message,
      });
    }

    // 一般邀請失敗
    const message = error instanceof Error ? error.message : 'Unknown error';
    return failure({
      type: 'INVITE_FAILED',
      userIdentifier,
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
   * 檢查是否為 UserNotFound 錯誤
   */
  private isUserNotFoundError(error: unknown): boolean {
    if (error instanceof Error) {
      const errorWithClass = error as Error & { className?: string };
      return (
        errorWithClass.className === 'UsernameNotOccupiedError' ||
        errorWithClass.className === 'UsernameInvalidError' ||
        error.message.includes('not found') ||
        error.message.includes('invalid')
      );
    }
    return false;
  }

  /**
   * 檢查是否為 UserRestricted 錯誤
   */
  private isUserRestrictedError(error: unknown): boolean {
    if (error instanceof Error) {
      const errorWithClass = error as Error & { className?: string };
      return (
        errorWithClass.className === 'UserRestrictedError' ||
        error.message.includes('restricted')
      );
    }
    return false;
  }
}
