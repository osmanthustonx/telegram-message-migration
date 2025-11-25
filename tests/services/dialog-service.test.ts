/**
 * DialogService 單元測試
 *
 * 測試對話列舉功能，包含：
 * - 使用 GramJS getDialogs() 取得所有對話
 * - 自動處理分頁
 * - 辨識對話類型
 * - 記錄對話資訊
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DialogService } from '../../src/services/dialog-service.js';
import { DialogType } from '../../src/types/enums.js';
import type { TelegramClient } from 'telegram';
import type { Api } from 'telegram/tl/index.js';
import type { DialogInfo } from '../../src/types/models.js';

// Mock GramJS entities
interface MockUser {
  className: 'User';
  id: bigint;
  accessHash: bigint;
  firstName: string;
  lastName?: string;
  username?: string;
  bot: boolean;
}

interface MockChat {
  className: 'Chat';
  id: bigint;
  title: string;
}

interface MockChannel {
  className: 'Channel';
  id: bigint;
  accessHash: bigint;
  title: string;
  megagroup: boolean;
  broadcast: boolean;
}

interface MockDialog {
  id: bigint;
  entity: MockUser | MockChat | MockChannel;
  message?: {
    id: number;
  };
  unreadCount: number;
  archived: boolean;
}

// Helper to create mock entities
function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    className: 'User',
    id: BigInt(100),
    accessHash: BigInt(12345),
    firstName: 'Test',
    lastName: 'User',
    username: 'testuser',
    bot: false,
    ...overrides,
  };
}

function createMockBot(overrides: Partial<MockUser> = {}): MockUser {
  return createMockUser({
    firstName: 'Test',
    lastName: 'Bot',
    username: 'testbot',
    bot: true,
    ...overrides,
  });
}

function createMockChat(overrides: Partial<MockChat> = {}): MockChat {
  return {
    className: 'Chat',
    id: BigInt(200),
    title: 'Test Group',
    ...overrides,
  };
}

function createMockChannel(overrides: Partial<MockChannel> = {}): MockChannel {
  return {
    className: 'Channel',
    id: BigInt(300),
    accessHash: BigInt(67890),
    title: 'Test Channel',
    megagroup: false,
    broadcast: true,
    ...overrides,
  };
}

function createMockSupergroup(overrides: Partial<MockChannel> = {}): MockChannel {
  return createMockChannel({
    title: 'Test Supergroup',
    megagroup: true,
    broadcast: false,
    ...overrides,
  });
}

function createMockDialog(entity: MockUser | MockChat | MockChannel, overrides: Partial<MockDialog> = {}): MockDialog {
  return {
    id: entity.id,
    entity,
    message: { id: 1000 },
    unreadCount: 0,
    archived: false,
    ...overrides,
  };
}

// Mock TelegramClient
function createMockClient(dialogs: MockDialog[] = []): TelegramClient {
  const mockGetDialogs = vi.fn().mockResolvedValue(dialogs);

  return {
    getDialogs: mockGetDialogs,
    getEntity: vi.fn(),
    invoke: vi.fn(),
  } as unknown as TelegramClient;
}

describe('DialogService', () => {
  let dialogService: DialogService;

  beforeEach(() => {
    dialogService = new DialogService();
  });

  describe('getAllDialogs', () => {
    it('should return empty array when no dialogs exist', async () => {
      const client = createMockClient([]);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('should fetch all dialogs from client', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      expect(client.getDialogs).toHaveBeenCalled();
    });

    it('should handle pagination when dialogs exceed limit', async () => {
      // Create 150 mock dialogs to test pagination
      const dialogs: MockDialog[] = [];
      for (let i = 0; i < 150; i++) {
        const user = createMockUser({ id: BigInt(i), firstName: `User${i}` });
        dialogs.push(createMockDialog(user));
      }
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBe(150);
      }
    });

    it('should return error when fetch fails', async () => {
      const client = createMockClient([]);
      vi.mocked(client.getDialogs).mockRejectedValue(new Error('Network error'));

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('FETCH_FAILED');
      }
    });
  });

  describe('classifyDialogType', () => {
    it('should classify User as Private', () => {
      const user = createMockUser();

      const dialogType = dialogService.classifyDialogType(user as unknown as Api.User | Api.Chat | Api.Channel);

      expect(dialogType).toBe(DialogType.Private);
    });

    it('should classify User with bot=true as Bot', () => {
      const bot = createMockBot();

      const dialogType = dialogService.classifyDialogType(bot as unknown as Api.User | Api.Chat | Api.Channel);

      expect(dialogType).toBe(DialogType.Bot);
    });

    it('should classify Chat as Group', () => {
      const chat = createMockChat();

      const dialogType = dialogService.classifyDialogType(chat as unknown as Api.User | Api.Chat | Api.Channel);

      expect(dialogType).toBe(DialogType.Group);
    });

    it('should classify Channel with megagroup=true as Supergroup', () => {
      const supergroup = createMockSupergroup();

      const dialogType = dialogService.classifyDialogType(supergroup as unknown as Api.User | Api.Chat | Api.Channel);

      expect(dialogType).toBe(DialogType.Supergroup);
    });

    it('should classify Channel with megagroup=false as Channel', () => {
      const channel = createMockChannel();

      const dialogType = dialogService.classifyDialogType(channel as unknown as Api.User | Api.Chat | Api.Channel);

      expect(dialogType).toBe(DialogType.Channel);
    });
  });

  describe('dialog info extraction', () => {
    it('should extract id from dialog', async () => {
      const user = createMockUser({ id: BigInt(12345) });
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].id).toBe('12345');
      }
    });

    it('should extract type from dialog', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].type).toBe(DialogType.Private);
      }
    });

    it('should extract name from User dialog', async () => {
      const user = createMockUser({ firstName: 'John', lastName: 'Doe' });
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].name).toBe('John Doe');
      }
    });

    it('should extract name from Channel/Group dialog', async () => {
      const channel = createMockChannel({ title: 'My Channel' });
      const dialogs = [createMockDialog(channel)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].name).toBe('My Channel');
      }
    });

    it('should extract messageCount from dialog', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user, { message: { id: 500 } })];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        // messageCount is approximated from the last message ID
        expect(result.data[0].messageCount).toBe(500);
      }
    });

    it('should extract unreadCount from dialog', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user, { unreadCount: 10 })];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].unreadCount).toBe(10);
      }
    });

    it('should preserve entity reference', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].entity).toBeDefined();
      }
    });

    it('should extract accessHash from User entity', async () => {
      const user = createMockUser({ accessHash: BigInt(99999) });
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].accessHash).toBe('99999');
      }
    });

    it('should extract accessHash from Channel entity', async () => {
      const channel = createMockChannel({ accessHash: BigInt(88888) });
      const dialogs = [createMockDialog(channel)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].accessHash).toBe('88888');
      }
    });

    it('should handle Chat without accessHash', async () => {
      const chat = createMockChat();
      const dialogs = [createMockDialog(chat)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        // Chat doesn't have accessHash, should default to empty string
        expect(result.data[0].accessHash).toBe('');
      }
    });
  });

  describe('dialog type classification - all types', () => {
    it('should correctly classify all dialog types', async () => {
      const user = createMockUser({ id: BigInt(1) });
      const bot = createMockBot({ id: BigInt(2) });
      const chat = createMockChat({ id: BigInt(3) });
      const supergroup = createMockSupergroup({ id: BigInt(4) });
      const channel = createMockChannel({ id: BigInt(5) });

      const dialogs = [
        createMockDialog(user),
        createMockDialog(bot),
        createMockDialog(chat),
        createMockDialog(supergroup),
        createMockDialog(channel),
      ];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.find(d => d.id === '1')?.type).toBe(DialogType.Private);
        expect(result.data.find(d => d.id === '2')?.type).toBe(DialogType.Bot);
        expect(result.data.find(d => d.id === '3')?.type).toBe(DialogType.Group);
        expect(result.data.find(d => d.id === '4')?.type).toBe(DialogType.Supergroup);
        expect(result.data.find(d => d.id === '5')?.type).toBe(DialogType.Channel);
      }
    });
  });

  describe('getDialogInfo', () => {
    it('should get single dialog info by id', async () => {
      const user = createMockUser({ id: BigInt(12345) });
      const dialogs = [createMockDialog(user)];
      const client = createMockClient(dialogs);

      const result = await dialogService.getDialogInfo(client, '12345');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('12345');
      }
    });

    it('should return error when dialog not found', async () => {
      const client = createMockClient([]);

      const result = await dialogService.getDialogInfo(client, '99999');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_FOUND');
        expect(result.error.dialogId).toBe('99999');
      }
    });
  });

  describe('isArchived handling', () => {
    it('should correctly identify archived dialogs', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user, { archived: true })];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].isArchived).toBe(true);
      }
    });

    it('should correctly identify non-archived dialogs', async () => {
      const user = createMockUser();
      const dialogs = [createMockDialog(user, { archived: false })];
      const client = createMockClient(dialogs);

      const result = await dialogService.getAllDialogs(client);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[0].isArchived).toBe(false);
      }
    });
  });

  // ============================================================================
  // Task 6.2: 對話過濾功能測試
  // Requirements: 2.5, 8.4
  // ============================================================================

  describe('filterDialogs', () => {
    // Helper to create DialogInfo for testing
    function createDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
      return {
        id: '1',
        accessHash: '12345',
        type: DialogType.Private,
        name: 'Test Dialog',
        messageCount: 100,
        unreadCount: 0,
        isArchived: false,
        entity: {},
        ...overrides,
      };
    }

    describe('whitelist filtering (includeIds)', () => {
      it('should include only dialogs in whitelist when includeIds is provided', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', name: 'Dialog 1' }),
          createDialogInfo({ id: '2', name: 'Dialog 2' }),
          createDialogInfo({ id: '3', name: 'Dialog 3' }),
        ];

        const result = dialogService.filterDialogs(dialogs, { includeIds: ['1', '3'] });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['1', '3']);
      });

      it('should include all dialogs when includeIds is empty array', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1' }),
          createDialogInfo({ id: '2' }),
        ];

        const result = dialogService.filterDialogs(dialogs, { includeIds: [] });

        expect(result.length).toBe(2);
      });

      it('should include all dialogs when includeIds is undefined', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1' }),
          createDialogInfo({ id: '2' }),
        ];

        const result = dialogService.filterDialogs(dialogs, {});

        expect(result.length).toBe(2);
      });
    });

    describe('blacklist filtering (excludeIds)', () => {
      it('should exclude dialogs in blacklist when excludeIds is provided', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', name: 'Dialog 1' }),
          createDialogInfo({ id: '2', name: 'Dialog 2' }),
          createDialogInfo({ id: '3', name: 'Dialog 3' }),
        ];

        const result = dialogService.filterDialogs(dialogs, { excludeIds: ['2'] });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['1', '3']);
      });

      it('should not exclude any dialogs when excludeIds is empty', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1' }),
          createDialogInfo({ id: '2' }),
        ];

        const result = dialogService.filterDialogs(dialogs, { excludeIds: [] });

        expect(result.length).toBe(2);
      });
    });

    describe('whitelist and blacklist priority', () => {
      it('should apply whitelist before blacklist (whitelist takes precedence)', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', name: 'Dialog 1' }),
          createDialogInfo({ id: '2', name: 'Dialog 2' }),
          createDialogInfo({ id: '3', name: 'Dialog 3' }),
        ];

        // Whitelist: 1, 2, 3 - Blacklist: 2
        // If whitelist is applied first, then blacklist removes 2
        const result = dialogService.filterDialogs(dialogs, {
          includeIds: ['1', '2', '3'],
          excludeIds: ['2'],
        });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['1', '3']);
      });
    });

    describe('type filtering (includeTypes)', () => {
      it('should include only dialogs with specified types', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', type: DialogType.Private }),
          createDialogInfo({ id: '2', type: DialogType.Group }),
          createDialogInfo({ id: '3', type: DialogType.Bot }),
          createDialogInfo({ id: '4', type: DialogType.Channel }),
        ];

        const result = dialogService.filterDialogs(dialogs, {
          includeTypes: [DialogType.Private, DialogType.Bot],
        });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['1', '3']);
      });

      it('should include all dialogs when includeTypes is empty', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', type: DialogType.Private }),
          createDialogInfo({ id: '2', type: DialogType.Group }),
        ];

        const result = dialogService.filterDialogs(dialogs, { includeTypes: [] });

        expect(result.length).toBe(2);
      });
    });

    describe('type filtering (excludeTypes)', () => {
      it('should exclude dialogs with specified types', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', type: DialogType.Private }),
          createDialogInfo({ id: '2', type: DialogType.Group }),
          createDialogInfo({ id: '3', type: DialogType.Bot }),
          createDialogInfo({ id: '4', type: DialogType.Channel }),
        ];

        const result = dialogService.filterDialogs(dialogs, {
          excludeTypes: [DialogType.Bot, DialogType.Channel],
        });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['1', '2']);
      });

      it('should not exclude any dialogs when excludeTypes is empty', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', type: DialogType.Private }),
          createDialogInfo({ id: '2', type: DialogType.Group }),
        ];

        const result = dialogService.filterDialogs(dialogs, { excludeTypes: [] });

        expect(result.length).toBe(2);
      });
    });

    describe('message count filtering', () => {
      it('should include only dialogs with messageCount >= minMessageCount', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', messageCount: 50 }),
          createDialogInfo({ id: '2', messageCount: 100 }),
          createDialogInfo({ id: '3', messageCount: 200 }),
        ];

        const result = dialogService.filterDialogs(dialogs, { minMessageCount: 100 });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['2', '3']);
      });

      it('should include only dialogs with messageCount <= maxMessageCount', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', messageCount: 50 }),
          createDialogInfo({ id: '2', messageCount: 100 }),
          createDialogInfo({ id: '3', messageCount: 200 }),
        ];

        const result = dialogService.filterDialogs(dialogs, { maxMessageCount: 100 });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['1', '2']);
      });

      it('should include dialogs within range when both min and max are provided', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', messageCount: 50 }),
          createDialogInfo({ id: '2', messageCount: 100 }),
          createDialogInfo({ id: '3', messageCount: 150 }),
          createDialogInfo({ id: '4', messageCount: 200 }),
        ];

        const result = dialogService.filterDialogs(dialogs, {
          minMessageCount: 100,
          maxMessageCount: 150,
        });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['2', '3']);
      });
    });

    describe('combined filtering', () => {
      it('should apply all filters in order: ID filters -> type filters -> message count filters', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', type: DialogType.Private, messageCount: 50 }),
          createDialogInfo({ id: '2', type: DialogType.Private, messageCount: 150 }),
          createDialogInfo({ id: '3', type: DialogType.Group, messageCount: 100 }),
          createDialogInfo({ id: '4', type: DialogType.Bot, messageCount: 200 }),
          createDialogInfo({ id: '5', type: DialogType.Channel, messageCount: 300 }),
        ];

        const result = dialogService.filterDialogs(dialogs, {
          excludeIds: ['5'],
          includeTypes: [DialogType.Private, DialogType.Group],
          minMessageCount: 100,
        });

        expect(result.length).toBe(2);
        expect(result.map(d => d.id)).toEqual(['2', '3']);
      });

      it('should return empty array when no dialogs match all criteria', () => {
        const dialogs: DialogInfo[] = [
          createDialogInfo({ id: '1', type: DialogType.Private, messageCount: 50 }),
          createDialogInfo({ id: '2', type: DialogType.Group, messageCount: 100 }),
        ];

        const result = dialogService.filterDialogs(dialogs, {
          includeTypes: [DialogType.Bot],
          minMessageCount: 1000,
        });

        expect(result.length).toBe(0);
      });
    });
  });

  describe('applyWhitelist', () => {
    function createDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
      return {
        id: '1',
        accessHash: '12345',
        type: DialogType.Private,
        name: 'Test Dialog',
        messageCount: 100,
        unreadCount: 0,
        isArchived: false,
        entity: {},
        ...overrides,
      };
    }

    it('should only include dialogs with IDs in the whitelist', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1' }),
        createDialogInfo({ id: '2' }),
        createDialogInfo({ id: '3' }),
      ];

      const result = dialogService.applyWhitelist(dialogs, ['1', '3']);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['1', '3']);
    });

    it('should return all dialogs when whitelist is empty', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1' }),
        createDialogInfo({ id: '2' }),
      ];

      const result = dialogService.applyWhitelist(dialogs, []);

      expect(result.length).toBe(2);
    });

    it('should return empty array when no dialogs match whitelist', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1' }),
        createDialogInfo({ id: '2' }),
      ];

      const result = dialogService.applyWhitelist(dialogs, ['99', '100']);

      expect(result.length).toBe(0);
    });
  });

  describe('applyBlacklist', () => {
    function createDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
      return {
        id: '1',
        accessHash: '12345',
        type: DialogType.Private,
        name: 'Test Dialog',
        messageCount: 100,
        unreadCount: 0,
        isArchived: false,
        entity: {},
        ...overrides,
      };
    }

    it('should exclude dialogs with IDs in the blacklist', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1' }),
        createDialogInfo({ id: '2' }),
        createDialogInfo({ id: '3' }),
      ];

      const result = dialogService.applyBlacklist(dialogs, ['2']);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['1', '3']);
    });

    it('should return all dialogs when blacklist is empty', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1' }),
        createDialogInfo({ id: '2' }),
      ];

      const result = dialogService.applyBlacklist(dialogs, []);

      expect(result.length).toBe(2);
    });
  });

  describe('filterByType', () => {
    function createDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
      return {
        id: '1',
        accessHash: '12345',
        type: DialogType.Private,
        name: 'Test Dialog',
        messageCount: 100,
        unreadCount: 0,
        isArchived: false,
        entity: {},
        ...overrides,
      };
    }

    it('should include only specified types when includeTypes is provided', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', type: DialogType.Private }),
        createDialogInfo({ id: '2', type: DialogType.Group }),
        createDialogInfo({ id: '3', type: DialogType.Bot }),
      ];

      const result = dialogService.filterByType(dialogs, [DialogType.Private, DialogType.Bot], undefined);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['1', '3']);
    });

    it('should exclude specified types when excludeTypes is provided', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', type: DialogType.Private }),
        createDialogInfo({ id: '2', type: DialogType.Group }),
        createDialogInfo({ id: '3', type: DialogType.Bot }),
      ];

      const result = dialogService.filterByType(dialogs, undefined, [DialogType.Bot]);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['1', '2']);
    });

    it('should apply both includeTypes and excludeTypes', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', type: DialogType.Private }),
        createDialogInfo({ id: '2', type: DialogType.Group }),
        createDialogInfo({ id: '3', type: DialogType.Bot }),
        createDialogInfo({ id: '4', type: DialogType.Supergroup }),
      ];

      // Include Private and Group, then exclude Group
      const result = dialogService.filterByType(
        dialogs,
        [DialogType.Private, DialogType.Group],
        [DialogType.Group]
      );

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('1');
    });

    it('should return all dialogs when both include and exclude are undefined', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', type: DialogType.Private }),
        createDialogInfo({ id: '2', type: DialogType.Group }),
      ];

      const result = dialogService.filterByType(dialogs, undefined, undefined);

      expect(result.length).toBe(2);
    });
  });

  describe('filterByMessageCount', () => {
    function createDialogInfo(overrides: Partial<DialogInfo> = {}): DialogInfo {
      return {
        id: '1',
        accessHash: '12345',
        type: DialogType.Private,
        name: 'Test Dialog',
        messageCount: 100,
        unreadCount: 0,
        isArchived: false,
        entity: {},
        ...overrides,
      };
    }

    it('should filter by minimum message count', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', messageCount: 50 }),
        createDialogInfo({ id: '2', messageCount: 100 }),
        createDialogInfo({ id: '3', messageCount: 150 }),
      ];

      const result = dialogService.filterByMessageCount(dialogs, 100, undefined);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['2', '3']);
    });

    it('should filter by maximum message count', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', messageCount: 50 }),
        createDialogInfo({ id: '2', messageCount: 100 }),
        createDialogInfo({ id: '3', messageCount: 150 }),
      ];

      const result = dialogService.filterByMessageCount(dialogs, undefined, 100);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['1', '2']);
    });

    it('should filter by both min and max message count', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', messageCount: 50 }),
        createDialogInfo({ id: '2', messageCount: 100 }),
        createDialogInfo({ id: '3', messageCount: 150 }),
        createDialogInfo({ id: '4', messageCount: 200 }),
      ];

      const result = dialogService.filterByMessageCount(dialogs, 100, 150);

      expect(result.length).toBe(2);
      expect(result.map(d => d.id)).toEqual(['2', '3']);
    });

    it('should return all dialogs when both min and max are undefined', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', messageCount: 50 }),
        createDialogInfo({ id: '2', messageCount: 100 }),
      ];

      const result = dialogService.filterByMessageCount(dialogs, undefined, undefined);

      expect(result.length).toBe(2);
    });

    it('should include dialogs with exact boundary values', () => {
      const dialogs: DialogInfo[] = [
        createDialogInfo({ id: '1', messageCount: 100 }),
        createDialogInfo({ id: '2', messageCount: 200 }),
      ];

      const result = dialogService.filterByMessageCount(dialogs, 100, 200);

      expect(result.length).toBe(2);
    });
  });
});
