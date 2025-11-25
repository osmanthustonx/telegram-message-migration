/**
 * GroupService 單元測試
 *
 * 測試群組管理功能，包含：
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroupService } from '../../src/services/group-service.js';
import { DialogType } from '../../src/types/enums.js';
import type { TelegramClient } from 'telegram';
import type { DialogInfo, GroupInfo, GroupConfig } from '../../src/types/models.js';

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
    entity: {},
    ...overrides,
  };
}

/**
 * 建立 mock GroupConfig
 */
function createMockGroupConfig(overrides: Partial<GroupConfig> = {}): GroupConfig {
  return {
    namePrefix: '[Migrated] ',
    ...overrides,
  };
}

/**
 * Mock Channel 物件（模擬 GramJS Api.Channel）
 */
interface MockChannel {
  className: 'Channel';
  id: bigint;
  accessHash: bigint;
  title: string;
  megagroup: boolean;
}

/**
 * Mock User 物件（模擬 GramJS Api.User）
 */
interface MockUser {
  className: 'User';
  id: bigint;
  accessHash: bigint;
  username?: string;
  phone?: string;
}

/**
 * 建立 mock 已建立的 Channel
 */
function createMockCreatedChannel(overrides: Partial<MockChannel> = {}): MockChannel {
  return {
    className: 'Channel',
    id: BigInt(999999),
    accessHash: BigInt(111111),
    title: '[Migrated] Test Dialog',
    megagroup: true,
    ...overrides,
  };
}

/**
 * 建立 mock User
 */
function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    className: 'User',
    id: BigInt(777777),
    accessHash: BigInt(888888),
    username: 'testuser',
    ...overrides,
  };
}

/**
 * 建立 mock TelegramClient
 */
function createMockClient(options: {
  createChannelResult?: MockChannel | Error;
  inviteResult?: void | Error;
  getEntityResult?: MockUser | Error;
} = {}): TelegramClient {
  const {
    createChannelResult = createMockCreatedChannel(),
    inviteResult = undefined,
    getEntityResult = createMockUser(),
  } = options;

  const mockInvoke = vi.fn().mockImplementation((request: { className?: string }) => {
    if (request.className === 'channels.CreateChannel') {
      if (createChannelResult instanceof Error) {
        return Promise.reject(createChannelResult);
      }
      return Promise.resolve({
        chats: [createChannelResult],
      });
    }
    if (request.className === 'channels.InviteToChannel') {
      if (inviteResult instanceof Error) {
        return Promise.reject(inviteResult);
      }
      return Promise.resolve({ className: 'Updates' });
    }
    return Promise.resolve({});
  });

  const mockGetEntity = vi.fn().mockImplementation(() => {
    if (getEntityResult instanceof Error) {
      return Promise.reject(getEntityResult);
    }
    return Promise.resolve(getEntityResult);
  });

  return {
    invoke: mockInvoke,
    getEntity: mockGetEntity,
  } as unknown as TelegramClient;
}

// ============================================================================
// Task 7.1: 目標群組建立測試
// Requirements: 3.1, 3.2, 3.5, 3.6
// ============================================================================

describe('GroupService', () => {
  let groupService: GroupService;

  beforeEach(() => {
    groupService = new GroupService();
  });

  describe('createTargetGroup', () => {
    describe('使用 channels.CreateChannel API 建立超級群組 (megagroup)', () => {
      it('應成功建立超級群組', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data).toBeDefined();
          expect(result.data.id).toBeDefined();
        }
      });

      it('應呼叫 channels.CreateChannel 並設定 megagroup 為 true', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        await groupService.createTargetGroup(client, sourceDialog, config);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            className: 'channels.CreateChannel',
            megagroup: true,
          })
        );
      });

      it('應在 API 呼叫中設定 broadcast 為 false', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        await groupService.createTargetGroup(client, sourceDialog, config);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            broadcast: false,
          })
        );
      });
    });

    describe('使用原始對話名稱加上設定的前綴作為新群組名稱', () => {
      it('應使用前綴加上原始對話名稱作為群組標題', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo({ name: 'My Chat' });
        const config = createMockGroupConfig({ namePrefix: '[Migrated] ' });

        await groupService.createTargetGroup(client, sourceDialog, config);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '[Migrated] My Chat',
          })
        );
      });

      it('應支援不同的前綴設定', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo({ name: 'Work Group' });
        const config = createMockGroupConfig({ namePrefix: '[Backup] ' });

        await groupService.createTargetGroup(client, sourceDialog, config);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '[Backup] Work Group',
          })
        );
      });

      it('應處理空前綴', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo({ name: 'Original Name' });
        const config = createMockGroupConfig({ namePrefix: '' });

        await groupService.createTargetGroup(client, sourceDialog, config);

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Original Name',
          })
        );
      });
    });

    describe('記錄原始對話與新群組的對應關係', () => {
      it('應回傳包含 sourceDialogId 的 GroupInfo', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo({ id: '12345' });
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.sourceDialogId).toBe('12345');
        }
      });

      it('應回傳新群組的 id 和 accessHash', async () => {
        const mockChannel = createMockCreatedChannel({
          id: BigInt(999999),
          accessHash: BigInt(111111),
        });
        const client = createMockClient({ createChannelResult: mockChannel });
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.id).toBe('999999');
          expect(result.data.accessHash).toBe('111111');
        }
      });

      it('應回傳新群組的名稱', async () => {
        const mockChannel = createMockCreatedChannel({
          title: '[Migrated] Test Dialog',
        });
        const client = createMockClient({ createChannelResult: mockChannel });
        const sourceDialog = createMockDialogInfo({ name: 'Test Dialog' });
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.name).toBe('[Migrated] Test Dialog');
        }
      });

      it('應回傳建立時間 (createdAt)', async () => {
        const client = createMockClient();
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const beforeTime = new Date().toISOString();
        const result = await groupService.createTargetGroup(client, sourceDialog, config);
        const afterTime = new Date().toISOString();

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.createdAt).toBeDefined();
          expect(result.data.createdAt >= beforeTime).toBe(true);
          expect(result.data.createdAt <= afterTime).toBe(true);
        }
      });

      it('應保留 entity 參考', async () => {
        const mockChannel = createMockCreatedChannel();
        const client = createMockClient({ createChannelResult: mockChannel });
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.entity).toBeDefined();
        }
      });
    });

    describe('處理群組建立失敗並記錄錯誤', () => {
      it('應回傳 CREATE_FAILED 錯誤當 API 呼叫失敗', async () => {
        const error = new Error('API Error');
        const client = createMockClient({ createChannelResult: error });
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('CREATE_FAILED');
        }
      });

      it('應在錯誤中包含錯誤訊息', async () => {
        const error = new Error('Channel creation limit reached');
        const client = createMockClient({ createChannelResult: error });
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('CREATE_FAILED');
          expect(result.error.message).toContain('Channel creation limit reached');
        }
      });

      it('應處理 FLOOD_WAIT 錯誤', async () => {
        const floodError = new Error('FloodWaitError') as Error & { seconds?: number };
        floodError.seconds = 60;
        (floodError as unknown as { className?: string }).className = 'FloodWaitError';
        const client = createMockClient({ createChannelResult: floodError });
        const sourceDialog = createMockDialogInfo();
        const config = createMockGroupConfig();

        const result = await groupService.createTargetGroup(client, sourceDialog, config);

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
  // Task 7.2: B 帳號邀請功能測試
  // Requirements: 3.3, 3.4
  // ============================================================================

  describe('inviteUser', () => {
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
        entity: createMockCreatedChannel(),
        ...overrides,
      };
    }

    describe('使用 channels.InviteToChannel API 將 B 帳號加入群組', () => {
      it('應成功邀請使用者加入群組', async () => {
        const client = createMockClient();
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '@testuser');

        expect(result.success).toBe(true);
      });

      it('應呼叫 channels.InviteToChannel API', async () => {
        const client = createMockClient();
        const group = createMockGroupInfo();

        await groupService.inviteUser(client, group, '@testuser');

        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            className: 'channels.InviteToChannel',
          })
        );
      });

      it('應使用 InputChannel 指定目標群組', async () => {
        const client = createMockClient();
        const group = createMockGroupInfo({
          id: '999999',
          accessHash: '111111',
        });

        await groupService.inviteUser(client, group, '@testuser');

        // 驗證 invoke 被呼叫且包含正確的 channel className
        // 注意：bigInt() 回傳 BigInteger 物件，在 mock 中會被序列化為字串
        expect(client.invoke).toHaveBeenCalledWith(
          expect.objectContaining({
            className: 'channels.InviteToChannel',
            channel: expect.objectContaining({
              className: 'InputChannel',
            }),
          })
        );
      });

      it('應先解析使用者再邀請', async () => {
        const client = createMockClient();
        const group = createMockGroupInfo();

        await groupService.inviteUser(client, group, '@testuser');

        expect(client.getEntity).toHaveBeenCalledWith('@testuser');
      });
    });

    describe('驗證 B 帳號的使用者名稱或電話號碼是否有效', () => {
      it('應支援使用者名稱格式 (@username)', async () => {
        const client = createMockClient();
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '@validuser');

        expect(client.getEntity).toHaveBeenCalledWith('@validuser');
        expect(result.success).toBe(true);
      });

      it('應支援電話號碼格式', async () => {
        const mockUser = createMockUser({ phone: '+886912345678' });
        const client = createMockClient({ getEntityResult: mockUser });
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '+886912345678');

        expect(client.getEntity).toHaveBeenCalledWith('+886912345678');
        expect(result.success).toBe(true);
      });

      it('應回傳 USER_NOT_FOUND 當使用者不存在', async () => {
        const error = new Error('User not found');
        (error as unknown as { className?: string }).className = 'UsernameNotOccupiedError';
        const client = createMockClient({ getEntityResult: error });
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '@nonexistent');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('USER_NOT_FOUND');
          if (result.error.type === 'USER_NOT_FOUND') {
            expect(result.error.userIdentifier).toBe('@nonexistent');
          }
        }
      });
    });

    describe('處理 B 帳號無法被邀請的情境', () => {
      it('應回傳 USER_RESTRICTED 當使用者被限制', async () => {
        const mockUser = createMockUser();
        const restrictedError = new Error('User is restricted');
        (restrictedError as unknown as { className?: string }).className = 'UserRestrictedError';

        const client = createMockClient({
          getEntityResult: mockUser,
          inviteResult: restrictedError,
        });
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '@restricted');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('USER_RESTRICTED');
        }
      });

      it('應回傳 INVITE_FAILED 當邀請失敗', async () => {
        const mockUser = createMockUser();
        const inviteError = new Error('Invite failed');
        const client = createMockClient({
          getEntityResult: mockUser,
          inviteResult: inviteError,
        });
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '@testuser');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('INVITE_FAILED');
          if (result.error.type === 'INVITE_FAILED') {
            expect(result.error.userIdentifier).toBe('@testuser');
          }
        }
      });

      it('應處理 FLOOD_WAIT 錯誤', async () => {
        const mockUser = createMockUser();
        const floodError = new Error('FloodWaitError') as Error & { seconds?: number };
        floodError.seconds = 120;
        (floodError as unknown as { className?: string }).className = 'FloodWaitError';

        const client = createMockClient({
          getEntityResult: mockUser,
          inviteResult: floodError,
        });
        const group = createMockGroupInfo();

        const result = await groupService.inviteUser(client, group, '@testuser');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('FLOOD_WAIT');
          if (result.error.type === 'FLOOD_WAIT') {
            expect(result.error.seconds).toBe(120);
          }
        }
      });
    });
  });

  describe('canInviteUser', () => {
    it('應回傳 true 當使用者存在且可被邀請', async () => {
      const client = createMockClient();

      const result = await groupService.canInviteUser(client, '@validuser');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(true);
      }
    });

    it('應回傳 false 當使用者不存在', async () => {
      const error = new Error('User not found');
      (error as unknown as { className?: string }).className = 'UsernameNotOccupiedError';
      const client = createMockClient({ getEntityResult: error });

      const result = await groupService.canInviteUser(client, '@nonexistent');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(false);
      }
    });

    it('應回傳錯誤當發生非預期錯誤', async () => {
      const error = new Error('Network error');
      const client = createMockClient({ getEntityResult: error });

      const result = await groupService.canInviteUser(client, '@testuser');

      expect(result.success).toBe(false);
    });
  });
});
